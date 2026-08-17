# Linux Docker Deployment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver a secure, repeatable single-host Linux Docker Compose deployment with internal HTTPS, persistent storage, health checks, graceful shutdown, verified backups/restores, and a comprehensive Chinese operations guide.

**Architecture:** A non-root Node/Python/ffmpeg application container runs behind a Caddy internal-CA reverse proxy on one private Compose network. The application keeps its SQLite and generated files in one host bind mount, while host-side guarded scripts provide idle-only backups, retention, optional mirroring, and confirmed restores.

**Tech Stack:** Node.js 22, TypeScript, Express 5, SQLite, Docker Engine, Docker Compose, Caddy 2, Debian slim, Bash, Vitest

---

### Task 1: Validate production runtime configuration and proxy trust

**Files:**
- Create: `src/server/runtime-config.ts`
- Create: `src/server/runtime-config.test.ts`
- Modify: `src/server/index.ts`
- Modify: `.env.example`

- [ ] **Step 1: Write failing configuration tests**

Test explicit parsing rather than mutating process-global environment:

```ts
it("rejects a LAN listener without a strong access token", () => {
  expect(() => readRuntimeConfig({ HOST: "0.0.0.0", PORT: "8787" })).toThrow(
    "LAN_ACCESS_TOKEN is required when HOST is not loopback"
  );
});

it("allows unauthenticated loopback development", () => {
  expect(readRuntimeConfig({ HOST: "127.0.0.1", PORT: "8787" })).toMatchObject({
    host: "127.0.0.1", port: 8787, trustProxy: false
  });
});

it("accepts one trusted reverse proxy", () => {
  expect(readRuntimeConfig({
    HOST: "0.0.0.0", PORT: "8787", LAN_ACCESS_TOKEN: "a-long-LAN-password", TRUST_PROXY: "1"
  }).trustProxy).toBe(1);
});
```

Also cover invalid ports, render concurrency outside 1-8, relative `FFMPEG_PATH`, non-HTTP provider URLs, and secret-safe error text.

- [ ] **Step 2: Verify RED**

Run: `npx vitest run src/server/runtime-config.test.ts`

Expected: FAIL because `runtime-config.ts` does not exist.

- [ ] **Step 3: Implement one immutable parser**

Export:

```ts
export interface RuntimeConfig {
  host: string;
  port: number;
  lanAccessToken?: string;
  maxConcurrentRenders: number;
  trustProxy: false | 1;
  ffmpegPath?: string;
}

export function readRuntimeConfig(environment: NodeJS.ProcessEnv): RuntimeConfig;
```

Use Zod for numeric bounds and URL validation. Treat `127.0.0.1`, `::1`, and `localhost` as loopback. Require a trimmed LAN token of at least 16 characters for every other host. Return field-oriented messages and never interpolate values of variables whose name ends in `_KEY`, `_TOKEN`, or `_SECRET`.

- [ ] **Step 4: Wire configuration before app creation**

After optional `.env` loading, call `readRuntimeConfig(process.env)`. Use its host, port, token, and concurrency values. When `trustProxy === 1`, call:

```ts
app.set("trust proxy", 1);
```

Add `TRUST_PROXY=0` and `FFMPEG_PATH=` descriptions to `.env.example`.

- [ ] **Step 5: Verify GREEN and commit**

Run: `npx vitest run src/server/runtime-config.test.ts src/server/server-config.test.ts`

Expected: PASS.

```powershell
git add src/server/runtime-config.ts src/server/runtime-config.test.ts src/server/index.ts .env.example
git commit -m "feat: validate production runtime configuration"
```

### Task 2: Make ffmpeg resolution container- and architecture-safe

**Files:**
- Create: `src/server/tooling.ts`
- Create: `src/server/tooling.test.ts`
- Modify: `src/server/renderer.ts`
- Modify: `package.json`
- Modify: `package-lock.json`

- [ ] **Step 1: Write failing ffmpeg resolution tests**

