import { createHmac, timingSafeEqual } from 'node:crypto';
import type { AstroCookies } from 'astro';

const SESSION_COOKIE = 'admin_session';
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days

interface AdminSession {
  isAdmin: true;
}

function readSecret(): string | undefined {
  const secret = typeof process !== 'undefined' ? process.env.ADMIN_PASSWORD : undefined;
  const fallback = import.meta.env.ADMIN_PASSWORD;
  const value = secret ?? fallback;

  if (!value || value.length === 0) {
    return undefined;
  }

  return value;
}

function toBase64Url(value: Buffer | string): string {
  const buffer = typeof value === 'string' ? Buffer.from(value, 'utf8') : value;
  return buffer
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/u, '');
}

function fromBase64Url(value: string): Buffer {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const paddingLength = (4 - (normalized.length % 4)) % 4;
  const padded = normalized + '='.repeat(paddingLength);
  return Buffer.from(padded, 'base64');
}

function signPayload(payload: string, secret: string): string {
  const digest = createHmac('sha256', secret).update(payload).digest();
  return toBase64Url(digest);
}

function encodeSession(data: AdminSession, secret: string): string {
  const payload = JSON.stringify(data);
  const signature = signPayload(payload, secret);
  const combined = `${payload}.${signature}`;
  return toBase64Url(combined);
}

function decodeSession(raw: string, secret: string | undefined): AdminSession | null {
  if (!secret) {
    return null;
  }

  try {
    const decoded = fromBase64Url(raw).toString('utf8');
    const separator = decoded.lastIndexOf('.');
    if (separator === -1) {
      return null;
    }

    const payload = decoded.slice(0, separator);
    const providedSignature = decoded.slice(separator + 1);
    const expectedSignature = signPayload(payload, secret);

    const providedBuffer = fromBase64Url(providedSignature);
    const expectedBuffer = fromBase64Url(expectedSignature);

    if (providedBuffer.length !== expectedBuffer.length) {
      return null;
    }

    if (!timingSafeEqual(providedBuffer, expectedBuffer)) {
      return null;
    }

    const parsed = JSON.parse(payload) as AdminSession;
    if (parsed?.isAdmin === true) {
      return { isAdmin: true };
    }
  } catch {
    return null;
  }

  return null;
}

export function isAdminSecretConfigured(): boolean {
  return Boolean(readSecret());
}

function constantTimeCompare(input: string, secret: string): boolean {
  const provided = Buffer.from(input, 'utf8');
  const expected = Buffer.from(secret, 'utf8');

  if (provided.length !== expected.length) {
    return false;
  }

  return timingSafeEqual(provided, expected);
}

export function verifyAdminPassword(candidate: unknown): boolean {
  if (typeof candidate !== 'string') {
    return false;
  }

  const secret = readSecret();
  if (!secret) {
    return false;
  }

  try {
    return constantTimeCompare(candidate, secret);
  } catch (err) {
    console.error('Failed to compare admin password securely.', err);
    return false;
  }
}

export function setAdminSession(cookies: AstroCookies): boolean {
  const secret = readSecret();
  if (!secret) {
    console.error('ADMIN_PASSWORD env var is not set; unable to establish admin session.');
    return false;
  }

  try {
    const value = encodeSession({ isAdmin: true }, secret);
    cookies.set(SESSION_COOKIE, value, {
      path: '/',
      httpOnly: true,
      sameSite: 'lax',
      secure: Boolean(import.meta.env.PROD),
      maxAge: SESSION_TTL_SECONDS,
    });

    return true;
  } catch (err) {
    console.error('Failed to encode admin session cookie.', err);
    return false;
  }
}

export function getAdminSession(cookies: AstroCookies): AdminSession | null {
  const cookie = cookies.get(SESSION_COOKIE);
  if (!cookie?.value) {
    return null;
  }

  return decodeSession(cookie.value, readSecret());
}

export function clearAdminSession(cookies: AstroCookies): void {
  cookies.delete(SESSION_COOKIE, { path: '/' });
}
