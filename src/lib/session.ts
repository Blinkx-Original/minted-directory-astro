import { createHmac, timingSafeEqual } from 'node:crypto';
import type { AstroCookies } from 'astro';

const SESSION_COOKIE = 'admin_session';
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days

interface AdminSession {
  isAdmin: true;
}

function getSecret(): string {
  const secret = import.meta.env.ADMIN_PASSWORD;
  if (!secret) {
    throw new Error('ADMIN_PASSWORD env var is not set.');
  }

  return secret;
}

function signPayload(payload: string): string {
  const secret = getSecret();
  return createHmac('sha256', secret).update(payload).digest('base64url');
}

function encodeSession(data: AdminSession): string {
  const payload = JSON.stringify(data);
  const signature = signPayload(payload);
  const combined = `${payload}.${signature}`;
  return Buffer.from(combined, 'utf8').toString('base64url');
}

function decodeSession(raw: string): AdminSession | null {
  try {
    const decoded = Buffer.from(raw, 'base64url').toString('utf8');
    const separator = decoded.lastIndexOf('.');
    if (separator === -1) {
      return null;
    }

    const payload = decoded.slice(0, separator);
    const providedSignature = decoded.slice(separator + 1);
    const expectedSignature = signPayload(payload);

    const providedBuffer = Buffer.from(providedSignature, 'utf8');
    const expectedBuffer = Buffer.from(expectedSignature, 'utf8');

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

export function setAdminSession(cookies: AstroCookies): void {
  const value = encodeSession({ isAdmin: true });
  cookies.set(SESSION_COOKIE, value, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: Boolean(import.meta.env.PROD),
    maxAge: SESSION_TTL_SECONDS,
  });
}

export function getAdminSession(cookies: AstroCookies): AdminSession | null {
  const cookie = cookies.get(SESSION_COOKIE);
  if (!cookie?.value) {
    return null;
  }

  return decodeSession(cookie.value);
}

export function clearAdminSession(cookies: AstroCookies): void {
  cookies.delete(SESSION_COOKIE, { path: '/' });
}