```ts
it("prefers a validated explicit ffmpeg path", () => {
  expect(resolveFfmpegPath({ configuredPath: "/usr/bin/ffmpeg", bundledPath: "/bundle/ffmpeg", exists: () => true }))
    .toBe("/usr/bin/ffmpeg");
});

it("falls back to a bundled binary for local development", () => {
  expect(resolveFfmpegPath({ bundledPath: "C:\\tools\\ffmpeg.exe", exists: () => true })).toBe("C:\\tools\\ffmpeg.exe");
});

it("fails clearly when neither binary exists", () => {
  expect(() => resolveFfmpegPath({ exists: () => false })).toThrow("ffmpeg executable is unavailable");
});
```

- [ ] **Step 2: Verify RED**

Run: `npx vitest run src/server/tooling.test.ts`

Expected: FAIL because `resolveFfmpegPath` does not exist.

- [ ] **Step 3: Implement deterministic tool resolution**

Move ffmpeg path selection out of `renderer.ts`. Accept injected values in the pure resolver and expose a production helper that uses `process.env.FFMPEG_PATH`, optional `ffmpeg-static`, and filesystem executable checks. Renderer functions continue to receive one resolved path and retain current commands.

Move `ffmpeg-static` from `dependencies` to `optionalDependencies`. Docker will use `/usr/bin/ffmpeg`; local supported platforms retain the optional binary.

- [ ] **Step 4: Verify and commit**

Run: `npx vitest run src/server/tooling.test.ts src/server/renderer-materials.test.ts`

Run: `npm run build:server`

Expected: PASS.

```powershell
git add src/server/tooling.ts src/server/tooling.test.ts src/server/renderer.ts package.json package-lock.json
git commit -m "refactor: support system ffmpeg"
```

### Task 3: Add dependency preflight and readiness

**Files:**
- Create: `src/server/readiness.ts`
- Create: `src/server/readiness.test.ts`
- Modify: `src/server/db.ts`
- Modify: `src/server/index.ts`

- [ ] **Step 1: Write failing readiness aggregation tests**

```ts
it("returns only component names for failed checks", async () => {
  const readiness = createReadiness({
    database: async () => undefined,
    dataDirectory: async () => { throw new Error("/secret/path is read-only"); },
    ffmpeg: async () => undefined,
    tts: async () => undefined
  });
  expect(await readiness.inspect()).toEqual({ ok: false, failed: ["dataDirectory"] });
});

it("becomes unavailable as soon as shutdown starts", async () => {
  const readiness = createReadiness({
    database: async () => undefined,
    dataDirectory: async () => undefined,
    ffmpeg: async () => undefined,
    tts: async () => undefined
  });
  readiness.beginShutdown();
  expect(await readiness.inspect()).toEqual({ ok: false, failed: ["shutdown"] });
});
```

- [ ] **Step 2: Verify RED**

Run: `npx vitest run src/server/readiness.test.ts`

Expected: FAIL because the readiness module does not exist.

- [ ] **Step 3: Implement preflight and lightweight inspection**

`createReadiness` runs ffmpeg `-version` and `python -c "import edge_tts"` once and caches their safe pass/fail state. Each `inspect` additionally calls an exported `checkDatabase()` (`SELECT 1`) and creates/removes a random probe file in `dataRoot`.

Expose:

```ts
app.get("/api/ready", async (_request, response) => {
  const result = await readiness.inspect();
  return response.status(result.ok ? 200 : 503).json(result);
});
```

Keep `/api/health` unchanged and public.

- [ ] **Step 4: Verify and commit**

Run: `npx vitest run src/server/readiness.test.ts src/server/auth-http.test.ts`

Expected: PASS and no response contains probe paths or command output.

```powershell
git add src/server/readiness.ts src/server/readiness.test.ts src/server/db.ts src/server/index.ts
git commit -m "feat: add deployment readiness checks"
```

### Task 4: Drain work and close cleanly on server shutdown

