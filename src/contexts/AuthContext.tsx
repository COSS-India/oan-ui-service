import { createContext, useContext, ReactNode, useState, useEffect, useRef, useCallback } from 'react';
import { jwtVerify, importSPKI, JWTPayload } from 'jose';
import { setTelemetryUserData } from '../lib/telemetry';
import { environment } from '@/config/environment';
import apiService from '@/lib/api';
import {
  isEmbedded,
  isAuthSetTokenMessage,
  notifyParentAuthReady,
  notifyParentAuthSuccess,
  notifyParentAuthFailure,
} from '@/lib/auth-messaging';

// Constants
const JWT_STORAGE_KEY = 'auth_jwt';
const JWT_EXPIRY_DAYS = 365; // 1 year expiration

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

  // JWT validation public key
  const publicKeyPEM = `-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAkvyeaWfmnLrbNneMjJ16
+FeHBSAeheTiaUWGidoBI4sYEHxB3rGlr+7WGMyX4rmfFCUDnCIWGuKt32UoA9CZ
mgE9JCbmJLM1dR35cN9yEUmXggYXRJB8pMqlt+u3jHRFieLumzk1keEiTCsQqvgs
txlhdBHyPTo7lAcaeFWgoK1CjqDi9xlZuTNUQB8WqhhCtjiEjE1Vj/G6DzYPcJ/g
eJNM7/Dku5awXwG7lGqjKGuXj+C9fDF/zXrXAhGSVuSMW2hYczmILDyKaes2iH8K
cYYzlCVV0lzJ+Sa98Fvpb/tOMY6XqoTzmkU/WlRoYY7jsqFykAcbOpncyO+lm+WW
rQIDAQAB
-----END PUBLIC KEY-----`;

  const embedAuthSettledRef = useRef(false);

  // Create a user object from JWT payload
  const createUserFromPayload = (payload: JWTPayload | null) => {
    if (!payload) {
      setUser(null);
      setLocations([]);
      setTelemetryUserData({});
      return;
    }

    const name = (payload.name as string) || 'Anonymous User';

    let email = '';
    if (payload.email) {
      email = payload.email as string;
    } else if (payload.sub) {
      email = `${payload.sub}@example.com`;
    }

    const mobile = (payload as { mobile?: string })?.mobile || '';
    const is_guest_user = (payload as { is_guest_user?: boolean })?.is_guest_user === true;
    const role = (payload as { role?: string })?.role || '';
    const farmer_id = (payload as { farmer_id?: string })?.farmer_id || '';
    const unique_id = (payload as { unique_id?: string | number })?.unique_id;

    setUser({
      authenticated: true,
      username: name,
      email: email,
      mobile: mobile,
      is_guest_user: is_guest_user,
    });

    const locationsData = (payload as { locations?: Location[] })?.locations;
    const validatedLocations: Location[] = [];

    if (Array.isArray(locationsData)) {
      locationsData.forEach((loc) => {
        if (
          loc &&
          typeof loc === 'object' &&
          typeof loc.location_type === 'string' &&
          typeof loc.district === 'string' &&
          typeof loc.village === 'string' &&
          typeof loc.taluka === 'string' &&
          ['registered_location', 'device_location', 'agristack_location'].includes(
            loc.location_type
          )
        ) {
          validatedLocations.push({
            location_type: loc.location_type,
            district: loc.district,
            village: loc.village,
            taluka: loc.taluka,
            lgd_code: String((loc as { lgd_code?: string | number }).lgd_code ?? ''),
          });
        }
      });
    }

    setLocations(validatedLocations);

    setTelemetryUserData({
      mobile: mobile,
      username: name,
      email: email,
      role: role,
      farmer_id: farmer_id,
      unique_id: unique_id,
      locations: validatedLocations,
    });
  };

  const storeJWT = (token: string) => {
    try {
      const now = new Date();
      const expiryDate = new Date(now);
      expiryDate.setDate(now.getDate() + JWT_EXPIRY_DAYS);

      const tokenData = {
        token,
        expiry: expiryDate.getTime(),
      };

      localStorage.setItem(JWT_STORAGE_KEY, JSON.stringify(tokenData));
      return true;
    } catch (error) {
      console.error('Error storing JWT:', error);
      return false;
    }
  };

  const getStoredJWT = (): string | null => {
    try {
      const tokenData = localStorage.getItem(JWT_STORAGE_KEY);
      if (!tokenData) return null;

      const parsedData = JSON.parse(tokenData);
      const now = new Date().getTime();

      if (now > parsedData.expiry) {
        localStorage.removeItem(JWT_STORAGE_KEY);
        return null;
      }

      return parsedData.token;
    } catch (error) {
      console.error('Error retrieving JWT:', error);
      return null;
    }
  };

  async function validateJWT(
    token: string,
    key: CryptoKey
  ): Promise<{ isValid: boolean; payload: JWTPayload | null }> {
    try {
      const { payload } = await jwtVerify(token, key);
      return { isValid: true, payload };
    } catch (e) {
      console.error('JWT verification failed:', e);
      return { isValid: false, payload: null };
    }
  }

  const applyValidatedToken = useCallback((token: string, payload: JWTPayload) => {
    storeJWT(token);
    createUserFromPayload(payload);
    apiService.updateAuthToken();
  }, []);

  const authenticateWithToken = useCallback(
    async (token: string, key: CryptoKey): Promise<boolean> => {
      const result = await validateJWT(token, key);
      if (result.isValid && result.payload) {
        applyValidatedToken(token, result.payload);
        return true;
      }
      return false;
    },
    [applyValidatedToken]
  );

  const stripTokenFromUrl = () => {
    const newUrl = window.location.pathname + window.location.hash;
    window.history.replaceState({}, document.title, newUrl);
  };

  const tryEmbedPostMessageAuth = (
    importedPublicKey: CryptoKey,
    settleEmbedAuth: () => void,
    registerCleanup: (fn: () => void) => void
  ): boolean => {
    const canUsePostMessage =
      isEmbedded() && environment.allowedParentOrigins.length > 0;

    if (!canUsePostMessage) return false;

    const handleParentToken = async (event: MessageEvent) => {
      if (!environment.allowedParentOrigins.includes(event.origin)) return;
      if (!isAuthSetTokenMessage(event.data)) return;
      // Claim handling synchronously so concurrent parent retries cannot race.
      if (embedAuthSettledRef.current) return;
      embedAuthSettledRef.current = true;

      const ok = await authenticateWithToken(event.data.token, importedPublicKey);

      if (ok) {
        notifyParentAuthSuccess(event.origin);
      } else {
        notifyParentAuthFailure(event.origin, 'invalid_token');
        createUserFromPayload(null);
      }
      settleEmbedAuth();
    };

    window.addEventListener('message', handleParentToken);
    registerCleanup(() => window.removeEventListener('message', handleParentToken));

    notifyParentAuthReady();
    return true;
  };

  // Initialize auth: URL ?token= → localStorage → postMessage (iframe)
  useEffect(() => {
    let cancelled = false;
    let embedAuthTimeoutId: ReturnType<typeof setTimeout> | undefined;
    let removeMessageListener: (() => void) | undefined;

    const finishLoading = () => {
      if (!cancelled) setIsLoading(false);
    };

    const settleEmbedAuth = () => {
      if (embedAuthTimeoutId) clearTimeout(embedAuthTimeoutId);
      embedAuthTimeoutId = undefined;
      removeMessageListener?.();
      removeMessageListener = undefined;
      finishLoading();
    };

    const initAuth = async () => {
      try {
        setIsLoading(true);
        embedAuthSettledRef.current = false;

        const importedPublicKey = await importSPKI(publicKeyPEM, 'RS256');
        if (cancelled) {
          finishLoading();
          return;
        }
        setPublicKey(importedPublicKey);

        const urlParams = new URLSearchParams(window.location.search);
        const tokenFromUrl = urlParams.get('token');

        if (tokenFromUrl) {
          const ok = await authenticateWithToken(tokenFromUrl, importedPublicKey);
          if (ok) stripTokenFromUrl();
          else createUserFromPayload(null);
          finishLoading();
          return;
        }

        const storedToken = getStoredJWT();
        if (storedToken) {
          const ok = await authenticateWithToken(storedToken, importedPublicKey);
          if (ok) {
            finishLoading();
            return;
          }
          localStorage.removeItem(JWT_STORAGE_KEY);
        }

        if (
          tryEmbedPostMessageAuth(importedPublicKey, settleEmbedAuth, (fn) => {
            removeMessageListener = fn;
          })
        ) {
          embedAuthTimeoutId = setTimeout(() => {
            if (!embedAuthSettledRef.current) {
              embedAuthSettledRef.current = true;
              createUserFromPayload(null);
              environment.allowedParentOrigins.forEach((origin) =>
                notifyParentAuthFailure(origin, 'timeout')
              );
              settleEmbedAuth();
            }
          }, environment.embedAuthTimeoutMs);
          return;
        }

        createUserFromPayload(null);
        finishLoading();
      } catch (error) {
        console.error('Auth initialization error:', error);
        createUserFromPayload(null);
        finishLoading();
      }
    };

    initAuth();

    return () => {
      cancelled = true;
      if (embedAuthTimeoutId) clearTimeout(embedAuthTimeoutId);
      removeMessageListener?.();
    };
  }, [publicKeyPEM, authenticateWithToken]);

  // Public method to set auth token (e.g. custom integrator flows)
  const setAuthToken = async (token: string): Promise<boolean> => {
    try {
      if (!publicKey) return false;
      const ok = await authenticateWithToken(token, publicKey);
      if (!ok) createUserFromPayload(null);
      return ok;
    } catch (error) {
      console.error('Error setting auth token:', error);
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
    setTelemetryUserData({});
    apiService.updateAuthToken();
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