import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { DockerClient } from './docker.ts';
import type { Runner, StreamRunner } from './exec.ts';

const GiB = 1024 ** 3;

export interface VmSettings {
  cpu: number;
  /** GiB */
  memory: number;
  /** GiB */
  disk: number;
}

export interface Profile {
  name: string;
  status: string;
  running: boolean;
  arch: string;
  runtime: string;
  address: string;
  /** What the VM is running with now (from `colima list`). */
  current: VmSettings;
  /** What colima.yaml says; applied on the next full stop + start. Null if the file can't be read. */
  configured: VmSettings | null;
  /** Configured settings differ from what's running, so a restart is needed. */
  pendingRestart: boolean;
  /** Started and stopped through `brew services` rather than plain colima. */
  brewManaged: boolean;
  dockerSocket: string;
}

interface ColimaListEntry {
  name: string;
  status: string;
  arch?: string;
  cpus?: number;
  memory?: number;
  disk?: number;
  runtime?: string;
  address?: string;
}

/** `colima list --json` prints one JSON object per line. */
export function parseColimaList(output: string): ColimaListEntry[] {
  return output
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => JSON.parse(l) as ColimaListEntry);
}

const SETTING_KEYS = { cpu: 'cpu', memory: 'memory', disk: 'disk' } as const;

/** Reads the top-level cpu/memory/disk keys from colima.yaml. */
export function readSettings(yaml: string): VmSettings | null {
  const read = (key: string) => {
    const m = yaml.match(new RegExp(`^${key}:\\s*([0-9.]+)\\s*(?:#.*)?$`, 'm'));
    return m ? Number(m[1]) : NaN;
  };
  const s = { cpu: read('cpu'), memory: read('memory'), disk: read('disk') };
  return Object.values(s).some(Number.isNaN) ? null : s;
}

/**
 * Rewrites the top-level cpu/memory/disk keys in colima.yaml, leaving every other
 * line (including comments) untouched. Missing keys are appended.
 */
export function writeSettings(yaml: string, settings: VmSettings): string {
  let out = yaml;
  for (const key of Object.keys(SETTING_KEYS) as (keyof VmSettings)[]) {
    const re = new RegExp(`^${key}:.*$`, 'm');
    const line = `${key}: ${settings[key]}`;
    out = re.test(out) ? out.replace(re, line) : `${out.replace(/\n?$/, '\n')}${line}\n`;
  }
  return out;
}

export interface HostLimits {
  cpus: number;
  memoryGiB: number;
}

/** Returns a list of problems; empty means the settings are acceptable. */
export function validateSettings(next: VmSettings, configured: VmSettings | null, host: HostLimits): string[] {
  const errors: string[] = [];
  if (!Number.isInteger(next.cpu) || next.cpu < 1 || next.cpu > host.cpus) {
    errors.push(`CPUs must be a whole number from 1 to ${host.cpus}.`);
  }
  const maxMem = Math.max(1, host.memoryGiB - 4);
  if (!(next.memory >= 1) || next.memory > maxMem || (next.memory * 2) % 1 !== 0) {
    errors.push(`Memory must be 1 to ${maxMem} GiB, in steps of 0.5 (leave the host at least 4 GiB).`);
  }
  if (!Number.isInteger(next.disk) || next.disk < 10 || next.disk > 2048) {
    errors.push('Disk must be a whole number of GiB, at least 10.');
  } else if (configured && next.disk < configured.disk) {
    errors.push(`Disk can't shrink (currently ${configured.disk} GiB).`);
  }
  return errors;
}

export function sameSettings(a: VmSettings, b: VmSettings): boolean {
  return a.cpu === b.cpu && a.memory === b.memory && a.disk === b.disk;
}

export type LifecycleAction = 'start' | 'stop' | 'restart';

export interface Step {
  label: string;
  cmd: string;
  args: string[];
  /** Keep going if this step fails (e.g. stopping something already stopped). */
  allowFailure?: boolean;
}

/**
 * Commands for a lifecycle action. The brew-managed profile runs as a launchd agent
 * with KeepAlive, so a plain `colima stop` would be relaunched straight away: it has
 * to be stopped and started through `brew services`.
 */
export function lifecycleSteps(profile: string, action: LifecycleAction, brewManaged: boolean): Step[] {
  const stop: Step[] = brewManaged
    ? [
        { label: 'Stop the brew service', cmd: 'brew', args: ['services', 'stop', 'colima'], allowFailure: true },
        {
          label: 'Make sure the VM is stopped',
          cmd: 'colima',
          args: ['stop', '--profile', profile],
          allowFailure: true,
        },
      ]
    : [{ label: 'Stop the VM', cmd: 'colima', args: ['stop', '--profile', profile] }];
  const start: Step[] = brewManaged
    ? [{ label: 'Start the brew service', cmd: 'brew', args: ['services', 'start', 'colima'] }]
    : // --activate=false keeps the user's current Docker context instead of switching to this profile.
      [{ label: 'Start the VM', cmd: 'colima', args: ['start', '--profile', profile, '--activate=false'] }];
  if (action === 'stop') return stop;
  if (action === 'start') return start;
  return [...stop, ...start];
}

