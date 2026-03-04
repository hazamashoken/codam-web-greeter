# PLAN.md

## Objective
Improve reliability, security, and maintainability of the greeter stack (client + server + systemd/deploy) while keeping current behavior stable for campus operations.

## Prioritized roadmap

## Phase 0: Immediate fixes (1-3 days)
These are high-impact, low-effort tasks.

1. Fix Docker build path mismatch (`Dockerfile` vs `dockerfile`) in compose/CI.
- Impact: deployment reliability.
- Effort: S.
- Files: `server/docker-compose.yaml`, `.github/workflows/server-image.yml`, `server/dockerfile` (or rename).
- Success criteria: docker compose and CI image build both pass on Linux.

2. Fix client file existence checks using `.exists()` calls.
- Impact: user-visible wallpaper/avatar fallback correctness.
- Effort: S.
- Files: `client/uis/wallpaper.ts`, `client/uis/screens/lockscreen.ts`, `client/data.ts`.
- Success criteria: missing files correctly trigger fallback behavior.

3. Correct exam/login form semantics and submit handling.
- Impact: input reliability (especially Enter key submission).
- Effort: S.
- Files: `static/index.html`, `client/uis/screens/examscreen.ts`.
- Success criteria: form submission works consistently via button and keyboard.

4. Remove production inline sourcemaps from bundle output.
- Impact: smaller artifact, less source exposure.
- Effort: S.
- Files: `webpack.config.js`, build scripts if needed.
- Success criteria: `dist/bundle.js` no longer embeds inline source maps.

5. Add timeout/fail options to shell network calls.
- Impact: operational resilience, less hanging services.
- Effort: S.
- Files: `systemd/system/codam-web-greeter-fetcher.sh` and related scripts.
- Success criteria: scripts fail fast and log clear failures.

## Phase 1: Security and runtime hardening (3-7 days)

1. Harden API boundary and request identity handling.
- Add `trust proxy` strategy and stop trusting arbitrary forwarded headers.
- Add rate limiting for sensitive endpoints (`/api/config`, `/api/user/:login/.face`).
- Consider minimal API auth (allowlist/API key/mTLS depending on deployment).
- Files: `server/src/server.ts`, `server/src/utils.ts`, `server/src/routes.ts`, `server/configs/nginx.conf`.
- Success criteria: spoofed client headers do not affect host identification; abuse traffic is throttled.

2. Introduce health model (`/health/live`, `/health/ready`) and compose/systemd checks.
- Files: `server/src/routes.ts`, `server/docker-compose.yaml`, relevant systemd units.
- Success criteria: readiness reflects Intra/cache status and is used by runtime automation.

3. Add systemd safety guardrails for exam automation.
- Ensure non-blocking notification path; skip dangerous actions when user context is invalid.
- Files: `systemd/system/codam-web-greeter-exam-notify.sh`, `systemd/system/codam-web-greeter-exam-restart.sh`, unit files.
- Success criteria: no accidental reboot or blocked service in unattended contexts.

## Phase 2: Data contract and observability (1-2 weeks)

1. Define and validate server->client data contract.
- Add schema validation on server output and client `data.json` parse path.
- Files: `server/src/interfaces.ts`, `server/src/routes.ts`, `client/data.ts`.
- Success criteria: malformed payloads are rejected or safely handled with clear logs.

2. Improve Intra fetch robustness.
- Add retry/backoff, stale-while-revalidate semantics, explicit degraded-state signaling.
- Files: `server/src/intra.ts`, `server/src/routes.ts`.
- Success criteria: transient Intra failures do not require service restart.

3. Add structured logs and basic metrics.
- Track cache age/hit rate, upstream errors, endpoint latency.
- Files: server runtime and possibly fetcher scripts.
- Success criteria: operators can diagnose stale data and outages quickly.

## Phase 3: Maintainability and developer experience (1-2 weeks)

1. Establish CI quality gates.
- Build/lint/test for root and `server/`, with artifact validation.
- Files: `.github/workflows/*`, `package.json`, `server/package.json`.
- Success criteria: PRs fail fast on regressions.

2. Make builds reproducible.
- Use deterministic installs (`npm ci`), improve Docker layering, add `.dockerignore`, pin runtime images.
- Files: `server/dockerfile`, `server/docker-compose.yaml`, build docs.
- Success criteria: reproducible artifacts across environments.

3. Reduce frontend global coupling.
- Move from `window`-centric state to explicit typed controller/state transitions.
- Files: `client/main.ts`, `client/ui.ts`, `client/uis/screen.ts`.
- Success criteria: clearer ownership and fewer screen transition side effects.

## Backlog (after above)
- Accessibility pass for static UI (labels, keyboard flow, aria-live status).
- Secure temporary file handling (`/tmp` media files) with safer permissions and per-user paths.
- Consolidate shared TypeScript config/tooling between root and server.

## Execution notes
- Keep each task small and mergeable.
- For any server/client contract changes, ship both sides together.
- Any changes touching reboot/logout behavior must include explicit operator review.
