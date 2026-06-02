/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_MAINTENANCE_MODE?: string;
  readonly VITE_ALLOWED_PARENT_ORIGINS?: string;
  readonly VITE_EMBED_AUTH_TIMEOUT_MS?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
