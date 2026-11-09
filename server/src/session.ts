import { createHmac, timingSafeEqual } from 'node:crypto';

export const SESSION_COOKIE = 'colima_dashboard_session';
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/** Session token: "<expiresAtMs>.<hmac>". Stateless, so it survives server restarts. */
export function createSessionToken(secret: string, now = Date.now()): string {
  const expires = String(now + SESSION_TTL_MS);
  return `${expires}.${sign(expires, secret)}`;
}

export function isValidSessionToken(token: string | undefined, secret: string, now = Date.now()): boolean {
  if (!token) return false;
  const [expires, mac] = token.split('.');
  if (!expires || !mac || !/^\d+$/.test(expires)) return false;
  if (Number(expires) < now) return false;
  const expected = Buffer.from(sign(expires, secret));
  const actual = Buffer.from(mac);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

function sign(value: string, secret: string): string {
  return createHmac('sha256', secret).update(value).digest('hex');
}

/** Simple fixed-window limiter for login attempts, keyed by client address. */
export class LoginLimiter {
  private attempts = new Map<string, { count: number; windowStart: number }>();
  private readonly max: number;
  private readonly windowMs: number;

  constructor(max = 5, windowMs = 60_000) {
    this.max = max;
    this.windowMs = windowMs;
  }

  /** Records an attempt and returns false when the key is over the limit. */
  allow(key: string, now = Date.now()): boolean {
    const entry = this.attempts.get(key);
    if (!entry || now - entry.windowStart >= this.windowMs) {
      this.attempts.set(key, { count: 1, windowStart: now });
      return true;
    }
    entry.count += 1;
    return entry.count <= this.max;
  }

  reset(key: string): void {
    this.attempts.delete(key);
  }
}
