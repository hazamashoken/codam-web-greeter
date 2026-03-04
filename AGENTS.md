# AGENTS.md

## Purpose
This repository contains a web greeter theme (`client/` + `static/`) and a supporting campus config API (`server/`) plus systemd automation (`systemd/`).

Use this file as the default operating guide for coding agents working in this repo.

## High-level architecture
- `client/`: TypeScript UI runtime for login/lock/exam screens.
- `static/`: HTML/CSS/assets and `settings.ini` consumed by the greeter.
- `server/`: Express + TypeScript API integrating with Intra via `@codam/fast42`.
- `systemd/`: install/uninstall scripts, timers/services, fetcher/locker/idler/exam automation.
- `Makefile`: main build/install entrypoints.

Runtime flow (simplified):
1. Server serves `/api/config/:hostname?`.
2. systemd fetcher writes `data.json` locally.
3. Client polls `data.json` and renders login/lock/exam state.

## Fast project map
- Frontend entry: `client/main.ts`
- UI controller: `client/ui.ts`
- Auth bridge: `client/auth.ts`
- Data polling/parsing: `client/data.ts`
- Server entry: `server/src/server.ts`
- Server routes/cache: `server/src/routes.ts`
- Intra calls: `server/src/intra.ts`
- Utility + hostname/IP logic: `server/src/utils.ts`
- Deployment proxy: `server/configs/nginx.conf`

## Working commands
- Root build: `npm run build` (runs `make build`).
- Direct build: `make build`.
- Server build: `npm run --prefix server build`.
- Server start: `npm run --prefix server start`.
- Docker stack (server): `make server`.

Notes:
- `make install` and many scripts under `systemd/` require root and affect host services.
- Avoid running install/uninstall/restart scripts unless explicitly requested.

## Agent workflow (recommended)
1. Identify target layer first: `client`, `server`, `systemd`, or build tooling.
2. Keep changes minimal and scoped to one layer when possible.
3. For cross-layer changes, update contract assumptions in both `server` and `client`.
4. Validate locally with the smallest relevant command set.
5. Document behavior-impacting changes in `README.md` (and `server/README.md` when server-specific).

## Validation checklist
For client changes:
- Build passes: `npm run build`.
- Validate login/lock/exam flow behavior using `static/index.html` or greeter debug path.

For server changes:
- Build passes: `npm run --prefix server build`.
- Start server and sanity-check `/` and `/api/config/:hostname?`.

For systemd/script changes:
- Shell syntax check (`bash -n <script>` where possible).
- Confirm non-interactive failure handling and timeouts for network commands.

## Current risk hotspots (prioritize caution)
- API exposure relies heavily on network perimeter controls.
- `x-forwarded-for` and hostname/IP derivation paths need hardening.
- Intra initialization/retry/readiness handling is fragile.
- systemd exam scripts can trigger forced reboot logic.
- Client has fragile form semantics and data contract assumptions.
- Build/deploy path has reproducibility issues (Dockerfile naming mismatch, permissive packaging).

## Coding guidelines for this repo
- Prefer explicit, typed contracts for server->client payloads.
- Avoid adding new global state on `window` in client code.
- Keep shell scripts defensive: `set -euo pipefail`, use command timeouts, validate prerequisites.
- For deployment configs, pin versions/tags where practical.
- Do not introduce secrets into client-side code or committed config.

## Definition of done
A change is done when:
1. Relevant build commands pass.
2. Impacted runtime path is manually sanity-checked.
3. Docs are updated for operator-facing changes.
4. No new unsafe operational behavior is introduced in `systemd/` scripts.
