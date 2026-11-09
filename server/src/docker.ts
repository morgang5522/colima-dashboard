import http from 'node:http';

export interface ContainerSummary {
  id: string;
  name: string;
  image: string;
  state: string;
  status: string;
  created: number;
  ports: string[];
  /** Compose project, or null for standalone containers. */
  project: string | null;
  service: string | null;
  workingDir: string | null;
}

export interface ProjectGroup {
  /** Null for containers that aren't part of a compose project. */
  project: string | null;
  workingDir: string | null;
  running: number;
  total: number;
  containers: ContainerSummary[];
}

interface RawPort {
  IP?: string;
  PrivatePort: number;
  PublicPort?: number;
  Type: string;
}

interface RawContainer {
  Id: string;
  Names: string[];
  Image: string;
  State: string;
  Status: string;
  Created: number;
  Ports?: RawPort[];
  Labels?: Record<string, string>;
}

export class DockerError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export function toSummary(c: RawContainer): ContainerSummary {
  const labels = c.Labels ?? {};
  const ports = new Set<string>();
  for (const p of c.Ports ?? []) {
    // Docker lists IPv4 and IPv6 bindings separately; show each mapping once.
    ports.add(p.PublicPort ? `${p.PublicPort}->${p.PrivatePort}/${p.Type}` : `${p.PrivatePort}/${p.Type}`);
  }
  return {
    id: c.Id,
    name: (c.Names[0] ?? c.Id.slice(0, 12)).replace(/^\//, ''),
    image: c.Image,
    state: c.State,
    status: c.Status,
    created: c.Created,
    ports: [...ports].sort((a, b) => parseInt(a) - parseInt(b)),
    project: labels['com.docker.compose.project'] ?? null,
    service: labels['com.docker.compose.service'] ?? null,
    workingDir: labels['com.docker.compose.project.working_dir'] ?? null,
  };
}

/** Groups containers by compose project; standalone containers go last in a null group. */
export function groupByProject(containers: ContainerSummary[]): ProjectGroup[] {
  const groups = new Map<string | null, ProjectGroup>();
  for (const c of containers) {
    let g = groups.get(c.project);
    if (!g) {
      g = { project: c.project, workingDir: c.workingDir, running: 0, total: 0, containers: [] };
      groups.set(c.project, g);
    }
    g.containers.push(c);
    g.total += 1;
    if (c.state === 'running') g.running += 1;
  }
  for (const g of groups.values()) {
    g.containers.sort((a, b) => (a.service ?? a.name).localeCompare(b.service ?? b.name));
  }
  return [...groups.values()].sort((a, b) => {
    if (a.project === null) return 1;
    if (b.project === null) return -1;
    return a.project.localeCompare(b.project);
  });
}

/**
 * Splits Docker's multiplexed log stream (used when the container has no TTY) into
 * text. Each frame is an 8-byte header (stream type, 3 zero bytes, big-endian length)
 * followed by the payload; frames can be split across chunks.
 */
export class LogDemuxer {
  private buffer = Buffer.alloc(0);

  push(chunk: Buffer): string {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    let out = '';
    while (this.buffer.length >= 8) {
      const size = this.buffer.readUInt32BE(4);
      if (this.buffer.length < 8 + size) break;
      out += this.buffer.subarray(8, 8 + size).toString('utf8');
      this.buffer = this.buffer.subarray(8 + size);
    }
    return out;
  }
}

export type ContainerAction = 'start' | 'stop' | 'restart';

export class DockerClient {
  private readonly socketPath: string;

  constructor(socketPath: string) {
    this.socketPath = socketPath;
  }

  async ping(): Promise<boolean> {
    try {
      const res = await this.request('GET', '/_ping');
      res.resume();
      return res.statusCode === 200;
    } catch {
      return false;
    }
  }

  async listContainers(): Promise<ContainerSummary[]> {
    const raw = (await this.json('GET', '/containers/json?all=1')) as RawContainer[];
    return raw.map(toSummary);
  }

  async containerAction(id: string, action: ContainerAction): Promise<void> {
    // 304 means the container was already in the requested state.
    await this.json('POST', `/containers/${encodeURIComponent(id)}/${action}`, [204, 304]);
  }

  async inspect(id: string): Promise<{ Config: { Tty: boolean }; Name: string }> {
    return (await this.json('GET', `/containers/${encodeURIComponent(id)}/json`)) as {
      Config: { Tty: boolean };
      Name: string;
    };
  }

  /** Streams logs as text chunks until the signal aborts or the container stops. */
  async streamLogs(
    id: string,
    opts: { tail: number; follow: boolean },
    onText: (text: string) => void,
    signal: AbortSignal,
  ): Promise<void> {
    const { Config } = await this.inspect(id);
    const qs = `stdout=1&stderr=1&timestamps=1&tail=${opts.tail}&follow=${opts.follow ? 1 : 0}`;
    const res = await this.request('GET', `/containers/${encodeURIComponent(id)}/logs?${qs}`, signal);
    if (res.statusCode !== 200) throw new DockerError(res.statusCode ?? 500, await readBody(res));
    const demux = Config.Tty ? null : new LogDemuxer();
    await new Promise<void>((resolve, reject) => {
      res.on('data', (chunk: Buffer) => {
        const text = demux ? demux.push(chunk) : chunk.toString('utf8');
        if (text) onText(text);
      });
      res.on('end', resolve);
      res.on('error', (err) => (signal.aborted ? resolve() : reject(err)));
      signal.addEventListener('abort', () => {
        res.destroy();
        resolve();
      });
    });
  }

  private async json(method: string, path: string, okStatuses = [200]): Promise<unknown> {
    const res = await this.request(method, path);
    const body = await readBody(res);
    if (!okStatuses.includes(res.statusCode ?? 0)) {
      let message = body;
      try {
        message = (JSON.parse(body) as { message?: string }).message ?? body;
      } catch {
        /* not JSON */
      }
      throw new DockerError(res.statusCode ?? 500, message || `Docker returned ${res.statusCode}`);
    }
    return body ? JSON.parse(body) : null;
  }

  private request(method: string, path: string, signal?: AbortSignal): Promise<http.IncomingMessage> {
    return new Promise((resolve, reject) => {
      const req = http.request({ socketPath: this.socketPath, path, method, signal }, resolve);
      req.on('error', (err) => {
        const code = (err as NodeJS.ErrnoException).code;
        if (code === 'ENOENT' || code === 'ECONNREFUSED') {
          reject(new DockerError(503, 'Docker is not reachable. Is the VM running?'));
        } else reject(err);
      });
      req.end();
    });
  }
}

function readBody(res: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = '';
    res.on('data', (d: Buffer) => (data += d.toString()));
    res.on('end', () => resolve(data));
    res.on('error', reject);
  });
}