**Files:**
- Modify: `src/server/pipeline.ts`
- Create: `src/server/shutdown.ts`
- Create: `src/server/shutdown.test.ts`
- Modify: `src/server/db.ts`
- Modify: `src/server/index.ts`

- [ ] **Step 1: Write failing admission and timeout tests**

```ts
it("rejects new mutations after shutdown begins", async () => {
  const controller = createShutdownController({ timeoutMs: 30, waitForWork: async () => undefined, closeServer: async () => undefined, closeDatabase: () => undefined });
  controller.begin();
  expect(controller.acceptingWork()).toBe(false);
});

it("does not wait beyond its deadline", async () => {
  vi.useFakeTimers();
  const controller = createShutdownController({ timeoutMs: 30, waitForWork: () => new Promise(() => undefined), closeServer: async () => undefined, closeDatabase: () => undefined });
  const closing = controller.begin();
  await vi.advanceTimersByTimeAsync(31);
  await expect(closing).resolves.toMatchObject({ drained: false });
});
```

- [ ] **Step 2: Verify RED**

Run: `npx vitest run src/server/shutdown.test.ts`

Expected: FAIL because the controller does not exist.

- [ ] **Step 3: Track operation promises and implement bounded drain**

In `pipeline.ts`, replace fire-and-forget-only tracking with a `Set<Promise<void>>`. Each planning, rendering, and retouch operation registers its promise and removes it in `finally`. Export `waitForPipelineIdle()` using `Promise.allSettled([...active])`.

In `db.ts`, export idempotent `closeDatabase()`.

The shutdown controller marks readiness false, closes the HTTP server, races pipeline idle against the configured deadline, closes SQLite, and returns `{ drained: boolean }`. It never calls `process.exit` in the reusable module.

In `index.ts`, add a mutation guard for POST/PATCH/PUT/DELETE routes that returns 503 after shutdown begins, retain the server returned by `listen`, and register once-only `SIGTERM`/`SIGINT` handlers. The entrypoint sets exit code after the controller completes.

- [ ] **Step 4: Verify and commit**

Run: `npx vitest run src/server/shutdown.test.ts src/server/job-recovery.test.ts src/server/concurrency-gate.test.ts`

Expected: PASS.

```powershell
git add src/server/pipeline.ts src/server/shutdown.ts src/server/shutdown.test.ts src/server/db.ts src/server/index.ts
git commit -m "feat: drain work on shutdown"
```

### Task 5: Add maintenance checks for safe backups

**Files:**
- Create: `src/server/maintenance.ts`
- Create: `src/server/maintenance.test.ts`
- Create: `src/server/maintenance-cli.ts`
- Modify: `src/server/db.ts`
- Modify: `tsconfig.server.json`
- Modify: `package.json`

- [ ] **Step 1: Write failing idle-state tests**

```ts
it("reports active statuses that make a cold backup unsafe", () => {
  expect(summarizeMaintenanceState([
    { status: "complete" }, { status: "rendering" }, { status: "queued" }
  ])).toEqual({ idle: false, activeJobs: 2 });
});

it("treats terminal and confirmation jobs as idle", () => {
  expect(summarizeMaintenanceState([
    { status: "complete" }, { status: "failed" }, { status: "awaiting_confirmation" }
  ])).toEqual({ idle: true, activeJobs: 0 });
});
```

- [ ] **Step 2: Verify RED**

Run: `npx vitest run src/server/maintenance.test.ts`

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement the maintenance command**

Add a database query that counts `queued`, `planning`, `narrating`, `rendering`, and `quality_check` jobs. `maintenance-cli.ts check-idle` prints one JSON object and exits 0 when idle or 2 when active. `maintenance-cli.ts validate-data` executes SQLite integrity check and verifies required data directories, exiting 0 or 3.

Add:

```json
"maintenance": "node dist/server/maintenance-cli.js"
```

- [ ] **Step 4: Verify and commit**

Run: `npx vitest run src/server/maintenance.test.ts`

Run: `npm run build:server`

Expected: PASS and `dist/server/maintenance-cli.js` exists.

