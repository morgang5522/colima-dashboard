# colima-dashboard

[![CI](https://github.com/morgang5522/colima-dashboard/actions/workflows/ci.yml/badge.svg)](https://github.com/morgang5522/colima-dashboard/actions/workflows/ci.yml)

A small, self-hosted web UI for [Colima](https://github.com/abiosoft/colima). It runs on the host next to Colima, not inside the VM, so as well as managing containers it can start and stop the VMs themselves and change their CPU, memory and disk.

Web dashboards such as Portainer or Dockge run as containers inside the VM, so they can't do that. Most Colima apps are desktop apps, so you can only use them at that machine. colima-dashboard is a web page, so you can also reach it from another machine or your phone. That's handy when Colima runs on a headless Mac mini.

> colima-dashboard is an independent project and isn't affiliated with Colima.

## Features

- **VMs (Colima profiles):** status, start, stop, restart. Edit CPUs, memory and disk; the changes go into the profile's `colima.yaml` and take effect after a full stop and start. You can save and restart in one go, or save now and restart later; the UI flags a VM whose saved settings are waiting for a restart. Disk can grow but not shrink.
- **Containers:** list, start, stop, restart and follow logs live, grouped by Docker Compose project, with start/stop/restart for a whole project.
- **Works with `brew services`:** if Colima is started at login by Homebrew, colima-dashboard stops and starts it through `brew services`, so launchd doesn't immediately restart a VM you stopped.
- Password login, light and dark themes, usable on a phone.
- Light: one Node process (around 90 MB RSS), nothing running inside your VMs.

Long VM operations run in the background and their output is shown live, so you can watch a restart happen.

## Requirements

- macOS with Colima 0.10 or later. Linux should work but hasn't been tested; see [Linux](#linux).
- Node.js 24 or later (it runs TypeScript directly with Node's built-in type stripping).
- Container views need a profile using the `docker` runtime. VMs using containerd or Incus can still be started, stopped and resized.

## Install (macOS)

```bash
git clone https://github.com/morgang5522/colima-dashboard.git
cd colima-dashboard
./scripts/install-launchd.sh
```

The script installs dependencies, builds the UI, asks you to choose a password if you haven't set one, and installs a launchd agent (`local.colima-dashboard`) that starts at login and restarts if it crashes. Then open <http://localhost:7171>.

- Logs: `~/Library/Logs/colima-dashboard.log`
- Restart: `launchctl kickstart -k gui/$(id -u)/local.colima-dashboard`
- Update: `git pull && ./scripts/install-launchd.sh`
- Uninstall: `./scripts/uninstall-launchd.sh` (keeps your config)

To try it without installing anything permanent:

```bash
npm install && npm run build
npm run set-password
npm start
```

## Using it from another machine

By default colima-dashboard only listens on `127.0.0.1`. To reach it from elsewhere on your network, set `"host": "0.0.0.0"` in the config (see below) and restart. Then open `http://<your-mac's-name>.local:7171`.

Anyone who can reach the port can try to sign in, and once signed in can stop your VMs and read container logs. Only do this on a network you trust. It serves plain HTTP; if you need it beyond your LAN, put it behind a VPN such as Tailscale, or behind a reverse proxy with TLS.

If the macOS firewall is on, it will drop connections to Homebrew's `node` (which isn't signed), so allow it:

```bash
NODE_BIN="$(readlink -f "$(which node)")"
sudo /usr/libexec/ApplicationFirewall/socketfilterfw --add "$NODE_BIN"
sudo /usr/libexec/ApplicationFirewall/socketfilterfw --unblockapp "$NODE_BIN"
```

The path includes Node's version, so do it again after upgrading Node.

## Configuration

Settings live in `~/.config/colima-dashboard/config.json` (or `$XDG_CONFIG_HOME/colima-dashboard/config.json`, or the path in `COLIMA_DASHBOARD_CONFIG`). The file is created on first run with mode 0600. Every key is optional:

| Key                  | Default             | Notes                                                                                                                 |
| -------------------- | ------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `host`               | `127.0.0.1`         | `0.0.0.0` to listen on all interfaces. Env: `COLIMA_DASHBOARD_HOST`                                                   |
| `port`               | `7171`              | Env: `COLIMA_DASHBOARD_PORT`                                                                                          |
| `passwordHash`       |                     | Set with `npm run set-password`                                                                                       |
| `sessionSecret`      | generated           | Signs session cookies. Delete it and restart to sign everyone out                                                     |
| `brewServiceProfile` | `"auto"`            | Profile run by `brew services` (always `default`). `"auto"` detects it on startup and saves it; `null` turns this off |
| `colimaHome`         | Colima's own lookup | `COLIMA_HOME`, else `~/.colima`, else `~/.config/colima`                                                              |

Change the password from the key icon in the dashboard's header; that signs out every other browser. If you've lost it, run `npm run set-password` on the host (or `npm run set-password -- --random` to generate one), then restart colima-dashboard.

## How it works

- **VMs** are managed with the `colima` CLI (`colima list --json`, `colima start`, `colima stop`), so it needs `colima` on the `PATH` (Homebrew's locations are added automatically). Other profiles are started with `--activate=false`, so starting one doesn't switch your current Docker context.
- **The `brew services` profile** runs as a launchd agent with `KeepAlive`, which would relaunch it straight after a plain `colima stop`. colima-dashboard stops it with `brew services stop colima` followed by `colima stop`, and starts it with `brew services start colima`. Brew deletes its launchd file on stop, so colima-dashboard remembers the profile in its config once it has detected it.
- **Settings** are applied by rewriting the top-level `cpu`, `memory` and `disk` keys in the profile's `colima.yaml`, leaving comments and everything else as they were.
- **Containers** come from the Docker Engine API over the profile's `docker.sock`; no Docker CLI is needed.
- One VM operation runs at a time per profile; others are refused until it finishes.

## Security

- Password hashed with scrypt; sessions are signed, `HttpOnly`, `SameSite=Strict` cookies that last 30 days.
- 5 login attempts per minute per address.
- Every state-changing request must carry an `x-colima-dashboard: 1` header, which a cross-site form can't send.
- colima-dashboard can stop VMs and read container logs (which may contain secrets), so treat access to it like shell access to the host.

See [SECURITY.md](SECURITY.md) to report a vulnerability.

## Linux

Not tested yet. It should work with Colima on Linux, run as your user. A systemd user unit along these lines:

```ini
# ~/.config/systemd/user/colima-dashboard.service
[Unit]
Description=colima-dashboard

[Service]
WorkingDirectory=%h/colima-dashboard
ExecStart=/usr/bin/node server/src/index.ts
Restart=on-failure

[Install]
WantedBy=default.target
```

Then `systemctl --user enable --now colima-dashboard`. Reports of how it goes are welcome.

## Development

See [CONTRIBUTING.md](CONTRIBUTING.md).

## Licence

[MIT](LICENSE)
