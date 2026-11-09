export interface VmSettings {
  cpu: number;
  memory: number;
  disk: number;
}

export interface Job {
  id: string;
  profile: string;
  title: string;
  status: 'running' | 'succeeded' | 'failed';
  log: string[];
  error?: string;
  startedAt: number;
  endedAt?: number;
}

export interface Profile {
  name: string;
  status: string;
  running: boolean;
  arch: string;
  runtime: string;
  address: string;
  current: VmSettings;
  configured: VmSettings | null;
  pendingRestart: boolean;
  brewManaged: boolean;
  dockerSocket: string;
  job: Job | null;
}

export interface Container {
  id: string;
  name: string;
  image: string;
  state: string;
  status: string;
  ports: string[];
  project: string | null;
  service: string | null;
}

export interface ProjectGroup {
  project: string | null;
  workingDir: string | null;
  running: number;
  total: number;
  containers: Container[];
}

export interface Host {
  cpus: number;
  memoryGiB: number;
}

export class ApiError extends Error {
  status: number;
  /** Which form field the server blamed, when it says. */
  field?: string;
  constructor(status: number, message: string, field?: string) {
    super(message);
    this.status = status;
    this.field = field;
  }
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(path, {
    ...init,
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json', 'x-colima-dashboard': '1', ...(init.headers ?? {}) },
  });
  const body = (await res.json().catch(() => ({}))) as { error?: string; field?: string };
  if (!res.ok) {
    if (res.status === 401) window.dispatchEvent(new Event('colima-dashboard:signed-out'));
    throw new ApiError(res.status, body.error ?? `Request failed (${res.status})`, body.field);
  }
  return body as T;
}

export const post = <T>(path: string, body?: unknown) =>
  api<T>(path, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) });
