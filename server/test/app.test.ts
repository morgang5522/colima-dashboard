import { describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp, CSRF_HEADER } from '../src/app.ts';
import { Colima, readSettings } from '../src/colima.ts';
import { hashPassword, resolveConfig, type StoredConfig } from '../src/config.ts';
import type { DockerClient } from '../src/docker.ts';
import { toSummary } from '../src/docker.ts';
import type { Runner } from '../src/exec.ts';
import { JobRunner } from '../src/jobs.ts';

const GiB = 1024 ** 3;

function setup(runtime = 'docker') {
  const home = mkdtempSync(join(tmpdir(), 'colima-dashboard-app-'));
  mkdirSync(join(home, 'default'));
  writeFileSync(join(home, 'default', 'colima.yaml'), 'cpu: 4\nmemory: 6\ndisk: 60\n');
  let status = 'Running';
  const runner: Runner = async (cmd, args) => {
    if (cmd === 'colima' && args[0] === 'list') {
      const entry = { name: 'default', status, arch: 'aarch64', cpus: 4, memory: 6 * GiB, disk: 60 * GiB, runtime };
      return { code: 0, stdout: JSON.stringify(entry) + '\n', stderr: '' };
    }
    if (cmd === 'docker') return { code: 0, stdout: 'id', stderr: '' };
    return { code: 1, stdout: '', stderr: '' };
  };
  const commands: string[] = [];
  let release: () => void = () => {};
  const gate = new Promise<void>((r) => (release = r));
  const stream = async (cmd: string, args: string[], onLine: (l: string) => void) => {
    commands.push([cmd, ...args].join(' '));
    await gate;
    if (args.includes('stop')) status = 'Stopped';
    if (args.includes('start')) status = 'Running';
    onLine('ok');
    return 0;
  };
  const actions: string[] = [];
  const docker = {
    listContainers: async () => [
      toSummary({
        Id: 'c1',
        Names: ['/web'],
        Image: 'i',
        State: 'running',
        Status: 'Up',
        Created: 1,
        Labels: { 'com.docker.compose.project': 'p' },
      }),
      toSummary({
        Id: 'c2',
        Names: ['/db'],
        Image: 'i',
        State: 'exited',
        Status: 'Exited',
        Created: 1,
        Labels: { 'com.docker.compose.project': 'p' },
      }),
    ],
    containerAction: async (id: string, action: string) => {
      actions.push(`${id}:${action}`);
    },
  } as unknown as DockerClient;
  const config = resolveConfig(
    { sessionSecret: 'test-secret', colimaHome: home, passwordHash: hashPassword('let-me-in-please') },
    {},
  );
  const jobs = new JobRunner();
  const saved: StoredConfig[] = [];
  const app = createApp({
    config,
    colima: new Colima({ run: runner, colimaHome: home, brewServiceProfile: 'default', dockerReady: async () => true }),
    jobs,
    stream,
    docker: () => docker,
    host: { cpus: 12, memoryGiB: 16 },
    clientAddress: () => '127.0.0.1',
    saveConfig: (changes) => saved.push(changes),
  });
  return { app, home, commands, actions, jobs, release, saved };
}

async function login(app: ReturnType<typeof setup>['app'], password = 'let-me-in-please') {
  const res = await app.request('/api/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json', [CSRF_HEADER]: '1' },
    body: JSON.stringify({ password }),
  });
  expect(res.status).toBe(200);
  const cookie = res.headers.get('set-cookie')!.split(';')[0]!;
  return { cookie, [CSRF_HEADER]: '1', 'content-type': 'application/json' };
}

describe('auth', () => {
  it('rejects API calls without a session', async () => {
    const { app } = setup();
    expect((await app.request('/api/profiles')).status).toBe(401);
  });

  it('rejects a wrong password and rate limits', async () => {
    const { app } = setup();
    const attempt = () =>
      app.request('/api/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json', [CSRF_HEADER]: '1' },
        body: JSON.stringify({ password: 'nope' }),
      });
    const statuses = [];
    for (let i = 0; i < 6; i++) statuses.push((await attempt()).status);
    expect(statuses).toEqual([401, 401, 401, 401, 401, 429]);
  });

  it('requires the CSRF header on changes', async () => {
    const { app } = setup();
    const { cookie } = await login(app);
    const res = await app.request('/api/profiles/default/vm/stop', { method: 'POST', headers: { cookie } });
    expect(res.status).toBe(403);
  });
});

describe('change password', () => {
  const change = (app: ReturnType<typeof setup>['app'], headers: Record<string, string>, body: object) =>
    app.request('/api/password', { method: 'POST', headers, body: JSON.stringify(body) });

  it('rejects a wrong current password, a short one and an unchanged one', async () => {
    const { app, saved } = setup();
    const headers = await login(app);
    const wrong = await change(app, headers, { current: 'nope', next: 'a-new-password' });
    expect(wrong.status).toBe(400);
    expect(await wrong.json()).toMatchObject({ field: 'current' });
    const short = await change(app, headers, { current: 'let-me-in-please', next: 'short' });
    expect(await short.json()).toMatchObject({ field: 'next' });
    const same = await change(app, headers, { current: 'let-me-in-please', next: 'let-me-in-please' });
    expect(same.status).toBe(400);
    expect(saved).toEqual([]);
  });

  it('needs a session and the CSRF header', async () => {
    const { app } = setup();
    const { cookie } = await login(app);
    expect((await change(app, {}, { current: 'let-me-in-please', next: 'a-new-password' })).status).toBe(401);
    expect((await change(app, { cookie }, { current: 'let-me-in-please', next: 'a-new-password' })).status).toBe(403);
  });

  it('saves the new password, signs out other sessions and keeps this one', async () => {
    const { app, saved } = setup();
    const other = await login(app);
    const headers = await login(app);
    const res = await change(app, headers, { current: 'let-me-in-please', next: 'a-new-password' });
    expect(res.status).toBe(200);
    expect(saved).toHaveLength(1);
    expect(Object.keys(saved[0]!).sort()).toEqual(['passwordHash', 'sessionSecret']);

    const fresh = res.headers.get('set-cookie')!.split(';')[0]!;
    expect((await app.request('/api/profiles', { headers: { cookie: fresh } })).status).toBe(200);
    expect((await app.request('/api/profiles', { headers: other })).status).toBe(401);

    const oldLogin = await app.request('/api/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json', [CSRF_HEADER]: '1' },
      body: JSON.stringify({ password: 'let-me-in-please' }),
    });
    expect(oldLogin.status).toBe(401);
    await login(app, 'a-new-password');
  });
});

