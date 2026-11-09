# Changelog

All notable changes are listed here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- Manage Colima profiles: status, start, stop, restart, and CPU, memory and disk settings applied on a full restart.
- Containers grouped by Compose project, with start, stop, restart and live logs, per container and per project.
- `brew services` support: detects the Homebrew-managed profile and stops and starts it through brew.
- Password login with signed session cookies, login rate limiting and a CSRF header check.
- macOS launchd install and uninstall scripts.
