import { createHash, createHmac } from 'node:crypto';

type HttpMethod = 'GET' | 'PUT' | 'DELETE';

interface R2Config {
  accountId: string;
  bucket: string;
  endpoint: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle: boolean;
}

interface RequestOptions {
  method: HttpMethod;
  key?: string;
  query?: Record<string, string>;
  body?: string | Buffer | Uint8Array;
  headers?: Record<string, string>;
}

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

function encodeRfc3986(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
}

function hashSha256(value: Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

function createSigningKey(secret: string, dateStamp: string): Buffer {
  const kDate = createHmac('sha256', `AWS4${secret}`).update(dateStamp).digest();
  const kRegion = createHmac('sha256', kDate).update('auto').digest();
  const kService = createHmac('sha256', kRegion).update('s3').digest();
  return createHmac('sha256', kService).update('aws4_request').digest();
}

function normaliseEndpoint(endpoint: string): string {
  return endpoint.replace(/\/$/, '');
}

function buildCanonicalQuery(query: Record<string, string> | undefined): string {
  if (!query) {
    return '';
  }

  const parts = Object.entries(query).map(([name, value]) => [encodeRfc3986(name), encodeRfc3986(value)] as const);
  parts.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));

  return parts.map(([name, value]) => `${name}=${value}`).join('&');
}

function encodeKey(key: string | undefined): string {
  if (!key) {
    return '';
  }

  return key
    .split('/')
    .map((segment) => encodeRfc3986(segment))
    .join('/');
}

function formatAmzDate(date: Date): string {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

async function signedFetch(options: RequestOptions): Promise<Response> {
  const config = ensureConfig();
  const method = options.method.toUpperCase() as HttpMethod;
  const endpoint = new URL(normaliseEndpoint(config.endpoint));
  const encodedKey = encodeKey(options.key);

  let canonicalUri: string;
  if (config.forcePathStyle) {
    canonicalUri = `/${encodeRfc3986(config.bucket)}${encodedKey ? `/${encodedKey}` : ''}`;
    endpoint.pathname = canonicalUri;
  } else {
    endpoint.hostname = `${config.bucket}.${endpoint.hostname}`;
    canonicalUri = encodedKey ? `/${encodedKey}` : '/';
    endpoint.pathname = canonicalUri;
  }

  const canonicalQuery = buildCanonicalQuery(options.query);
  endpoint.search = canonicalQuery;

  const bodyBuffer = (() => {
    if (!options.body) {
      return Buffer.alloc(0);
    }

    if (Buffer.isBuffer(options.body)) {
      return options.body;
    }

    if (options.body instanceof Uint8Array) {
      return Buffer.from(options.body);
    }

    return Buffer.from(options.body);
  })();

  const payloadHash = hashSha256(bodyBuffer);
  const now = new Date();
  const amzDate = formatAmzDate(now);
  const dateStamp = amzDate.slice(0, 8);
  const credentialScope = `${dateStamp}/auto/s3/aws4_request`;

  const additionalHeaders = options.headers ?? {};
  const canonicalHeaders: Record<string, string> = {
    host: endpoint.host,
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': amzDate,
  };

  for (const [name, value] of Object.entries(additionalHeaders)) {
    canonicalHeaders[name.toLowerCase()] = value;
  }

  const sortedHeaderNames = Object.keys(canonicalHeaders).sort();
  const canonicalHeadersString = sortedHeaderNames
    .map((name) => `${name}:${canonicalHeaders[name].toString().trim().replace(/\s+/g, ' ')}`)
    .join('\n') + '\n';
  const signedHeaders = sortedHeaderNames.join(';');

  const canonicalRequest = [
    method,
    canonicalUri,
    canonicalQuery,
    canonicalHeadersString,
    signedHeaders,
    payloadHash,
  ].join('\n');

  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    credentialScope,
    hashSha256(Buffer.from(canonicalRequest)),
  ].join('\n');

  const signingKey = createSigningKey(config.secretAccessKey, dateStamp);
  const signature = createHmac('sha256', signingKey).update(stringToSign).digest('hex');
  const authorization = `AWS4-HMAC-SHA256 Credential=${config.accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  const requestHeaders: Record<string, string> = {
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': amzDate,
    Authorization: authorization,
  };

  for (const [name, value] of Object.entries(additionalHeaders)) {
    requestHeaders[name] = value;
  }

  const response = await fetch(endpoint.toString(), {
    method,
    headers: requestHeaders,
    body: bodyBuffer.length > 0 ? bodyBuffer : undefined,
  });

  if (!response.ok) {
    let message = `HTTP ${response.status}`;
    try {
      const text = await response.text();
      if (text) {
        message = text.slice(0, 200);
      }
    } catch {
      // ignore body read errors
    }

    throw new Error(message || response.statusText || 'Request failed');
  }

  return response;
}

export async function listR2Diagnostics(prefix: string, maxKeys = 1): Promise<void> {
  await signedFetch({
    method: 'GET',
    query: {
      'list-type': '2',
      prefix,
      'max-keys': String(maxKeys),
    },
  });
}

export async function putR2Object(key: string, body: string, contentType: string): Promise<void> {
  await signedFetch({
    method: 'PUT',
    key,
    body,
    headers: {
      'Content-Type': contentType,
      'Content-Length': Buffer.byteLength(body).toString(),
    },
  });
}

export async function getR2ObjectBody(key: string): Promise<string> {
  const response = await signedFetch({
    method: 'GET',
    key,
  });
  return response.text();
}

export async function deleteR2Object(key: string): Promise<void> {
  await signedFetch({
    method: 'DELETE',
    key,
  });
}

export function getR2Bucket(): string {
  return ensureConfig().bucket;
}
