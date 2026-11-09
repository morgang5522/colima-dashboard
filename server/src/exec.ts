import { spawn } from 'node:child_process';

export interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

/** Runs a command to completion and collects its output. */
export type Runner = (cmd: string, args: string[]) => Promise<RunResult>;

/** Runs a command, calling onLine for each line of stdout/stderr, and resolves with the exit code. */
export type StreamRunner = (cmd: string, args: string[], onLine: (line: string) => void) => Promise<number>;

const HOMEBREW_PATH = '/opt/homebrew/bin:/opt/homebrew/sbin:/usr/local/bin';

/** launchd gives agents a bare PATH, so make sure Homebrew's colima/brew/limactl are found. */
export function commandEnv(): NodeJS.ProcessEnv {
  const path = process.env.PATH ?? '/usr/bin:/bin:/usr/sbin:/sbin';
  return { ...process.env, PATH: `${HOMEBREW_PATH}:${path}`, NO_COLOR: '1' };
}

export const run: Runner = (cmd, args) =>
  new Promise((resolve) => {
    const child = spawn(cmd, args, { env: commandEnv() });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d: Buffer) => (stdout += d.toString()));
    child.stderr.on('data', (d: Buffer) => (stderr += d.toString()));
    child.on('error', (err) => resolve({ code: 127, stdout, stderr: stderr + err.message }));
    child.on('close', (code) => resolve({ code: code ?? 1, stdout, stderr }));
  });

export const runStreaming: StreamRunner = (cmd, args, onLine) =>
  new Promise((resolve) => {
    const child = spawn(cmd, args, { env: commandEnv(), stdio: ['ignore', 'pipe', 'pipe'] });
    const splitter = () => {
      let rest = '';
      return {
        push(chunk: Buffer) {
          rest += chunk.toString();
          const lines = rest.split(/\r?\n/);
          rest = lines.pop() ?? '';
          lines.forEach((l) => l && onLine(l));
        },
        flush() {
          if (rest) onLine(rest);
          rest = '';
        },
      };
    };
    const out = splitter();
    const err = splitter();
    child.stdout.on('data', (d: Buffer) => out.push(d));
    child.stderr.on('data', (d: Buffer) => err.push(d));
    child.on('error', (e) => {
      onLine(`failed to run ${cmd}: ${e.message}`);
      resolve(127);
    });
    child.on('close', (code) => {
      out.flush();
      err.flush();
      resolve(code ?? 1);
    });
  });
