import { Hono, type Context } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { streamSSE } from 'hono/streaming';
import type { AppConfig } from './config.ts';
import { verifyPassword } from './config.ts';
import { validateSettings, type Colima, type HostLimits, type LifecycleAction, type VmSettings } from './colima.ts';
import { DockerError, groupByProject, type ContainerAction, type DockerClient } from './docker.ts';
import type { StreamRunner } from './exec.ts';
import { JobConflictError, publicJob, type JobRunner } from './jobs.ts';
import { createSessionToken, isValidSessionToken, LoginLimiter, SESSION_COOKIE, SESSION_TTL_MS } from './session.ts';

export interface AppDeps {
  config: AppConfig;
  colima: Colima;
  jobs: JobRunner;
  stream: StreamRunner;
  docker: (profile: string) => DockerClient;
  host: HostLimits;
  /** Client address for login rate limiting. */
  clientAddress: (c: Context) => string;
}

/** Mutating requests must carry this header: a cross-site form can't set it. */
export const CSRF_HEADER = 'x-colima-dashboard';

const PROFILE_RE = /^[A-Za-z0-9][A-Za-z0-9_.-]*$/;
const LIFECYCLE: LifecycleAction[] = ['start', 'stop', 'restart'];
const CONTAINER_ACTIONS: ContainerAction[] = ['start', 'stop', 'restart'];