describe('profiles', () => {
  it('lists profiles once signed in', async () => {
    const { app } = setup();
    const headers = await login(app);
    const body = (await (await app.request('/api/profiles', { headers })).json()) as Array<{
      name: string;
      brewManaged: boolean;
    }>;
    expect(body).toMatchObject([{ name: 'default', brewManaged: true, job: null }]);
  });

  it('runs a restart through brew services and refuses a second job meanwhile', async () => {
    const { app, commands, jobs, release } = setup();
    const headers = await login(app);
    const first = await app.request('/api/profiles/default/vm/restart', { method: 'POST', headers });
    expect(first.status).toBe(202);
    const second = await app.request('/api/profiles/default/vm/stop', { method: 'POST', headers });
    expect(second.status).toBe(409);
    release();
    const { job } = (await first.json()) as { job: { id: string } };
    await jobs.get(job.id)!.done;
    expect(jobs.get(job.id)!.status).toBe('succeeded');
    expect(commands).toEqual([
      'brew services stop colima',
      'colima stop --profile default',
      'brew services start colima',
    ]);
  });

  it('404s for an unknown profile and 400s for a bad name', async () => {
    const { app } = setup();
    const headers = await login(app);
    expect((await app.request('/api/profiles/nope/vm/start', { method: 'POST', headers })).status).toBe(404);
    expect((await app.request('/api/profiles/..%2Fx/vm/start', { method: 'POST', headers })).status).toBe(400);
  });

  it('validates and saves settings without restarting when asked not to', async () => {
    const { app, home, commands } = setup();
    const headers = await login(app);
    const bad = await app.request('/api/profiles/default/settings', {
      method: 'PUT',
      headers,
      body: JSON.stringify({ cpu: 4, memory: 6, disk: 40 }),
    });
    expect(bad.status).toBe(400);
    const ok = await app.request('/api/profiles/default/settings', {
      method: 'PUT',
      headers,
      body: JSON.stringify({ cpu: 6, memory: 8, disk: 80, restart: false }),
    });
    expect(await ok.json()).toEqual({ saved: true, job: null });
    expect(readSettings(readFileSync(join(home, 'default', 'colima.yaml'), 'utf8'))).toEqual({
      cpu: 6,
      memory: 8,
      disk: 80,
    });
    expect(commands).toEqual([]);
    const profiles = (await (await app.request('/api/profiles', { headers })).json()) as Array<{
      pendingRestart: boolean;
    }>;
    expect(profiles[0]!.pendingRestart).toBe(true);
  });
});

describe('containers', () => {
  it('container and project actions never touch the VM', async () => {
    const { app, actions, commands, jobs } = setup();
    const headers = await login(app);
    for (const action of ['start', 'stop', 'restart']) {
      expect(
        (await app.request(`/api/profiles/default/containers/c1/${action}`, { method: 'POST', headers })).status,
      ).toBe(200);
      expect(
        (await app.request(`/api/profiles/default/projects/p/${action}`, { method: 'POST', headers })).status,
      ).toBe(200);
    }
    expect(commands).toEqual([]);
    expect(jobs.list()).toEqual([]);
    expect(actions).toContain('c1:stop');
  });

  it('rejects unknown actions and empty ids', async () => {
    const { app, commands, jobs } = setup();
    const headers = await login(app);
    expect((await app.request('/api/profiles/default/containers/c1/kill', { method: 'POST', headers })).status).toBe(
      400,
    );
    expect((await app.request('/api/profiles/default/projects/p/remove', { method: 'POST', headers })).status).toBe(
      400,
    );
    expect((await app.request('/api/profiles/default/vm/delete', { method: 'POST', headers })).status).toBe(400);
    expect((await app.request('/api/profiles/default/containers//stop', { method: 'POST', headers })).status).toBe(404);
    expect((await app.request('/api/profiles/default/stop', { method: 'POST', headers })).status).toBe(404);
    expect(commands).toEqual([]);
    expect(jobs.list()).toEqual([]);
  });

  it('groups containers by project', async () => {
    const { app } = setup();
    const headers = await login(app);
    const groups = (await (await app.request('/api/profiles/default/containers', { headers })).json()) as Array<{
      project: string;
      total: number;
    }>;
    expect(groups).toMatchObject([{ project: 'p', total: 2, running: 1 }]);
  });

  it('explains that containers need the docker runtime', async () => {
    const { app } = setup('containerd');
    const headers = await login(app);
    const res = await app.request('/api/profiles/default/containers', { headers });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toMatch(/docker runtime/);
  });

  it('starts only the stopped containers of a project', async () => {
    const { app, actions } = setup();
    const headers = await login(app);
    const res = await app.request('/api/profiles/default/projects/p/start', { method: 'POST', headers });
    expect(await res.json()).toEqual({ ok: true, count: 1 });
    expect(actions).toEqual(['c2:start']);
  });
});
