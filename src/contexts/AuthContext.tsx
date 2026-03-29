import { createContext, useContext, ReactNode, useState, useEffect } from 'react';
import { jwtVerify, importSPKI, JWTPayload } from 'jose';
import { setTelemetryUserData } from '../lib/telemetry';
import {
  clearAuthToken,
  getStoredAuthToken,
  isAuthTokenExpired,
  storeAuthToken,
} from '../lib/authSession';

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
  const [publicKeys, setPublicKeys] = useState<CryptoKey[]>([]);

  const resetAuthState = () => {
    clearAuthToken();
    setUser(null);
    setLocations([]);
    setTelemetryUserData({});
  };

  // Initialize auth state on component mount
  useEffect(() => {
    let isMounted = true;

    const cleanupUrlToken = () => {
      const url = new URL(window.location.href);

      if (!url.searchParams.has('token')) {
        return;
      }

      url.searchParams.delete('token');
      const nextUrl = `${url.pathname}${url.search}${url.hash}`;
      window.history.replaceState({}, document.title, nextUrl);
    };

    const extractPemBlocks = (pemText: string): string[] => {
      const blockRegex = /-----BEGIN PUBLIC KEY-----[\s\S]*?-----END PUBLIC KEY-----/g;
      const matches = pemText.match(blockRegex);

      if (matches && matches.length > 0) {
        const uniqueBlocks = Array.from(
          new Set(matches.map((block) => block.trim()))
        );
        return uniqueBlocks;
      }

      const trimmed = pemText.trim();
      return trimmed ? [trimmed] : [];
    };

    const loadVerificationKeys = async (): Promise<CryptoKey[]> => {
      const keySources = [{ path: '/public.pem', required: true }];
      const importedKeys: CryptoKey[] = [];

      for (const source of keySources) {
        const response = await fetch(source.path, { cache: 'no-store' });

        if (!response.ok) {
          if (source.required) {
            throw new Error(`Unable to load public key: ${response.status}`);
          }

          continue;
        }

        const pemContents = await response.text();
        const pemBlocks = extractPemBlocks(pemContents);

        for (const pemBlock of pemBlocks) {
          try {
            const importedPublicKey = await importSPKI(pemBlock, 'RS256');
            importedKeys.push(importedPublicKey as CryptoKey);
          } catch (error) {
            console.error('Failed to import one public key block from public.pem:', error);
          }
        }
      }

      if (importedKeys.length === 0) {
        throw new Error('No public keys available for JWT verification.');
      }

      return importedKeys;
    };

    const authenticateToken = async (
      token: string,
      importedKeys: CryptoKey[],
      shouldPersist: boolean
    ): Promise<boolean> => {
      const result = await validateJWT(token, importedKeys);

      if (!isMounted) {
        return false;
      }

      if (!result.isValid || !result.payload) {
        resetAuthState();
        return false;
      }

      if (shouldPersist && !storeAuthToken(token)) {
        resetAuthState();
        return false;
      }

      createUserFromPayload(result.payload);
      return true;
    };

    const initAuth = async () => {
      try {
        setIsLoading(true);
        const importedKeys = await loadVerificationKeys();

        if (!isMounted) {
          return;
        }

        setPublicKeys(importedKeys);

        const urlParams = new URLSearchParams(window.location.search);
        const tokenFromUrl = urlParams.get('token');

        if (tokenFromUrl) {
          await authenticateToken(tokenFromUrl, importedKeys, true);
          cleanupUrlToken();
          return;
        }

        const storedToken = getStoredAuthToken();

        if (storedToken) {
          const isAuthenticated = await authenticateToken(storedToken, importedKeys, false);

          if (!isAuthenticated) {
            resetAuthState();
          }
        } else {
          createUserFromPayload(null);
        }
      } catch (error) {
        console.error("Auth initialization error:", error);
        resetAuthState();
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    };

    initAuth();

    return () => {
      isMounted = false;
    };
  }, []);

  // Create a user object from JWT payload
  const createUserFromPayload = (payload: JWTPayload | null) => {
    if (!payload) {
      setUser(null);
      setLocations([]);
      // Clear telemetry data when user is not available
      setTelemetryUserData({});
      return;
    }
    
    // Extract name from payload, use fallbacks
    const name = payload.name as string || 'Anonymous User';
    
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
  };

  // Function to validate JWT and extract payload
  async function validateJWT(token: string, keys: CryptoKey[]): Promise<{ isValid: boolean; payload: JWTPayload | null }> {
    try {
      for (const key of keys) {
        try {
          const { payload } = await jwtVerify(token, key, { algorithms: ['RS256'] });

          if (isAuthTokenExpired(token)) {
            return { isValid: false, payload: null };
          }

          return { isValid: true, payload };
        } catch {
          continue;
        }
      }

      throw new Error('JWT verification failed for all configured public keys.');
    } catch (e) {
      console.error('JWT verification failed:', e);
      return { isValid: false, payload: null };
    }
  }

  // Public method to set auth token
  const setAuthToken = async (token: string): Promise<boolean> => {
    try {
      if (publicKeys.length > 0) {
        const result = await validateJWT(token, publicKeys);

        if (result.isValid && result.payload && storeAuthToken(token)) {
          createUserFromPayload(result.payload);
          return true;
        }
      }

      resetAuthState();
      return false;
    } catch (error) {
      console.error("Error setting auth token:", error);
      resetAuthState();
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
    resetAuthState();
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