/**
 * Works out whether `brew services` runs Colima. Brew's service always starts the
 * "default" profile. Returns null when brew or the service isn't there.
 */
export async function detectBrewServiceProfile(runCmd: Runner): Promise<string | null> {
  const res = await runCmd('brew', ['services', 'info', 'colima', '--json']);
  if (res.code !== 0) return null;
  try {
    const [info] = JSON.parse(res.stdout) as Array<{ registered?: boolean; loaded?: boolean; running?: boolean }>;
    return info && (info.registered || info.loaded || info.running) ? 'default' : null;
  } catch {
    return null;
  }
}

export interface ColimaOptions {
  run: Runner;
  colimaHome: string;
  /** Profile managed by `brew services`, or null. */
  brewServiceProfile: string | null;
  /** Checks the Docker socket answers; defaults to pinging the Engine API. */
  dockerReady?: (socketPath: string) => Promise<boolean>;
}

export class Colima {
  private readonly runCmd: Runner;
  private readonly colimaHome: string;
  private readonly brewServiceProfile: string | null;
  private readonly dockerReadyCheck: (socketPath: string) => Promise<boolean>;

  constructor(opts: ColimaOptions) {
    this.runCmd = opts.run;
    this.colimaHome = opts.colimaHome;
    this.brewServiceProfile = opts.brewServiceProfile;
    this.dockerReadyCheck = opts.dockerReady ?? ((socket) => new DockerClient(socket).ping());
  }

  configPath(profile: string): string {
    return join(this.colimaHome, profile, 'colima.yaml');
  }

  dockerSocket(profile: string): string {
    return join(this.colimaHome, profile, 'docker.sock');
  }

  isBrewManaged(profile: string): boolean {
    return profile === this.brewServiceProfile;
  }

  async listProfiles(): Promise<Profile[]> {
    const res = await this.runCmd('colima', ['list', '--json']);
    if (res.code !== 0) throw new Error(`colima list failed: ${res.stderr.trim() || res.stdout.trim()}`);
    const entries = parseColimaList(res.stdout);
    return Promise.all(entries.map((e) => this.toProfile(e)));
  }

  async getProfile(name: string): Promise<Profile | undefined> {
    return (await this.listProfiles()).find((p) => p.name === name);
  }

  async readConfigured(profile: string): Promise<VmSettings | null> {
    try {
      return readSettings(await readFile(this.configPath(profile), 'utf8'));
    } catch {
      return null;
    }
  }

  async saveSettings(profile: string, settings: VmSettings): Promise<void> {
    const path = this.configPath(profile);
    const yaml = await readFile(path, 'utf8');
    await writeFile(path, writeSettings(yaml, settings));
  }

  /** Runs the lifecycle steps, then waits for the VM to report the expected state. */
  async runLifecycle(profile: string, action: LifecycleAction, stream: StreamRunner, log: (l: string) => void) {
    for (const step of lifecycleSteps(profile, action, this.isBrewManaged(profile))) {
      log(`$ ${step.cmd} ${step.args.join(' ')}`);
      const code = await stream(step.cmd, step.args, log);
      if (code !== 0) {
        if (!step.allowFailure) throw new Error(`${step.label} failed (exit ${code})`);
        log(`(${step.label.toLowerCase()} exited ${code}, carrying on)`);
      }
    }
    await this.waitFor(profile, action !== 'stop', log);
  }

  private async waitFor(profile: string, running: boolean, log: (l: string) => void, timeoutMs = 300_000) {
    const want = running ? 'Running' : 'Stopped';
    const deadline = Date.now() + timeoutMs;
    let announced = false;
    while (Date.now() < deadline) {
      const p = await this.getProfile(profile).catch(() => undefined);
      // A profile that has never been created may be missing from the list once stopped.
      const ready = !running || p?.runtime !== 'docker' || (await this.dockerReadyCheck(this.dockerSocket(profile)));
      if ((p?.status ?? 'Stopped') === want && ready) {
        log(`Profile ${profile} is ${want.toLowerCase()}.`);
        return;
      }
      if (!announced) {
        log(`Waiting for ${profile} to be ${want.toLowerCase()}...`);
        announced = true;
      }
      await new Promise((r) => setTimeout(r, 2000));
    }
    throw new Error(`Timed out waiting for ${profile} to be ${want.toLowerCase()}`);
  }

  private async toProfile(e: ColimaListEntry): Promise<Profile> {
    const current: VmSettings = {
      cpu: e.cpus ?? 0,
      memory: round((e.memory ?? 0) / GiB),
      disk: round((e.disk ?? 0) / GiB),
    };
    const configured = await this.readConfigured(e.name);
    const running = e.status === 'Running';
    return {
      name: e.name,
      status: e.status,
      running,
      arch: e.arch ?? '',
      runtime: e.runtime ?? '',
      address: e.address ?? '',
      current,
      configured,
      pendingRestart: running && configured !== null && !sameSettings(current, configured),
      brewManaged: this.isBrewManaged(e.name),
      dockerSocket: this.dockerSocket(e.name),
    };
  }
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}
