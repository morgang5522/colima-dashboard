# Security

colima-dashboard can stop VMs, change their resources and read container logs, so a flaw in it can matter.

## Reporting a vulnerability

Please report it privately through [GitHub's private vulnerability reporting](https://github.com/morgang5522/colima-dashboard/security/advisories/new) rather than in a public issue. Include what's affected, how to reproduce it and the impact you expect. You should get a reply within a week.

## Scope and assumptions

- colima-dashboard is meant for a single user on their own machine or a trusted network. It serves plain HTTP; use a VPN or a TLS reverse proxy for anything wider.
- It listens on `127.0.0.1` by default. Listening on other interfaces is an explicit opt-in.
- Anyone signed in has roughly the power of the host user over Colima. There are no separate roles.

Issues in Colima, Lima or Docker themselves should go to those projects.
