/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** "true" enables the in-browser mock backend (src/mock.ts). */
  readonly VITE_USE_MOCK?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
