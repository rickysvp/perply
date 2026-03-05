/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_PERPLY_ARENA_ADDRESS?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
