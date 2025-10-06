/// <reference path="../.astro/types.d.ts" />

interface ImportMetaEnv {
  readonly MODE: string;
  readonly PROD: boolean;
  readonly DEV: boolean;
  readonly ADMIN_PASSWORD: string;
  readonly R2_ACCOUNT_ID: string;
  readonly R2_BUCKET: string;
  readonly R2_S3_ENDPOINT: string;
  readonly R2_ACCESS_KEY_ID: string;
  readonly R2_SECRET_ACCESS_KEY: string;
  readonly R2_S3_FORCE_PATH_STYLE?: string;
  readonly TYPESENSE_HOST?: string;
  readonly TYPESENSE_API_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}