export function createApp(deps: AppDeps): Hono {
  const { config, colima, jobs, host } = deps;
  const limiter = new LoginLimiter();
  const app = new Hono();

  const authed = (c: Context) => isValidSessionToken(getCookie(c, SESSION_COOKIE), config.sessionSecret);

  app.get('/api/session', (c) => c.json({ authenticated: authed(c), passwordSet: Boolean(config.passwordHash) }));

  app.post('/api/login', async (c) => {
    if (c.req.header(CSRF_HEADER) !== '1') return c.json({ error: 'Missing header' }, 403);
    const ip = deps.clientAddress(c);
    if (!limiter.allow(ip)) return c.json({ error: 'Too many attempts. Try again in a minute.' }, 429);
    if (!config.passwordHash) {
      return c.json(
        {
          error:
            'No password set. Run `npm run set-password` in the colima-dashboard folder on the host, then restart colima-dashboard.',
        },
        503,
      );
    }
    const body = (await c.req.json().catch(() => ({}))) as { password?: unknown };
    if (typeof body.password !== 'string' || !verifyPassword(body.password, config.passwordHash)) {
      return c.json({ error: 'Wrong password.' }, 401);
    }
    limiter.reset(ip);
    setCookie(c, SESSION_COOKIE, createSessionToken(config.sessionSecret), {
      httpOnly: true,
      sameSite: 'Strict',
      path: '/',
      maxAge: SESSION_TTL_MS / 1000,
    });
    return c.json({ ok: true });
  });

  app.post('/api/logout', (c) => {
    deleteCookie(c, SESSION_COOKIE, { path: '/' });
    return c.json({ ok: true });
  });

  // Everything else under /api needs a session; changes also need the CSRF header.
  app.use('/api/*', async (c, next) => {
    if (!authed(c)) return c.json({ error: 'Not signed in' }, 401);
    if (c.req.method !== 'GET' && c.req.header(CSRF_HEADER) !== '1') {
      return c.json({ error: 'Missing header' }, 403);
    }
    await next();
  });

  const profileParam = (c: Context): string => {
    const name = c.req.param('profile') ?? '';
    if (!PROFILE_RE.test(name)) throw new HttpError(400, 'Bad profile name');
    return name;
  };

  const requireProfile = async (name: string) => {
    const profile = await colima.getProfile(name);
    if (!profile) throw new HttpError(404, `No Colima profile called ${name}`);
    return profile;
  };

  app.get('/api/host', (c) => c.json(host));

  app.get('/api/profiles', async (c) => {
    const profiles = await colima.listProfiles();
    return c.json(profiles.map((p) => ({ ...p, job: jobOrNull(jobs, p.name) })));
  });

  app.post('/api/profiles/:profile/vm/:action', async (c) => {
    const name = profileParam(c);
    const action = c.req.param('action') as LifecycleAction;
    if (!LIFECYCLE.includes(action)) throw new HttpError(400, 'Unknown action');
    await requireProfile(name);
    const job = jobs.start(name, `${capitalise(action)} ${name}`, (log) =>
      colima.runLifecycle(name, action, deps.stream, log),
    );
    return c.json({ job: publicJob(job) }, 202);
  });

  app.put('/api/profiles/:profile/settings', async (c) => {
    const name = profileParam(c);
    const profile = await requireProfile(name);
    const body = (await c.req.json().catch(() => ({}))) as Partial<VmSettings> & { restart?: boolean };
    const next: VmSettings = { cpu: Number(body.cpu), memory: Number(body.memory), disk: Number(body.disk) };
    const errors = validateSettings(next, profile.configured, host);
    if (errors.length) return c.json({ error: errors.join(' '), errors }, 400);
    const active = jobs.activeFor(name);
    if (active) throw new JobConflictError(active);
    await colima.saveSettings(name, next);
    if (!body.restart || !profile.running) return c.json({ saved: true, job: null });
    const job = jobs.start(name, `Apply settings to ${name}`, async (log) => {
      log(`Saved ${name}: ${next.cpu} CPUs, ${next.memory} GiB memory, ${next.disk} GiB disk. Restarting to apply.`);
      await colima.runLifecycle(name, 'restart', deps.stream, log);
    });
    return c.json({ saved: true, job: publicJob(job) }, 202);
  });

  app.get('/api/jobs', (c) => c.json(jobs.list().map(publicJob)));

  app.get('/api/jobs/:id', (c) => {
    const job = jobs.get(c.req.param('id'));
    return job ? c.json(publicJob(job)) : c.json({ error: 'No such job' }, 404);
  });

  /** The container views talk to the Docker Engine API, so need the docker runtime. */
  const requireDocker = async (name: string) => {
    const profile = await requireProfile(name);
    if (profile.runtime !== 'docker') {
      throw new HttpError(400, `Containers are only shown for the docker runtime (${name} uses ${profile.runtime}).`);
    }
  };

  app.get('/api/profiles/:profile/containers', async (c) => {
    const name = profileParam(c);
    await requireDocker(name);
    const containers = await deps.docker(name).listContainers();
    return c.json(groupByProject(containers));
  });

  app.post('/api/profiles/:profile/containers/:id/:action', async (c) => {
    const name = profileParam(c);
    const action = c.req.param('action') as ContainerAction;
    if (!CONTAINER_ACTIONS.includes(action)) throw new HttpError(400, 'Unknown action');
    await deps.docker(name).containerAction(c.req.param('id'), action);
    return c.json({ ok: true });
  });

  app.post('/api/profiles/:profile/projects/:project/:action', async (c) => {
    const name = profileParam(c);
    const project = c.req.param('project');
    const action = c.req.param('action') as ContainerAction;
    if (!CONTAINER_ACTIONS.includes(action)) throw new HttpError(400, 'Unknown action');
    const docker = deps.docker(name);
    const members = (await docker.listContainers()).filter((x) => x.project === project);
    if (!members.length) return c.json({ error: `No containers in project ${project}` }, 404);
    const targets = action === 'start' ? members.filter((m) => m.state !== 'running') : members;
    const results = await Promise.allSettled(targets.map((m) => docker.containerAction(m.id, action)));
    const failed = results.flatMap((r, i) =>
      r.status === 'rejected' ? [`${targets[i]!.name}: ${String(r.reason)}`] : [],
    );
    if (failed.length) return c.json({ error: failed.join('; ') }, 500);
    return c.json({ ok: true, count: targets.length });
  });

  app.get('/api/profiles/:profile/containers/:id/logs', (c) => {
    const name = profileParam(c);
    const id = c.req.param('id');
    const tail = Math.min(Math.max(Number(c.req.query('tail') ?? 300) || 300, 1), 5000);
    const follow = c.req.query('follow') !== '0';
    return streamSSE(c, async (sse) => {
      const abort = new AbortController();
      sse.onAbort(() => abort.abort());
      try {
        await deps.docker(name).streamLogs(
          id,
          { tail, follow },
          (text) => {
            void sse.writeSSE({ event: 'log', data: JSON.stringify(text) });
          },
          abort.signal,
        );
        if (!abort.signal.aborted) await sse.writeSSE({ event: 'end', data: '""' });
      } catch (err) {
        await sse.writeSSE({ event: 'error', data: JSON.stringify(err instanceof Error ? err.message : String(err)) });
      }
    });
  });

  app.onError((err, c) => {
    if (err instanceof HttpError) return c.json({ error: err.message }, err.status as 400);
    if (err instanceof JobConflictError) return c.json({ error: err.message, job: publicJob(err.job) }, 409);
    if (err instanceof DockerError) return c.json({ error: err.message }, err.status as 400);
    console.error(err);
    return c.json({ error: err instanceof Error ? err.message : 'Internal error' }, 500);
  });

  return app;
}

export class HttpError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

function jobOrNull(jobs: JobRunner, profile: string) {
  const job = jobs.activeFor(profile);
  return job ? publicJob(job) : null;
}

function capitalise(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
