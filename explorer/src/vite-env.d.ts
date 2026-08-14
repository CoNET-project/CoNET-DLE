/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_DLE_ARCHIVE_URL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
