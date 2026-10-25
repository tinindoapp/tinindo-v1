/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_APP_ENV?: "local" | "staging" | "production";
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_PUBLISHABLE_KEY?: string;
}

/** Commit e branch do build (vite.config.ts). */
declare const __TININDO_BUILD__: { commit: string; branch: string; built_at: string };
