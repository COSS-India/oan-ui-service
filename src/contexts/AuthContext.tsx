import { createContext, useContext, ReactNode, useState, useEffect, useCallback } from 'react';
import { jwtVerify, importSPKI, JWTPayload } from 'jose';
import { setTelemetryUserData } from '../lib/telemetry';
import { resolveUserDisplayName } from '../lib/user';

// Constants
const JWT_STORAGE_KEY = 'auth_jwt';
const JWT_EXPIRY_DAYS = 365; // 1 year expiration
const JWT_PARAM_NAMES = ['token', 'jwt', 'authToken', 'auth_token', 'access_token', 'accessToken', 'id_token', 'idToken'];
const JWT_MESSAGE_TOKEN_KEYS = [...JWT_PARAM_NAMES, 'value'];
const JWT_MESSAGE_NESTED_KEYS = ['data', 'payload', 'detail'];
const JWT_PATTERN = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;
const JWT_PUBLIC_KEY_PATH = `${import.meta.env.BASE_URL}jwt-public-key.pem`;

interface AuthTokenOptions {
  persist?: boolean;
  clearOnInvalid?: boolean;
}

type ReactNativeWebViewWindow = Window & {
  ReactNativeWebView?: {
    postMessage: (message: string) => void;
  };
};

const normalizeJWT = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;

  const token = value.trim().replace(/^Bearer\s+/i, '');
  return JWT_PATTERN.test(token) ? token : null;
};

const getTokenFromUrlParams = (): string | null => {
  const urlParams = new URLSearchParams(window.location.search);

  for (const paramName of JWT_PARAM_NAMES) {
    const token = normalizeJWT(urlParams.get(paramName));
    if (token) return token;
  }

  return null;
};

const removeAuthParamsFromUrl = () => {
  const url = new URL(window.location.href);
  let changed = false;

  JWT_PARAM_NAMES.forEach((paramName) => {
    if (url.searchParams.has(paramName)) {
      url.searchParams.delete(paramName);
      changed = true;
    }
  });

  if (changed) {
    window.history.replaceState({}, document.title, `${url.pathname}${url.search}${url.hash}`);
  }
};

const extractTokenFromParamString = (value: string): string | null => {
  try {
    const params = new URLSearchParams(value.startsWith('?') ? value.slice(1) : value);

    for (const paramName of JWT_PARAM_NAMES) {
      const token = normalizeJWT(params.get(paramName));
      if (token) return token;
    }
  } catch {
    return null;
  }

  return null;
};

const extractTokenFromMessageData = (data: unknown, depth = 0): string | null => {
  if (depth > 3 || data == null) return null;

  const directToken = normalizeJWT(data);
  if (directToken) return directToken;

  if (typeof data === 'string') {
    try {
      const parsedData = JSON.parse(data);
      const parsedToken = extractTokenFromMessageData(parsedData, depth + 1);
      if (parsedToken) return parsedToken;
    } catch {
      // Message data is often a plain token or URL-encoded form string.
    }

    return extractTokenFromParamString(data);
  }

  if (typeof data !== 'object' || Array.isArray(data)) return null;

  const messageData = data as Record<string, unknown>;

  for (const key of JWT_MESSAGE_TOKEN_KEYS) {
    const token = normalizeJWT(messageData[key]);
    if (token) return token;
  }

  for (const key of JWT_MESSAGE_NESTED_KEYS) {
    const token = extractTokenFromMessageData(messageData[key], depth + 1);
    if (token) return token;
  }

  return null;
};

// Store JWT in localStorage with expiration
const storeJWT = (token: string) => {
  try {
    const now = new Date();
    const expiryDate = new Date(now);
    expiryDate.setDate(now.getDate() + JWT_EXPIRY_DAYS);
    
    const tokenData = {
      token,
      expiry: expiryDate.getTime()
    };
    
    localStorage.setItem(JWT_STORAGE_KEY, JSON.stringify(tokenData));
    return true;
  } catch (error) {
    console.error("Error storing JWT:", error);
    return false;
  }
};

// Retrieve JWT from localStorage
const getStoredJWT = (): string | null => {
  try {
    const tokenData = localStorage.getItem(JWT_STORAGE_KEY);
    if (!tokenData) return null;
    
    const parsedData = JSON.parse(tokenData);
    const now = new Date().getTime();
    
    // Check if token is expired
    if (now > parsedData.expiry) {
      localStorage.removeItem(JWT_STORAGE_KEY);
      return null;
    }
    
    return parsedData.token;
  } catch (error) {
    console.error("Error retrieving JWT:", error);
    return null;
  }
};