```powershell
git add src/server/maintenance.ts src/server/maintenance.test.ts src/server/maintenance-cli.ts src/server/db.ts tsconfig.server.json package.json
git commit -m "feat: add deployment maintenance checks"
```

### Task 6: Create the application image, Compose stack, and Caddy configuration

**Files:**
- Create: `Dockerfile`
- Create: `.dockerignore`
- Create: `compose.yaml`
- Create: `deploy/Caddyfile`
- Create: `deploy/.env.production.example`
- Create: `deploy/entrypoint.sh`
- Modify: `.gitignore`

- [ ] **Step 1: Write the Docker build files**

Use `node:22-bookworm-slim` stages. The runtime apt list is exactly `ca-certificates curl ffmpeg fonts-noto-cjk python3 python3-venv tini`. Build `/opt/venv`, install `requirements.txt`, create UID/GID 10001, copy production dependencies and `dist`, and run:

```dockerfile
ENTRYPOINT ["/usr/bin/tini", "--", "/app/deploy/entrypoint.sh"]
CMD ["node", "dist/server/index.js"]
```

The entrypoint verifies `/app/data` and `/tmp` are writable, prints architecture and application version without secrets, and uses `exec "$@"`.

- [ ] **Step 2: Write Compose and Caddy configuration**

Compose uses a private network, publishes only Caddy ports, mounts `${DATA_DIR}:/app/data`, sets `read_only: true`, `/tmp` tmpfs, `no-new-privileges:true`, `restart: unless-stopped`, `stop_grace_period: 45s`, and JSON-file log rotation. App health calls `curl --fail http://127.0.0.1:8787/api/ready`.

Caddy uses:

```caddyfile
https://{$LAN_HOST} {
  tls internal
  encode zstd gzip
  header {
    X-Content-Type-Options nosniff
    X-Frame-Options DENY
    Referrer-Policy no-referrer
  }
  reverse_proxy app:8787
}
```

Add `deploy/.env.production` to `.gitignore`. The example contains no working secrets and documents `LAN_HOST`, `DATA_DIR`, `BACKUP_DIR`, `BACKUP_MIRROR_DIR`, retention, app version, proxy trust, token, render concurrency, and provider variables.

- [ ] **Step 3: Validate static deployment files**

Run: `docker compose --env-file deploy/.env.production.example config --quiet`

Expected: exit 0 when Docker Compose is available. If Docker is unavailable on the development host, record that limitation and validate YAML structure with the installed project tooling instead; container verification remains mandatory on a Docker-capable host before release.

Run: `bash -n deploy/entrypoint.sh`

Expected: exit 0.

- [ ] **Step 4: Commit**

```powershell
git add Dockerfile .dockerignore compose.yaml deploy/Caddyfile deploy/.env.production.example deploy/entrypoint.sh .gitignore
git commit -m "build: add Linux Docker Compose deployment"
```

### Task 7: Implement guarded backup and restore scripts

**Files:**
- Create: `deploy/lib.sh`
- Create: `deploy/backup.sh`
- Create: `deploy/restore.sh`
- Create: `deploy/deployment-scripts.test.ts`

- [ ] **Step 1: Write failing safety-contract tests**

The test reads scripts and executes harmless temporary-directory cases. Assert that empty/root/home targets are rejected, restore requires `--confirm-restore`, backup uses a lock and app idle check, restart is registered in a trap, and incomplete archives never receive the final `.tar.gz` name.

```ts
async function runBash(script: string, environment: NodeJS.ProcessEnv) {
  return await new Promise<{ code: number | null; stderr: string }>((resolve) => {
    const child = spawn("bash", [script], {
      cwd: projectRoot,
      env: { ...process.env, ...environment }
    });
    let stderr = "";
    child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
    child.on("close", (code) => resolve({ code, stderr }));
  });
}

it("refuses unsafe data roots", async () => {
  const temporaryBackup = mkdtempSync(join(tmpdir(), "science-video-backup-"));
  const result = await runBash("deploy/backup.sh", {
    DATA_DIR: "/",
    BACKUP_DIR: temporaryBackup
  });
  expect(result.code).not.toBe(0);
  expect(result.stderr).toContain("unsafe DATA_DIR");
});
```

