import { serve } from '@hono/node-server';
import { getConnInfo } from '@hono/node-server/conninfo';
import { serveStatic } from '@hono/node-server/serve-static';
import { existsSync, readFileSync } from 'node:fs';
import { cpus, totalmem } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from './app.ts';
import { Colima, detectBrewServiceProfile } from './colima.ts';
import { CONFIG_PATH, isLoopback, loadConfig, updateStoredConfig } from './config.ts';
import { DockerClient } from './docker.ts';
import { run, runStreaming } from './exec.ts';
import { JobRunner } from './jobs.ts';

const config = loadConfig();

// brew removes its launchd plist on `brew services stop`, so once the service is
// detected it's remembered in the config; otherwise the UI couldn't start it again.
let brewServiceProfile = config.brewServiceProfile;
if (brewServiceProfile === 'auto') {
  brewServiceProfile = await detectBrewServiceProfile(run);
  if (brewServiceProfile) {
    updateStoredConfig({ brewServiceProfile });
    console.log(`Colima profile "${brewServiceProfile}" is run by brew services; saved to ${CONFIG_PATH}.`);
  }
}

const colima = new Colima({ run, colimaHome: config.colimaHome, brewServiceProfile });

const app = createApp({
  config,
  colima,
  jobs: new JobRunner(),
  stream: runStreaming,
  docker: (profile) => new DockerClient(colima.dockerSocket(profile)),
  host: { cpus: cpus().length, memoryGiB: Math.round(totalmem() / 1024 ** 3) },
  clientAddress: (c) => getConnInfo(c).remote.address ?? 'unknown',
});

// The built React app; any non-API path falls back to index.html.
const webDist = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'web', 'dist');
if (existsSync(webDist)) {
  app.use('/*', serveStatic({ root: webDist }));
  const index = readFileSync(join(webDist, 'index.html'), 'utf8');
  app.get('*', (c) => (c.req.path.startsWith('/api/') ? c.json({ error: 'Not found' }, 404) : c.html(index)));
} else {
  app.get('/', (c) => c.text('UI not built yet. Run `npm run build`.'));
}

serve({ fetch: app.fetch, hostname: config.host, port: config.port }, (info) => {
  console.log(`colima-dashboard listening on http://${info.address}:${info.port} (config: ${CONFIG_PATH})`);
  if (!config.passwordHash) console.log('No password set yet: run `npm run set-password`, then restart.');
  if (!isLoopback(config.host))
    console.log(`Listening on ${config.host}: reachable from other machines on your network.`);
});
