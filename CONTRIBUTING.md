# Contributing

Thanks for helping. Bug reports, fixes and small features are all welcome. For anything big, open an issue first so we can agree the approach.

## Setup

You need Node 24 or later. To try changes against real VMs you also need Colima.

```bash
npm install
npm test            # unit and API tests (vitest); no Colima needed
npm run typecheck
npm run format      # Prettier
npm run check       # everything CI runs: typecheck, format check, tests, build
```

Run it locally with a separate config, so you don't disturb an installed copy:

```bash
echo '{"port": 7172}' > /tmp/colima-dashboard-dev.json
COLIMA_DASHBOARD_CONFIG=/tmp/colima-dashboard-dev.json npm run set-password
COLIMA_DASHBOARD_CONFIG=/tmp/colima-dashboard-dev.json npm run dev:server   # API, restarts on change
npm run dev:web                                                # Vite on :5173
```

`dev:web` proxies `/api` to port 7171. If your dev server uses another port, change the proxy in `vite.config.ts` while you work.

## Testing against Colima

Use a throwaway profile rather than one you depend on:

```bash
colima start --profile scratch --cpu 1 --memory 1 --disk 10 --activate=false
# ...try start, stop, restart and settings changes in the UI...
colima delete --profile scratch --force
```

Changes to how the `brew services` profile is stopped and started need care, because getting them wrong takes someone's main VM down. Cover them with tests in `server/test/colima.test.ts`, and say in the PR whether you tried them on a real brew-managed VM.

## Layout

| Path                   | What                                                                   |
| ---------------------- | ---------------------------------------------------------------------- |
| `server/src/index.ts`  | Entry point: loads config, detects the brew service, serves API and UI |
| `server/src/app.ts`    | HTTP routes (Hono), auth and CSRF checks                               |
| `server/src/colima.ts` | `colima` CLI wrapper, `colima.yaml` editing, start/stop steps          |
| `server/src/docker.ts` | Docker Engine API client over the unix socket, log stream demuxing     |
| `server/src/jobs.ts`   | Background runner for long VM operations                               |
| `server/src/config.ts` | Config file, defaults, password hashing                                |
| `server/test/`         | Vitest tests; the API tests use fakes, not real Colima                 |
| `web/src/`             | React UI                                                               |
| `scripts/`             | launchd install and uninstall                                          |

## Guidelines

- Keep it small: no new runtime dependencies without a good reason.
- Add or update tests with behaviour changes, especially anything that runs `colima` or `brew`.
- The server runs `.ts` files directly with Node's type stripping, so stick to erasable TypeScript: no enums, namespaces or constructor parameter properties (`tsc` enforces this via `erasableSyntaxOnly`), and use `.ts` extensions in imports.
- Run `npm run check` before opening a PR.

By contributing you agree your work is released under the [MIT licence](LICENSE).
