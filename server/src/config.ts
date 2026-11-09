import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

export interface AppConfig {
  /** Address to listen on. Defaults to loopback; set 0.0.0.0 to allow other machines. */
  host: string;
  port: number;
  /** scrypt hash of the login password, "salt:hash" in hex. Empty means not set yet. */
  passwordHash: string;
  /** Secret used to sign session cookies. Generated on first run. */
  sessionSecret: string;
  /**
   * Colima profile run by `brew services` (always "default" when used), which must be
   * stopped and started through brew. "auto" detects it at startup; null means none.
   */
  brewServiceProfile: string | null;
  /** Where Colima keeps its profiles. */
  colimaHome: string;
}

/** The keys a user may put in config.json; anything missing falls back to defaults. */
export type StoredConfig = Partial<AppConfig>;

export const CONFIG_PATH =
  process.env.COLIMA_DASHBOARD_CONFIG ??
  join(process.env.XDG_CONFIG_HOME ?? join(homedir(), '.config'), 'colima-dashboard', 'config.json');

/**
 * Colima's own lookup: COLIMA_HOME, else ~/.colima, else $XDG_CONFIG_HOME/colima
 * (newer installs may use the XDG location).
 */
export function resolveColimaHome(env: NodeJS.ProcessEnv = process.env, exists = existsSync): string {
  if (env.COLIMA_HOME) return env.COLIMA_HOME;
  const legacy = join(homedir(), '.colima');
  const xdg = join(env.XDG_CONFIG_HOME ?? join(homedir(), '.config'), 'colima');
  if (exists(legacy)) return legacy;
  if (exists(xdg)) return xdg;
  return legacy;
}

export function defaults(env: NodeJS.ProcessEnv = process.env): Omit<AppConfig, 'sessionSecret'> {
  return {
    host: '127.0.0.1',
    port: 7171,
    passwordHash: '',
    brewServiceProfile: 'auto',
    colimaHome: resolveColimaHome(env),
  };
}

/** Environment variables override the file, which overrides defaults. */
export function resolveConfig(stored: StoredConfig, env: NodeJS.ProcessEnv = process.env): AppConfig {
  const merged = { ...defaults(env), ...stored } as AppConfig;
  if (env.COLIMA_DASHBOARD_HOST) merged.host = env.COLIMA_DASHBOARD_HOST;
  if (env.COLIMA_DASHBOARD_PORT) merged.port = Number(env.COLIMA_DASHBOARD_PORT);
  if (!Number.isInteger(merged.port) || merged.port < 1 || merged.port > 65535) {
    throw new Error(`Invalid port: ${merged.port}`);
  }
  return merged;
}

export function readStoredConfig(path = CONFIG_PATH): StoredConfig {
  return existsSync(path) ? (JSON.parse(readFileSync(path, 'utf8')) as StoredConfig) : {};
}

/** Merges changes into the file, keeping only keys that were explicitly stored. */
export function updateStoredConfig(changes: StoredConfig, path = CONFIG_PATH): StoredConfig {
  const next = { ...readStoredConfig(path), ...changes };
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  writeFileSync(path, JSON.stringify(next, null, 2) + '\n', { mode: 0o600 });
  chmodSync(path, 0o600);
  return next;
}

/** Loads the config, generating and saving a session secret on first run. */
export function loadConfig(path = CONFIG_PATH): AppConfig {
  let stored = readStoredConfig(path);
  if (!stored.sessionSecret) {
    stored = updateStoredConfig({ sessionSecret: randomBytes(32).toString('hex') }, path);
  }
  return resolveConfig(stored);
}

/** Shared by the CLI and the web form. */
export const MIN_PASSWORD_LENGTH = 8;

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, 64);
  return `${salt.toString('hex')}:${hash.toString('hex')}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [saltHex, hashHex] = stored.split(':');
  if (!saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, 'hex');
  const actual = scryptSync(password, Buffer.from(saltHex, 'hex'), expected.length);
  return timingSafeEqual(actual, expected);
}

export function isLoopback(host: string): boolean {
  return host === 'localhost' || host === '::1' || host.startsWith('127.');
}
