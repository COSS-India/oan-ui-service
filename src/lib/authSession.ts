import { decodeJwt } from 'jose';

export const AUTH_TOKEN_COOKIE_NAME = 'auth_jwt';

const COOKIE_PATH = '/';
const COOKIE_SAME_SITE = 'Lax';
let inMemoryAuthToken: string | null = null;

const isBrowser = () => typeof document !== 'undefined';

const shouldUseSecureCookie = () =>
  typeof window !== 'undefined' && window.location.protocol === 'https:';

const getCookieAttributes = (maxAgeSeconds: number) => {
  const attributes = [
    `Path=${COOKIE_PATH}`,
    `Max-Age=${maxAgeSeconds}`,
    `Expires=${new Date(Date.now() + maxAgeSeconds * 1000).toUTCString()}`,
    `SameSite=${COOKIE_SAME_SITE}`,
  ];

  if (shouldUseSecureCookie()) {
    attributes.push('Secure');
  }

  return attributes;
};

const getSessionCookieAttributes = () => {
  const attributes = [
    `Path=${COOKIE_PATH}`,
    `SameSite=${COOKIE_SAME_SITE}`,
  ];

  if (shouldUseSecureCookie()) {
    attributes.push('Secure');
  }

  return attributes;
};

const getCookieValue = (name: string): string | null => {
  if (!isBrowser()) {
    return null;
  }

  const encodedName = `${name}=`;
  const cookies = document.cookie ? document.cookie.split('; ') : [];

  for (const cookie of cookies) {
    if (cookie.startsWith(encodedName)) {
      return cookie.slice(encodedName.length);
    }
  }

  return null;
};

export const getTokenExpiryTime = (token: string): number | null => {
  try {
    const payload = decodeJwt(token);
    const expClaim = payload.exp;
    const parsedExp =
      typeof expClaim === 'number'
        ? expClaim
        : typeof expClaim === 'string' && expClaim.trim() !== ''
          ? Number(expClaim)
          : NaN;

    if (!Number.isFinite(parsedExp)) {
      return null;
    }

    return parsedExp * 1000;
  } catch (error) {
    console.error('Error decoding JWT expiry:', error);
    return null;
  }
};

export const isAuthTokenExpired = (token: string): boolean => {
  const expiryTime = getTokenExpiryTime(token);

  if (!expiryTime) {
    return false;
  }

  return expiryTime <= Date.now();
};

export const getRemainingTokenLifetimeSeconds = (token: string): number | null => {
  const expiryTime = getTokenExpiryTime(token);

  if (!expiryTime) {
    return null;
  }

  const remainingMs = expiryTime - Date.now();

  if (remainingMs <= 0) {
    return null;
  }

  const remainingSeconds = Math.floor(remainingMs / 1000);
  return remainingSeconds > 0 ? remainingSeconds : null;
};

export const storeAuthToken = (token: string): boolean => {
  if (!isBrowser()) {
    return false;
  }

  if (isAuthTokenExpired(token)) {
    clearAuthToken();
    return false;
  }

  inMemoryAuthToken = token;
  const remainingLifetimeSeconds = getRemainingTokenLifetimeSeconds(token);

  if (!remainingLifetimeSeconds) {
    // If exp is missing, keep token only for the browser session.
    document.cookie = [
      `${AUTH_TOKEN_COOKIE_NAME}=${encodeURIComponent(token)}`,
      ...getSessionCookieAttributes(),
    ].join('; ');
    return true;
  }

  const cookieParts = [
    `${AUTH_TOKEN_COOKIE_NAME}=${encodeURIComponent(token)}`,
    ...getCookieAttributes(remainingLifetimeSeconds),
  ];

  document.cookie = cookieParts.join('; ');
  return true;
};

export const clearAuthToken = (): void => {
  inMemoryAuthToken = null;

  if (!isBrowser()) {
    return;
  }

  document.cookie = [
    `${AUTH_TOKEN_COOKIE_NAME}=`,
    ...getCookieAttributes(0),
  ].join('; ');
};

export const getStoredAuthToken = (): string | null => {
  const encodedToken = getCookieValue(AUTH_TOKEN_COOKIE_NAME);

  if (!encodedToken) {
    inMemoryAuthToken = null;
    return null;
  }

  try {
    const token = decodeURIComponent(encodedToken);

    if (isAuthTokenExpired(token)) {
      clearAuthToken();
      return null;
    }

    if (inMemoryAuthToken !== token) {
      inMemoryAuthToken = token;
    }

    return token;
  } catch (error) {
    console.error('Error reading auth token from cookie:', error);
    clearAuthToken();
    return null;
  }
};
