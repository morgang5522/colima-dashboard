import { describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isLoopback, loadConfig, resolveColimaHome, resolveConfig, updateStoredConfig } from '../src/config.ts';

describe('resolveConfig', () => {
  it('defaults to loopback with brew detection on', () => {
    expect(resolveConfig({}, {})).toMatchObject({ host: '127.0.0.1', port: 7171, brewServiceProfile: 'auto' });
  });

  it('lets env override the file', () => {
    expect(
      resolveConfig({ host: '0.0.0.0', port: 1 }, { COLIMA_DASHBOARD_HOST: '::1', COLIMA_DASHBOARD_PORT: '8080' }),
    ).toMatchObject({
      host: '::1',
      port: 8080,
    });
  });

  it('rejects a bad port', () => {
    expect(() => resolveConfig({}, { COLIMA_DASHBOARD_PORT: 'abc' })).toThrow(/Invalid port/);
  });
});

describe('resolveColimaHome', () => {
  it('prefers COLIMA_HOME, then ~/.colima, then the XDG folder', () => {
    expect(resolveColimaHome({ COLIMA_HOME: '/x' }, () => false)).toBe('/x');
    expect(resolveColimaHome({ XDG_CONFIG_HOME: '/cfg' }, (p) => String(p) === '/cfg/colima')).toBe('/cfg/colima');
    expect(resolveColimaHome({ XDG_CONFIG_HOME: '/cfg' }, () => true)).toMatch(/\.colima$/);
  });
});

describe('stored config', () => {
  it('creates a 0600 file with only a session secret, then merges updates', () => {
    const path = join(mkdtempSync(join(tmpdir(), 'cui-cfg-')), 'sub', 'config.json');
    const first = loadConfig(path);
    expect(first.sessionSecret).toMatch(/^[0-9a-f]{64}$/);
    expect(Object.keys(JSON.parse(readFileSync(path, 'utf8')))).toEqual(['sessionSecret']);
    expect(statSync(path).mode & 0o777).toBe(0o600);
    updateStoredConfig({ passwordHash: 'h' }, path);
    expect(loadConfig(path)).toMatchObject({ sessionSecret: first.sessionSecret, passwordHash: 'h' });
  });
});

describe('isLoopback', () => {
  it('spots loopback addresses', () => {
    expect(['127.0.0.1', '::1', 'localhost'].every(isLoopback)).toBe(true);
    expect(['0.0.0.0', '::', '192.168.1.2'].some(isLoopback)).toBe(false);
  });
});
