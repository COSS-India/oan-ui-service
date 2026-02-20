import { createContext, useContext, ReactNode, useState, useEffect, useCallback } from 'react';
import { jwtVerify, importSPKI, JWTPayload } from 'jose';
import apiService from '@/lib/api';
import { getBrowserInfo } from '@/lib/utils';

// Constants
const JWT_STORAGE_KEY = 'auth_jwt';
const JWT_EXPIRY_MINUTES = 20; // 20 minutes expiration

// User interface that contains the essential user information
export interface User {
  authenticated: boolean;
  username: string;
  email: string;
  isGuest: boolean; // Flag to identify guest users
}

// Auth context interface
interface AuthContextType {
  user: User | null;
  isLoading: boolean;
  login: (username: string, password: string) => Promise<boolean>;
  logout: () => void;
  setAuthToken: (token: string) => Promise<boolean>;
}

// Create the context with a default value
const AuthContext = createContext<AuthContextType>({
  user: null,
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
  const [isLoading, setIsLoading] = useState(true);
  const [publicKey, setPublicKey] = useState<CryptoKey | null>(null);

  // JWT validation public key
  const publicKeyPEM = `-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA4FNoy7U5iq8x5FafwDbl
MO7q4ljd168qj9gac3KeehufnwdiyCYDXPwgXORVfvnsucEFi+uTYyttcGKPnJi7
ESPbffSmBi7W/nErcMb9W3dnNwdVfJQ2I7sybeWs+SuUMsvzT/vfFpcTOtTwLCFP
DBJv8uyz4STgbSOXCot3bnC2pqYmMrDJYP26b6QItg+RteydzwbRyYA7QtA7gfyG
x8p12QikUpIdMZ0n45JRanedTh3eQReooAZ6nAPsmpMzqhLnSOZukhiUuP3cP6qH
XpfFQM3TBi3vdels4X+CN2xjAxIKZmZUoE7/UCSCoJP40Mp2Xb+xmGjEKwSsYYRY
qwIDAQAB
-----END PUBLIC KEY-----`;

  // Decode JWT to extract expiry claim
  const getJWTExpiry = (token: string): number | null => {
    try {
      const parts = token.split('.');
      if (parts.length !== 3) return null;
      
      const payload = JSON.parse(atob(parts[1]));
      if (payload.exp) {
        return payload.exp * 1000; // Convert to milliseconds
      }
      return null;
    } catch {
      return null;
    }
  };

  // Store JWT in localStorage with expiration
  const storeJWT = (token: string, tokenExpiry?: number) => {
    try {
      let expiryDate: number;
      
      if (tokenExpiry) {
        expiryDate = tokenExpiry;
      } else {
        const now = new Date();
        const expiry = new Date(now);
        expiry.setMinutes(now.getMinutes() + JWT_EXPIRY_MINUTES);
        expiryDate = expiry.getTime();
      }
      
      const tokenData = {
        token,
        expiry: expiryDate
      };
      
      localStorage.setItem(JWT_STORAGE_KEY, JSON.stringify(tokenData));
      return true;
    } catch (error) {
      console.error("Error storing JWT:", error);
      return false;
    }
  };

  // Fetch new JWT token from /chat/auth and store it
  const fetchAndStoreNewToken = useCallback(async (importedPublicKey: CryptoKey | null) => {
    try {
      // Get browser info to send as meta parameter
      const browserInfo = getBrowserInfo();
      
      // Call /chat/auth to get JWT token
      const newToken = await apiService.fetchAuthToken(browserInfo);
      
      // Extract expiry from JWT token
      const tokenExpiry = getJWTExpiry(newToken);
      
      // Validate and store the new token
      if (importedPublicKey) {
        const result = await validateJWT(newToken, importedPublicKey);
        if (result.isValid) {
          storeJWT(newToken, tokenExpiry || undefined);
          createUserFromPayload(result.payload, true);
        } else {
          // Even if validation fails, store the token (it may be a guest token)
          console.warn('Token validation failed, storing as guest token');
          storeJWT(newToken, tokenExpiry || undefined);
          setUser({
            username: 'Guest User',
            email: 'guest@example.com',
            authenticated: true,
            isGuest: true,
          });
        }
      } else {
        // If public key is not available, store token anyway
        storeJWT(newToken, tokenExpiry || undefined);
        // Create a guest user since this token is from /api/token (guest endpoint)
        setUser({
          username: 'Guest User',
          email: 'guest@example.com',
          authenticated: true,
          isGuest: true,
        });
      }
    } catch (error) {
      console.error('Failed to fetch auth token from /chat/auth:', error);
    }
  }, []);

  // Initialize auth state on component mount
  useEffect(() => {
    const initAuth = async () => {
      try {
        setIsLoading(true);
        // Import the public key
        const importedPublicKey = await importSPKI(publicKeyPEM, 'RS256');
        setPublicKey(importedPublicKey);

        // Check URL params first for new JWT (backward compatibility)
        const urlParams = new URLSearchParams(window.location.search);
        const tokenFromUrl = urlParams.get('token');

        // If JWT exists in URL, validate and store it (backward compatibility)
        if (tokenFromUrl) {
          if (importedPublicKey) {
            const result = await validateJWT(tokenFromUrl, importedPublicKey);
            if (result.isValid) {
              storeJWT(tokenFromUrl);
              createUserFromPayload(result.payload);
              // Clean up URL by removing the JWT parameter
              const newUrl = window.location.pathname + window.location.hash;
              window.history.replaceState({}, document.title, newUrl);
            } else {
              // Invalid token from URL, try to get new token
              await fetchAndStoreNewToken(importedPublicKey);
            }
          } else {
               console.error('Public key not loaded.');
               await fetchAndStoreNewToken(importedPublicKey);
          }
        }
        // Otherwise, check for JWT in localStorage
        else {
          const storedToken = getStoredJWT();
          if (storedToken) {
             if (importedPublicKey) {
              const result = await validateJWT(storedToken, importedPublicKey);
              if (result.isValid) {
                createUserFromPayload(result.payload);
              } else {
                // Token is invalid or expired, fetch new token from /chat/auth
                localStorage.removeItem(JWT_STORAGE_KEY);
                await fetchAndStoreNewToken(importedPublicKey);
              }
             } else {
               console.error('Public key not loaded.');
               await fetchAndStoreNewToken(importedPublicKey);
             }
          } else {
            // No token found, fetch new token from /chat/auth
            await fetchAndStoreNewToken(importedPublicKey);
          }
        }
      } catch (error) {
        console.error("Auth initialization error:", error);
      } finally {
        setIsLoading(false);
      }
    };

    initAuth();
  }, [publicKeyPEM, fetchAndStoreNewToken]);

  // Create a user object from JWT payload
  const createUserFromPayload = (payload: JWTPayload | null, isGuest: boolean = false) => {
    if (!payload) {
      setUser({
        authenticated: false,
        username: 'Guest User',
        email: 'guest@example.com',
        isGuest: true,
      });
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
    
    setUser({
      authenticated: true,
      username: name,
      email: email,
      isGuest: isGuest
    });
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

  // Public method to set auth token
  const setAuthToken = async (token: string): Promise<boolean> => {
    try {
      if (publicKey) {
        const result = await validateJWT(token, publicKey);
        if (result.isValid) {
          storeJWT(token);
          createUserFromPayload(result.payload);
          return true;
        }
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
    localStorage.removeItem(JWT_STORAGE_KEY);
  };

  return (
    <AuthContext.Provider value={{ user, isLoading, login, logout, setAuthToken }}>
      {children}
    </AuthContext.Provider>
  );
}

// Custom hook to use the auth context
export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
} 