const loadJwtPublicKeyPEM = async (): Promise<string> => {
  const response = await fetch(JWT_PUBLIC_KEY_PATH, { cache: 'no-store' });

  if (!response.ok) {
    throw new Error(`Unable to load JWT public key PEM from ${JWT_PUBLIC_KEY_PATH}`);
  }

  return response.text();
};

// Function to validate JWT and extract payload
async function validateJWT(token: string, key: CryptoKey): Promise<{ isValid: boolean; payload: JWTPayload | null }> {
  try {
    const { payload } = await jwtVerify(token, key);
    return { isValid: true, payload };
  } catch (e) {
    console.error('JWT verification failed:', e);
    return { isValid: false, payload: null };
  }
}

// Location interface that matches the JWT structure
export interface Location {
  location_type: 'registered_location' | 'device_location' | 'agristack_location';
  district: string;
  village: string;
  taluka: string;
  lgd_code: string;
}

// User interface that contains the essential user information
export interface User {
  authenticated: boolean;
  username: string;
  email: string;
  mobile: string;
  is_guest_user?: boolean;
}

// Auth context interface
interface AuthContextType {
  user: User | null;
  locations: Location[];
  isLoading: boolean;
  login: (username: string, password: string) => Promise<boolean>;
  logout: () => void;
  setAuthToken: (token: string) => Promise<boolean>;
}

// Create the context with a default value
const AuthContext = createContext<AuthContextType>({
  user: null,
  locations: [],
  isLoading: true,
  login: async () => false,
  logout: () => {},
  setAuthToken: async () => false,
});

// Props for the AuthProvider component
interface AuthProviderProps {
  children: ReactNode;
}

