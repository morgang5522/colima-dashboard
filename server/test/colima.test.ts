import { describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  Colima,
  detectBrewServiceProfile,
  lifecycleSteps,
  parseColimaList,
  readSettings,
  validateSettings,
  writeSettings,
} from '../src/colima.ts';
import type { Runner } from '../src/exec.ts';

const YAML = `# CPUs to allocate
cpu: 4

# Disk size in GiB
disk: 60
# Memory in GiB
memory: 6 # comment
arch: aarch64
kubernetes:
  enabled: false
  cpu: 99
`;

describe('colima.yaml settings', () => {
  it('reads only the top-level keys', () => {
    expect(readSettings(YAML)).toEqual({ cpu: 4, memory: 6, disk: 60 });
  });

  it('returns null when a key is missing', () => {
    expect(readSettings('cpu: 2\nmemory: 2\n')).toBeNull();
  });

  it('rewrites values and keeps comments and nested keys', () => {
    const out = writeSettings(YAML, { cpu: 6, memory: 7.5, disk: 80 });
    expect(readSettings(out)).toEqual({ cpu: 6, memory: 7.5, disk: 80 });
    expect(out).toContain('# CPUs to allocate');
    expect(out).toContain('  cpu: 99');
    expect(out.split('\n')).toHaveLength(YAML.split('\n').length);
  });

  it('appends keys that are missing', () => {
    expect(readSettings(writeSettings('arch: aarch64', { cpu: 2, memory: 2, disk: 60 }))).toEqual({
      cpu: 2,
      memory: 2,
      disk: 60,
    });
  });
});

describe('validateSettings', () => {
  const host = { cpus: 12, memoryGiB: 16 };
  const configured = { cpu: 4, memory: 6, disk: 60 };

  it('accepts sensible values', () => {
    expect(validateSettings({ cpu: 6, memory: 8.5, disk: 80 }, configured, host)).toEqual([]);
  });

  it('rejects too many CPUs, too much memory and odd memory steps', () => {
    expect(validateSettings({ cpu: 13, memory: 6, disk: 60 }, configured, host)).toHaveLength(1);
    expect(validateSettings({ cpu: 4, memory: 13, disk: 60 }, configured, host)).toHaveLength(1);
    expect(validateSettings({ cpu: 4, memory: 6.3, disk: 60 }, configured, host)).toHaveLength(1);
    expect(validateSettings({ cpu: 1.5, memory: 6, disk: 60 }, configured, host)).toHaveLength(1);
  });

  it('refuses to shrink the disk', () => {
    expect(validateSettings({ cpu: 4, memory: 6, disk: 50 }, configured, host)[0]).toMatch(/can't shrink/);
  });

  it('rejects NaN', () => {
    expect(validateSettings({ cpu: NaN, memory: NaN, disk: NaN }, configured, host)).toHaveLength(3);
  });
});

describe('lifecycleSteps', () => {
  it('uses brew services for the brew-managed profile', () => {
    const steps = lifecycleSteps('default', 'restart', true);
    expect(steps.map((s) => [s.cmd, ...s.args].join(' '))).toEqual([
      'brew services stop colima',
      'colima stop --profile default',
      'brew services start colima',
    ]);
  });

  it('uses colima directly for other profiles', () => {
    expect(lifecycleSteps('test', 'start', false).map((s) => [s.cmd, ...s.args].join(' '))).toEqual([
      'colima start --profile test --activate=false',
    ]);
    expect(lifecycleSteps('test', 'stop', false).map((s) => [s.cmd, ...s.args].join(' '))).toEqual([
      'colima stop --profile test',
    ]);
  });
});

describe('detectBrewServiceProfile', () => {
  const reply =
    (code: number, stdout: string): Runner =>
    async () => ({ code, stdout, stderr: '' });

  it('returns default when brew has the service registered, even if stopped', async () => {
    expect(
      await detectBrewServiceProfile(reply(0, JSON.stringify([{ name: 'colima', registered: true, running: false }]))),
    ).toBe('default');
  });

  it('returns null when brew is missing, errors or has no service', async () => {
    expect(await detectBrewServiceProfile(reply(127, ''))).toBeNull();
    expect(await detectBrewServiceProfile(reply(0, 'not json'))).toBeNull();
    expect(
      await detectBrewServiceProfile(
        reply(0, JSON.stringify([{ name: 'colima', registered: false, loaded: false, running: false }])),
      ),
    ).toBeNull();
  });
});

describe('Colima', () => {
  const GiB = 1024 ** 3;
  const listOutput =
    JSON.stringify({
      name: 'default',
      status: 'Running',
      arch: 'aarch64',
      cpus: 4,
      memory: 6 * GiB,
      disk: 60 * GiB,
      runtime: 'docker',
    }) +
    '\n' +
    JSON.stringify({
      name: 'spare',
      status: 'Stopped',
      arch: 'aarch64',
      cpus: 2,
      memory: 2 * GiB,
      disk: 20 * GiB,
      runtime: 'docker',
    }) +
    '\n';

  function setup(defaultYaml: string) {
    const home = mkdtempSync(join(tmpdir(), 'colima-dashboard-'));
    mkdirSync(join(home, 'default'));
    writeFileSync(join(home, 'default', 'colima.yaml'), defaultYaml);
    const runner: Runner = async (cmd, args) =>
      cmd === 'colima' && args[0] === 'list'
        ? { code: 0, stdout: listOutput, stderr: '' }
        : { code: 1, stdout: '', stderr: 'nope' };
    return {
      home,
      colima: new Colima({
        run: runner,
        colimaHome: home,
        brewServiceProfile: 'default',
        dockerReady: async () => true,
      }),
    };
  }

  it('parses one JSON object per line', () => {
    expect(parseColimaList(listOutput).map((e) => e.name)).toEqual(['default', 'spare']);
  });

  it('lists profiles and flags a pending restart when colima.yaml differs', async () => {
    const { colima } = setup('cpu: 6\nmemory: 6\ndisk: 60\n');
    const [def, spare] = await colima.listProfiles();
    expect(def).toMatchObject({
      name: 'default',
      running: true,
      brewManaged: true,
      current: { cpu: 4, memory: 6, disk: 60 },
      configured: { cpu: 6, memory: 6, disk: 60 },
      pendingRestart: true,
    });
    expect(spare).toMatchObject({
      name: 'spare',
      running: false,
      brewManaged: false,
      configured: null,
      pendingRestart: false,
    });
  });

  it('saves settings into colima.yaml', async () => {
    const { home, colima } = setup(YAML);
    await colima.saveSettings('default', { cpu: 5, memory: 5, disk: 64 });
    expect(readSettings(readFileSync(join(home, 'default', 'colima.yaml'), 'utf8'))).toEqual({
      cpu: 5,
      memory: 5,
      disk: 64,
    });
  });
});
