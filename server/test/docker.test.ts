import { describe, expect, it } from 'vitest';
import { groupByProject, LogDemuxer, toSummary } from '../src/docker.ts';

const raw = (name: string, state: string, labels: Record<string, string> = {}) => ({
  Id: `${name}-id`,
  Names: [`/${name}`],
  Image: 'img',
  State: state,
  Status: state === 'running' ? 'Up 2 hours' : 'Exited (0)',
  Created: 1,
  Ports: [
    { IP: '0.0.0.0', PrivatePort: 5432, PublicPort: 55322, Type: 'tcp' },
    { IP: '::', PrivatePort: 5432, PublicPort: 55322, Type: 'tcp' },
    { PrivatePort: 8080, Type: 'tcp' },
  ],
  Labels: labels,
});

describe('toSummary', () => {
  it('strips the leading slash, dedupes IPv4/IPv6 ports and reads compose labels', () => {
    const s = toSummary(
      raw('db', 'running', {
        'com.docker.compose.project': 'shop',
        'com.docker.compose.service': 'db',
        'com.docker.compose.project.working_dir': '/x',
      }),
    );
    expect(s).toMatchObject({ name: 'db', project: 'shop', service: 'db', workingDir: '/x' });
    expect(s.ports).toEqual(['8080/tcp', '55322->5432/tcp']);
  });
});

describe('groupByProject', () => {
  it('groups by compose project, counts running and puts standalone last', () => {
    const groups = groupByProject(
      [
        raw('lone', 'running'),
        raw('b-web', 'exited', { 'com.docker.compose.project': 'b', 'com.docker.compose.service': 'web' }),
        raw('b-db', 'running', { 'com.docker.compose.project': 'b', 'com.docker.compose.service': 'db' }),
        raw('a-x', 'running', { 'com.docker.compose.project': 'a' }),
      ].map(toSummary),
    );
    expect(groups.map((g) => g.project)).toEqual(['a', 'b', null]);
    expect(groups[1]).toMatchObject({ running: 1, total: 2 });
    expect(groups[1]!.containers.map((c) => c.service)).toEqual(['db', 'web']);
  });
});

describe('LogDemuxer', () => {
  const frame = (stream: number, text: string) => {
    const payload = Buffer.from(text);
    const header = Buffer.alloc(8);
    header[0] = stream;
    header.writeUInt32BE(payload.length, 4);
    return Buffer.concat([header, payload]);
  };

  it('joins frames, including ones split across chunks', () => {
    const all = Buffer.concat([frame(1, 'hello\n'), frame(2, 'oops\n'), frame(1, 'bye\n')]);
    const d = new LogDemuxer();
    const out = d.push(all.subarray(0, 5)) + d.push(all.subarray(5, 20)) + d.push(all.subarray(20));
    expect(out).toBe('hello\noops\nbye\n');
  });
});