// AuthProvider component that will wrap the application
export function AuthProvider({ children }: AuthProviderProps) {
  const [user, setUser] = useState<User | null>(null);
  const [locations, setLocations] = useState<Location[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [publicKey, setPublicKey] = useState<CryptoKey | null>(null);

  // Create a user object from JWT payload
  const createUserFromPayload = useCallback((payload: JWTPayload | null) => {
    if (!payload) {
      setUser(null);
      setLocations([]);
      // Clear telemetry data when user is not available
      setTelemetryUserData({});
      return;
    }
    
    // Extract a human-readable name and avoid using phone-like identifiers as display names.
    const name = resolveUserDisplayName(payload as JWTPayload & Record<string, unknown>);
    
    // For email, try to get from payload or use fallback
    // let email = 'user@example.com';
    let email = '';
    if (payload.email) {
      email = payload.email as string;
    } else if (payload.sub) {
      email = `${payload.sub}@example.com`;
    }
    
    // Extract mobile from payload, use fallback
    const mobile = (payload as any)?.mobile as string || '';
    
    // Extract guest user flag
    const is_guest_user = (payload as any)?.is_guest_user === true;

    // Extract additional user fields
    const role = (payload as any)?.role as string || '';
    const farmer_id = (payload as any)?.farmer_id as string || '';
    const unique_id = (payload as any)?.unique_id as string | number | undefined;
    
    setUser({
      authenticated: true,
      username: name,
      email: email,
      mobile: mobile,
      is_guest_user: is_guest_user
    });

    // Extract locations array from JWT payload
    const locationsData = (payload as any)?.locations as Location[] | undefined;
    const validatedLocations: Location[] = [];
    
    if (Array.isArray(locationsData)) {
      locationsData.forEach((loc) => {
        if (loc && typeof loc === 'object' && 
            typeof loc.location_type === 'string' &&
            typeof loc.district === 'string' &&
            typeof loc.village === 'string' &&
            typeof loc.taluka === 'string' &&
            ['registered_location', 'device_location', 'agristack_location'].includes(loc.location_type)) {
          validatedLocations.push({
            location_type: loc.location_type as 'registered_location' | 'device_location' | 'agristack_location',
            district: loc.district,
            village: loc.village,
            taluka: loc.taluka,
            lgd_code: String((loc as any).lgd_code ?? '')
          });
        }
      });
    }
    
    setLocations(validatedLocations);

    // Set comprehensive telemetry data with all location types
    setTelemetryUserData({
      mobile: mobile,
      username: name,
      email: email,
      role: role,
      farmer_id: farmer_id,
      unique_id: unique_id,
      locations: validatedLocations
    });
  }, []);

  const authenticateWithToken = useCallback(async (
    token: string,
    key: CryptoKey,
    options: AuthTokenOptions = {}
  ): Promise<boolean> => {
    const { persist = true, clearOnInvalid = false } = options;
    const result = await validateJWT(token, key);

    if (result.isValid) {
      if (persist) {
        storeJWT(token);
      }
      createUserFromPayload(result.payload);
      return true;
    }

    if (clearOnInvalid) {
      createUserFromPayload(null);
    }

    return false;
  }, [createUserFromPayload]);

  // Initialize auth state on component mount.
  useEffect(() => {
    const initAuth = async () => {
      try {
        setIsLoading(true);
        const publicKeyPEM = await loadJwtPublicKeyPEM();
        const importedPublicKey = await importSPKI(publicKeyPEM, 'RS256');
        setPublicKey(importedPublicKey);

        const tokenFromUrl = getTokenFromUrlParams();

        if (tokenFromUrl) {
          const accepted = await authenticateWithToken(tokenFromUrl, importedPublicKey, {
            persist: true,
            clearOnInvalid: true,
          });

          if (accepted) {
            removeAuthParamsFromUrl();
          }

          return;
        }

        const storedToken = getStoredJWT();

        if (storedToken) {
          const accepted = await authenticateWithToken(storedToken, importedPublicKey, {
            persist: false,
            clearOnInvalid: true,
          });

          if (!accepted) {
            localStorage.removeItem(JWT_STORAGE_KEY);
          }

          return;
        }

        createUserFromPayload(null);
      } catch (error) {
        console.error("Auth initialization error:", error);
        createUserFromPayload(null);
      } finally {
        setIsLoading(false);
      }
    };

    initAuth();
  }, [authenticateWithToken, createUserFromPayload]);

  useEffect(() => {
    if (!publicKey) return;

    const handleAuthMessage = async (event: MessageEvent) => {
      const token = extractTokenFromMessageData(event.data);
      if (!token) return;

      const accepted = await authenticateWithToken(token, publicKey, { persist: true });

      if (accepted) {
        try {
          window.parent.postMessage({ type: 'auth-token-accepted', timestamp: new Date().toISOString() }, '*');
        } catch (error) {
          console.error('Unable to notify parent that auth token was accepted:', error);
        }
      }
    };

    window.addEventListener('message', handleAuthMessage);
    document.addEventListener('message', handleAuthMessage as EventListener);

    try {
      window.parent.postMessage({ type: 'auth-token-request', timestamp: new Date().toISOString() }, '*');
      (window as ReactNativeWebViewWindow).ReactNativeWebView?.postMessage(
        JSON.stringify({ type: 'auth-token-request', timestamp: new Date().toISOString() })
      );
    } catch (error) {
      console.error('Unable to request auth token from webview host:', error);
    }

    return () => {
      window.removeEventListener('message', handleAuthMessage);
      document.removeEventListener('message', handleAuthMessage as EventListener);
    };
  }, [authenticateWithToken, publicKey]);

  // Public method to set auth token
  const setAuthToken = async (token: string): Promise<boolean> => {
    try {
      if (publicKey) {
        return authenticateWithToken(token, publicKey, { persist: true });
      }
      return false;
    } catch (error) {
      console.error("Error setting auth token:", error);
      return false;
    }
  };

  // Login function - to be implemented with actual API call
  const login = async (username: string, password: string): Promise<boolean> => {
    // This should be implemented with actual API call
    setIsLoading(true);
    try {
      // In a real implementation, this would call your authentication API
      // and get back a real JWT token
      console.log('Login called with:', username, password);
      return false; // Return false since we're not implementing real login yet
    } catch (error) {
      console.error('Login failed:', error);
      return false;
    } finally {
      setIsLoading(false);
    }
  };

  // Logout function
  const logout = () => {
    // Clear user data and token
    setUser(null);
    setLocations([]);
    localStorage.removeItem(JWT_STORAGE_KEY);
    // Clear all telemetry data on logout
    setTelemetryUserData({});
  };

  return (
    <AuthContext.Provider value={{ user, locations, isLoading, login, logout, setAuthToken }}>
      {children}
    </AuthContext.Provider>
  );
}

// Custom hook to use the auth context
// eslint-disable-next-line react-refresh/only-export-components
export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
} 