- [ ] **Step 2: Verify RED**

Run: `npx vitest run deploy/deployment-scripts.test.ts`

Expected: FAIL because the scripts do not exist.

- [ ] **Step 3: Implement shared guards and backup flow**

`lib.sh` resolves paths with `realpath -m`, rejects unsafe targets, wraps `docker compose --env-file`, waits for readiness, and installs restart cleanup.

`backup.sh` acquires `flock`, runs `npm run maintenance -- check-idle` in the app container, stops app, creates `.partial` archive/checksum/manifest files, atomically renames them, restarts app in a trap, prunes by retention days, and optionally mirrors completed files with rsync. All filesystem targets use quoted resolved variables.

- [ ] **Step 4: Implement confirmed restore and rollback**

`restore.sh <archive> --confirm-restore` verifies the adjacent `.sha256`, refuses active work, stops app, archives current data as a safety copy, and extracts to a sibling temporary directory. It validates the candidate with a one-off app container that mounts the candidate at `/app/data` and runs `npm run maintenance -- validate-data`. It then swaps data, restores the documented UID/GID ownership, starts the app, and waits for readiness. Any failure after stopping restores the original directory and restarts the app.

- [ ] **Step 5: Verify and commit**

Run: `bash -n deploy/lib.sh deploy/backup.sh deploy/restore.sh`

Run: `npx vitest run deploy/deployment-scripts.test.ts`

Expected: PASS.

```powershell
git add deploy/lib.sh deploy/backup.sh deploy/restore.sh deploy/deployment-scripts.test.ts
git commit -m "feat: add guarded backup and restore"
```

### Task 8: Write the operator guide and verify the release stack

**Files:**
- Create: `docs/deployment/linux-docker.md`
- Modify: `README.md`

- [ ] **Step 1: Write the canonical Chinese guide**

Follow the exact section inventory in `docs/superpowers/specs/2026-08-17-linux-docker-deployment-design.md`. Every command states its working directory, expected output, and recovery action. Include:

- Ubuntu/Debian host preparation and `uname -m` interpretation;
- Docker/Compose verification without blindly piping remote scripts to a shell;
- `/srv/science-video-workbench` layout and permissions;
- complete environment-variable reference;
- build, first boot, certificate export/fingerprint, client trust, firewall;
- status/log/start/stop/restart commands;
- provider networking and public-material caveat;
- daily backup scheduling, retention, mirror, restore drills;
- upgrade/rollback runbooks;
- symptom-to-command troubleshooting tables;
- security and release acceptance checklists;
- uninstall steps that preserve data unless an explicit destructive command is selected.

README links to this guide and keeps only a short production overview.

- [ ] **Step 2: Run complete application verification**

Run: `npm test`

Run: `npm run build`

Run: `npm audit --omit=dev`

Expected: all tests/build pass and production vulnerability count is zero.

- [ ] **Step 3: Run Docker verification when available**

Build the image, start Compose with test paths and ports, verify `/api/health` and `/api/ready`, confirm no app host port, create a marker under data, restart app, and verify persistence. Run a backup/restore round trip on disposable data. Inspect the container user, read-only root filesystem, health, and architecture.

Expected: every assertion passes; stop Compose without removing persistent test data until verification is recorded.

- [ ] **Step 4: Check documentation and repository cleanliness**

Run: `rg -n "T(BD)|TO(DO)|FIX(ME)|replace[-_]me" docs/deployment/linux-docker.md deploy/.env.production.example`

Expected: only deliberately documented sample secret values appear in the example, and the guide explains replacing them.

Run: `git diff --check`

Run: `git status --short --branch`

Expected: no uncommitted files after the final documentation commit.

- [ ] **Step 5: Commit**

```powershell
git add docs/deployment/linux-docker.md README.md
git commit -m "docs: add Linux deployment runbook"
```
