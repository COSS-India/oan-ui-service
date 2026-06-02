/** postMessage protocol for iframe JWT handoff (parent → iframe). */

export const AUTH_MESSAGE_TYPES = {
  /** Iframe → parent: ready to receive a token (no secrets in payload). */
  READY: 'oan-auth-ready',
  /** Parent → iframe: deliver JWT once. */
  SET_TOKEN: 'oan-set-token',
  /** Iframe → parent: token accepted and stored. */
  SUCCESS: 'oan-auth-success',
  /** Iframe → parent: token rejected or invalid. */
  FAILURE: 'oan-auth-failure',
} as const;

export type AuthMessageType =
  (typeof AUTH_MESSAGE_TYPES)[keyof typeof AUTH_MESSAGE_TYPES];

export interface AuthReadyMessage {
  type: typeof AUTH_MESSAGE_TYPES.READY;
}

export interface AuthSetTokenMessage {
  type: typeof AUTH_MESSAGE_TYPES.SET_TOKEN;
  token: string;
}

export interface AuthSuccessMessage {
  type: typeof AUTH_MESSAGE_TYPES.SUCCESS;
}

export interface AuthFailureMessage {
  type: typeof AUTH_MESSAGE_TYPES.FAILURE;
  reason?: string;
}

function normalizeOrigin(origin: string): string {
  try {
    const url = new URL(origin);
    return url.origin;
  } catch {
    return origin.replace(/\/+$/, '');
  }
}

export function parseAllowedParentOrigins(raw: string | undefined): string[] {
  if (!raw?.trim()) return [];
  return raw
    .split(',')
    .map((o) => normalizeOrigin(o.trim()))
    .filter(Boolean);
}

/** True when running inside another window (typical iframe embed). */
export function isEmbedded(): boolean {
  try {
    return window.parent !== window;
  } catch {
    return true;
  }
}

/**
 * Tell the parent the iframe is ready for a token.
 * Target is '*' because a cross-origin iframe cannot read parent.location.
 * The parent must verify event.origin matches this app's origin before replying.
 */
export function notifyParentAuthReady(): void {
  if (!isEmbedded()) return;
  const message: AuthReadyMessage = { type: AUTH_MESSAGE_TYPES.READY };
  window.parent.postMessage(message, '*');
}

export function notifyParentAuthSuccess(parentOrigin: string): void {
  if (!isEmbedded()) return;
  const message: AuthSuccessMessage = { type: AUTH_MESSAGE_TYPES.SUCCESS };
  window.parent.postMessage(message, parentOrigin);
}

export function notifyParentAuthFailure(
  parentOrigin: string,
  reason?: string
): void {
  if (!isEmbedded()) return;
  const message: AuthFailureMessage = {
    type: AUTH_MESSAGE_TYPES.FAILURE,
    reason,
  };
  window.parent.postMessage(message, parentOrigin);
}

export function isAuthSetTokenMessage(
  data: unknown
): data is AuthSetTokenMessage {
  if (!data || typeof data !== 'object') return false;
  const msg = data as Record<string, unknown>;
  return (
    msg.type === AUTH_MESSAGE_TYPES.SET_TOKEN &&
    typeof msg.token === 'string' &&
    msg.token.length > 0
  );
}