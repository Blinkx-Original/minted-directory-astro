import { S3Client } from '@aws-sdk/client-s3';

interface R2Config {
  accountId: string;
  bucket: string;
  endpoint: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle: boolean;
}

let client: S3Client | null = null;
let cachedConfig: R2Config | null = null;

function ensureConfig(): R2Config {
  if (cachedConfig) {
    return cachedConfig;
  }

  const accountId = import.meta.env.R2_ACCOUNT_ID;
  const bucket = import.meta.env.R2_BUCKET;
  const endpoint = import.meta.env.R2_S3_ENDPOINT;
  const accessKeyId = import.meta.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = import.meta.env.R2_SECRET_ACCESS_KEY;
  const forcePathStyle = (import.meta.env.R2_S3_FORCE_PATH_STYLE ?? '').toLowerCase() === 'true';

  if (!accountId || !bucket || !endpoint || !accessKeyId || !secretAccessKey) {
    throw new Error('Missing R2 environment variables.');
  }

  cachedConfig = {
    accountId,
    bucket,
    endpoint,
    accessKeyId,
    secretAccessKey,
    forcePathStyle,
  };

  return cachedConfig;
}

export function getR2Client(): S3Client {
  if (client) {
    return client;
  }

  const config = ensureConfig();

  client = new S3Client({
    region: 'auto',
    endpoint: config.endpoint,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
    forcePathStyle: config.forcePathStyle,
  });

  return client;
}

export function getR2Bucket(): string {
  return ensureConfig().bucket;
}
