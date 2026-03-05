/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_PERPLY_ARENA_ADDRESS?: string;
  readonly VITE_PYTH_BTC_PRICE_ID?: string;
  readonly VITE_CHAINLINK_BTC_USD_FEED?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
