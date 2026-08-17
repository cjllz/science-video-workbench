# LAN Multi-user Hardening Design

## Goal

Make the existing single-host Science Video Studio suitable for several trusted users on the same LAN without turning it into a multi-tenant service or changing the rendering/product workflow.

## Scope

- Protect API mutations, job/material data, and generated media with one shared LAN access token.
- Keep `/api/health` and the login/session endpoints available for readiness checks and authentication.
- Use an HttpOnly, SameSite cookie after login so browser video, image, subtitle, and download requests are authenticated automatically.
- Limit resource-heavy rendering and retouch work with a process-local concurrency gate. The default is one active render-like job and is configurable.
- Reconcile interrupted jobs on process startup. Jobs left in queued or active states become failed with a restart-specific error; failed jobs with a plan can be retried from the UI.
- Compile server and shared TypeScript into `dist/server` and run it with Node in production.
- Declare Node 22.5+ as the supported runtime and upgrade `sharp` to a non-vulnerable release.
- Add focused unit and HTTP-level tests without changing existing business behavior.

## Authentication

`LAN_ACCESS_TOKEN` is the shared password. When configured, the server exposes:

- `POST /api/auth/login` with `{ password }`, returning a short-lived signed session cookie.
- `GET /api/auth/session`, returning whether authentication is required and whether the current cookie is valid.
- `GET /api/health`, always available without authentication.

All other `/api` routes and `/outputs` and `/materials` static routes require a valid session. The unauthenticated client shell remains loadable so it can show the login form. When `LAN_ACCESS_TOKEN` is absent, authentication remains disabled for local development and the server logs a warning.

The session is signed with Node's built-in crypto APIs, expires after 12 hours, is HttpOnly, and uses SameSite=Lax. The token is never bundled into client code or returned by the API.

## Job control and recovery

Rendering and retouch operations acquire a shared process-local slot before invoking provider, TTS, ffmpeg, or final composition work. Planning remains independent. When no slot is available, the job stays queued and is processed in FIFO order by the in-process gate.

At startup, jobs in `queued`, `planning`, `narrating`, `rendering`, or `quality_check` are marked `failed` with a clear restart message. A failed job with a saved plan can be retried through a dedicated endpoint and button; retrying resets status and re-enqueues rendering, while a failed job without a plan is re-planned.

## Production packaging

The build creates:

- `dist/client` from Vite.
- `dist/server` from a server-specific TypeScript build configuration.

`npm start` runs `node dist/server/index.js`. The server build excludes tests. The existing project-root-relative data, scripts, and static asset paths must continue to resolve from the repository root.

## Testing and verification

Add tests for:

- token authentication and session expiry/invalid-cookie handling;
- protected API and static routes versus health/login routes;
- concurrency gate ordering and configured capacity;
- startup recovery and retry state transitions;
- production build output and package scripts where practical.

Existing tests must remain green. Verification includes `npm test`, `npm run build`, a production start smoke test, and `npm audit --omit=dev`.

## Non-goals

- Per-user accounts, roles, permissions, or audit identity.
- External job queues, Redis, object storage, or database migration infrastructure.
- Rewriting the renderer, planner, provider adapters, or UI layout.
