import { describe, expect, it } from 'vitest';
import { hashPassword, verifyPassword } from '../src/config.ts';
import { createSessionToken, isValidSessionToken, LoginLimiter, SESSION_TTL_MS } from '../src/session.ts';

describe('passwords', () => {
  it('verifies the right password only', () => {
    const h = hashPassword('correct horse');
    expect(verifyPassword('correct horse', h)).toBe(true);
    expect(verifyPassword('wrong', h)).toBe(false);
    expect(verifyPassword('x', 'garbage')).toBe(false);
  });
});

describe('session tokens', () => {
  it('accepts a fresh token and rejects tampered, expired or foreign ones', () => {
    const t = createSessionToken('s1', 1000);
    expect(isValidSessionToken(t, 's1', 2000)).toBe(true);
    expect(isValidSessionToken(t, 's2', 2000)).toBe(false);
    expect(isValidSessionToken(t, 's1', 1000 + SESSION_TTL_MS + 1)).toBe(false);
    const [exp, mac] = t.split('.');
    expect(isValidSessionToken(`${Number(exp) + 1}.${mac}`, 's1', 2000)).toBe(false);
    expect(isValidSessionToken(undefined, 's1')).toBe(false);
  });
});

describe('LoginLimiter', () => {
  it('blocks after the limit and resets after the window', () => {
    const l = new LoginLimiter(2, 1000);
    expect([l.allow('a', 0), l.allow('a', 1), l.allow('a', 2)]).toEqual([true, true, false]);
    expect(l.allow('b', 2)).toBe(true);
    expect(l.allow('a', 1001)).toBe(true);
  });
});
