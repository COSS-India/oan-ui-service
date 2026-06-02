import { parseAllowedParentOrigins } from '@/lib/auth-messaging';

/** Parent page origins allowed to send JWT via postMessage (iframe embed). */
const DEFAULT_ALLOWED_PARENT_ORIGINS = [
  'https://vistaar.maharashtra.gov.in',
];

const extraAllowedParentOrigins = parseAllowedParentOrigins(
  import.meta.env.VITE_ALLOWED_PARENT_ORIGINS
);

export const environment = {
  apiUrl: 'https://vistaar-dev.mahapocra.gov.in',
  maintenanceMode: false,
  guestUserLimit: 10,
  allowedParentOrigins: [
    ...new Set([...DEFAULT_ALLOWED_PARENT_ORIGINS, ...extraAllowedParentOrigins]),
  ],
  embedAuthTimeoutMs: Number(import.meta.env.VITE_EMBED_AUTH_TIMEOUT_MS) || 15000,
};