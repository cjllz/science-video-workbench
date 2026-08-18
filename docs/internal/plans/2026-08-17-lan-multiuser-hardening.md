# LAN Multi-user Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the existing single-host application safe and predictable for several trusted LAN users while preserving its current video workflow and local-storage architecture.

**Architecture:** Add small, testable modules for signed shared-password sessions and process-local concurrency control, then wire them into the existing Express and pipeline entry points. Keep SQLite and local files, reconcile interrupted jobs at startup, expose a retry action, and compile the server to JavaScript for production.

**Tech Stack:** TypeScript, Express 5, React 19, Node `crypto`, Node `sqlite`, Vitest, Vite.

---

## File Map

- Create `src/server/auth.ts`: shared-token comparison, signed session creation/validation, cookie parsing.
- Create `src/server/auth.test.ts`: deterministic authentication and expiry tests.
- Create `src/server/auth-http.ts`: login/session routes, cookie headers, Express guard.
- Create `src/server/auth-http.test.ts`: HTTP behavior using an ephemeral Express listener and native `fetch`.
- Create `src/server/concurrency-gate.ts`: FIFO process-local concurrency gate.
- Create `src/server/concurrency-gate.test.ts`: capacity and ordering tests.
- Create `src/server/job-recovery.ts`: interrupted-state detection and retry decisions.
- Create `src/server/job-recovery.test.ts`: recovery and retry decision tests.
- Modify `src/server/index.ts`: install auth, protect APIs/media, recover jobs, add retry route, start compiled server normally.
- Modify `src/server/pipeline.ts`: share one render/retouch concurrency gate and expose retry enqueue behavior.
- Modify `src/client/api.ts`: session, login, logout, and retry calls.
- Modify `src/client/App.tsx`: login gate and retry button without restructuring the existing workspace.
- Create `tsconfig.server.json`: production server build excluding tests.
- Modify `package.json`, `package-lock.json`, `.env.example`, and `README.md`: production scripts, Node requirement, configuration, and dependency upgrade.

### Task 1: Signed LAN sessions

**Files:**
- Create: `src/server/auth.ts`
- Create: `src/server/auth.test.ts`

- [ ] **Step 1: Write failing session tests**

```ts
import { describe, expect, it } from "vitest";
import { createLanAuth, readCookie } from "./auth.js";

describe("LAN authentication", () => {
  const now = Date.UTC(2026, 7, 17, 8);

  it("accepts the shared password and validates a signed session", () => {
    const auth = createLanAuth("shared-secret", 60);
    expect(auth.authenticate("shared-secret")).toBe(true);
    expect(auth.authenticate("wrong-secret")).toBe(false);
    const token = auth.createSession(now);
    expect(auth.validateSession(token, now + 30_000)).toBe(true);
  });

  it("rejects expired and modified sessions", () => {
    const auth = createLanAuth("shared-secret", 60);
    const token = auth.createSession(now);
    expect(auth.validateSession(token, now + 61_000)).toBe(false);
    expect(auth.validateSession(`${token}x`, now + 1_000)).toBe(false);
  });

  it("disables authentication when no shared password is configured", () => {
    const auth = createLanAuth(undefined);
    expect(auth.enabled).toBe(false);
    expect(auth.validateSession(undefined, now)).toBe(true);
  });

  it("reads a named cookie without decoding unrelated values", () => {
    expect(readCookie("theme=dark; science_video_session=abc.def", "science_video_session")).toBe("abc.def");
  });
});
```

- [ ] **Step 2: Run the test and verify RED**

Run: `npm test -- src/server/auth.test.ts`

Expected: FAIL because `src/server/auth.ts` does not exist.

- [ ] **Step 3: Implement the session primitive**

Create `src/server/auth.ts` with:

```ts
import { createHmac, timingSafeEqual } from "node:crypto";

export const lanSessionCookie = "science_video_session";

function secureEqual(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left);
  const rightBytes = Buffer.from(right);
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes);
}

export function readCookie(header: string | undefined, name: string): string | undefined {
  return header?.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${name}=`))?.slice(name.length + 1);
}

export function createLanAuth(secret?: string, lifetimeSeconds = 12 * 60 * 60) {
  const configured = secret?.trim();
  const signature = (expiresAt: string) => createHmac("sha256", configured ?? "disabled").update(expiresAt).digest("base64url");
  return {
    enabled: Boolean(configured),
    lifetimeSeconds,
    authenticate(password: string): boolean {
      return configured ? secureEqual(password, configured) : true;
    },
    createSession(now = Date.now()): string {
      const expiresAt = String(now + lifetimeSeconds * 1000);
      return `${expiresAt}.${signature(expiresAt)}`;
    },
    validateSession(token: string | undefined, now = Date.now()): boolean {
      if (!configured) return true;
      if (!token) return false;
      const [expiresAt, suppliedSignature, extra] = token.split(".");
      return !extra && Number(expiresAt) > now && Boolean(suppliedSignature) && secureEqual(suppliedSignature, signature(expiresAt));
    }
  };
}

export type LanAuth = ReturnType<typeof createLanAuth>;
```

- [ ] **Step 4: Run the test and verify GREEN**

Run: `npm test -- src/server/auth.test.ts`

Expected: 4 tests pass.

- [ ] **Step 5: Commit**

```powershell
git add src/server/auth.ts src/server/auth.test.ts
git commit -m "feat: add signed LAN sessions"
```

### Task 2: Express authentication boundary

**Files:**
- Create: `src/server/auth-http.ts`
- Create: `src/server/auth-http.test.ts`
- Modify: `src/server/index.ts`

- [ ] **Step 1: Write failing HTTP tests**

Create an ephemeral Express app in `auth-http.test.ts`, register the public auth routes, apply the guard to `/api` and `/outputs`, and assert:

```ts
expect((await fetch(`${base}/api/health`)).status).toBe(200);
expect((await fetch(`${base}/api/private`)).status).toBe(401);
const login = await fetch(`${base}/api/auth/login`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ password: "shared-secret" })
});
expect(login.status).toBe(200);
const cookie = login.headers.get("set-cookie")!.split(";", 1)[0];
expect((await fetch(`${base}/api/private`, { headers: { Cookie: cookie } })).status).toBe(200);
expect((await fetch(`${base}/outputs/example.mp4`, { headers: { Cookie: cookie } })).status).not.toBe(401);
```

Also assert a wrong password returns `401` and a disabled auth configuration allows the private route.

- [ ] **Step 2: Run the test and verify RED**

Run: `npm test -- src/server/auth-http.test.ts`

Expected: FAIL because `auth-http.ts` does not exist.

- [ ] **Step 3: Implement HTTP helpers**

Create `auth-http.ts` exporting:

```ts
export function registerLanAuthRoutes(app: express.Express, auth: LanAuth): void;
export function requireLanAuth(auth: LanAuth): express.RequestHandler;
```

`registerLanAuthRoutes` must register `GET /api/auth/session`, `POST /api/auth/login`, and `POST /api/auth/logout`. Successful login sets `science_video_session` with `HttpOnly; SameSite=Lax; Path=/; Max-Age=<lifetime>`. The guard reads the cookie with `readCookie` and returns `401` JSON when invalid.

- [ ] **Step 4: Verify HTTP tests pass**

Run: `npm test -- src/server/auth-http.test.ts`

Expected: all authentication boundary tests pass.

- [ ] **Step 5: Wire authentication into the existing server**

In `index.ts`:

```ts
const lanAuth = createLanAuth(process.env.LAN_ACCESS_TOKEN);
app.get("/api/health", (_request, response) => response.json({ ok: true }));
registerLanAuthRoutes(app, lanAuth);
app.use("/api", requireLanAuth(lanAuth));
app.use("/outputs", requireLanAuth(lanAuth), express.static(outputRoot, { maxAge: "1h", fallthrough: false }));
app.use("/materials", requireLanAuth(lanAuth), express.static(materialRoot, { maxAge: "1h", fallthrough: false }));
```

Remove the original unguarded static middleware and duplicate health route. Log one warning when auth is disabled.

- [ ] **Step 6: Run focused and existing server tests**

Run: `npm test -- src/server/auth.test.ts src/server/auth-http.test.ts src/server/server-config.test.ts`

Expected: all tests pass.

- [ ] **Step 7: Commit**

```powershell
git add src/server/auth-http.ts src/server/auth-http.test.ts src/server/index.ts
git commit -m "feat: protect LAN APIs and media"
```

### Task 3: Client login gate

**Files:**
- Modify: `src/client/api.ts`
- Modify: `src/client/App.tsx`
- Modify: `src/client/styles.css`

- [ ] **Step 1: Add the client API contract**

Add methods:

```ts
getSession: () => request<{ authRequired: boolean; authenticated: boolean }>("/api/auth/session"),
login: (password: string) => request<{ authenticated: true }>("/api/auth/login", { method: "POST", body: JSON.stringify({ password }) }),
logout: () => request<{ ok: true }>("/api/auth/logout", { method: "POST" }),
```

Keep same-origin cookie behavior; do not store the password or session in local storage.

- [ ] **Step 2: Add the minimal login state to `App`**

Before loading jobs, call `api.getSession()`. While checking, render the existing app shell with a loading state. When unauthenticated, render a compact password form. On successful login, load jobs/stats/provider/materials using the existing initialization path.

Do not move `BriefForm`, `JobPreview`, `HistoryPanel`, or the current workspace layout into new files during this task.

- [ ] **Step 3: Add restrained login styles**

Reuse existing colors, input, button, and error styles. Add only the layout selectors required for a centered login panel and ensure it fits a 390 px viewport.

- [ ] **Step 4: Verify TypeScript and build**

Run: `npm run build`

Expected: build succeeds with no TypeScript errors.

- [ ] **Step 5: Commit**

```powershell
git add src/client/api.ts src/client/App.tsx src/client/styles.css
git commit -m "feat: add shared LAN login"
```

### Task 4: FIFO rendering concurrency

**Files:**
- Create: `src/server/concurrency-gate.ts`
- Create: `src/server/concurrency-gate.test.ts`
- Modify: `src/server/pipeline.ts`

- [ ] **Step 1: Write failing gate tests**

```ts
it("runs no more than the configured number of tasks", async () => {
  const gate = createConcurrencyGate(2);
  let active = 0;
  let maximum = 0;
  const run = () => gate.run(async () => {
    active += 1;
    maximum = Math.max(maximum, active);
    await new Promise((resolve) => setTimeout(resolve, 10));
    active -= 1;
  });
  await Promise.all([run(), run(), run(), run()]);
  expect(maximum).toBe(2);
});

it("starts queued tasks in FIFO order", async () => {
  const gate = createConcurrencyGate(1);
  const order: number[] = [];
  await Promise.all([1, 2, 3].map((value) => gate.run(async () => { order.push(value); })));
  expect(order).toEqual([1, 2, 3]);
});
```

- [ ] **Step 2: Run the test and verify RED**

Run: `npm test -- src/server/concurrency-gate.test.ts`

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement the gate**

Implement `createConcurrencyGate(limit)` with an active counter, FIFO resolver queue, and `run<T>(task): Promise<T>` that releases its slot in `finally`. Clamp invalid limits to one.

- [ ] **Step 4: Run the gate tests and verify GREEN**

Run: `npm test -- src/server/concurrency-gate.test.ts`

Expected: 2 tests pass.

- [ ] **Step 5: Apply one shared gate to rendering and retouch**

In `pipeline.ts`:

```ts
const renderConcurrency = createConcurrencyGate(Number(process.env.MAX_CONCURRENT_RENDERS || 1));
```

Wrap `processRendering` and `processRetouch` with the same gate inside their enqueue functions. Keep planning outside the gate and preserve the existing per-job `running` set.

- [ ] **Step 6: Run pipeline-related tests**

Run: `npm test -- src/server/concurrency-gate.test.ts src/server/job-lifecycle.test.ts src/server/retouch.test.ts`

Expected: all tests pass.

- [ ] **Step 7: Commit**

```powershell
git add src/server/concurrency-gate.ts src/server/concurrency-gate.test.ts src/server/pipeline.ts
git commit -m "feat: limit concurrent video rendering"
```

### Task 5: Restart recovery and retry

**Files:**
- Create: `src/server/job-recovery.ts`
- Create: `src/server/job-recovery.test.ts`
- Modify: `src/server/pipeline.ts`
- Modify: `src/server/index.ts`
- Modify: `src/client/api.ts`
- Modify: `src/client/App.tsx`

- [ ] **Step 1: Write failing recovery decision tests**

Test that active and queued statuses are recoverable, terminal statuses are untouched, a failed job with a plan retries rendering, and a failed job without a plan retries planning.

```ts
expect(isInterruptedStatus("rendering")).toBe(true);
expect(isInterruptedStatus("complete")).toBe(false);
expect(retryPhase({ ...failedJob, plan })).toBe("rendering");
expect(retryPhase({ ...failedJob, plan: undefined })).toBe("planning");
expect(() => retryPhase({ ...failedJob, status: "complete" })).toThrow();
```

- [ ] **Step 2: Run the test and verify RED**

Run: `npm test -- src/server/job-recovery.test.ts`

Expected: FAIL because `job-recovery.ts` does not exist.

- [ ] **Step 3: Implement recovery helpers**

Export `isInterruptedStatus`, `retryPhase`, and `markInterruptedJobsFailed`. `markInterruptedJobsFailed` reads up to 10,000 jobs, updates interrupted jobs to `failed`, sets a restart-specific stage/error, and returns the number changed.

- [ ] **Step 4: Run recovery tests and verify GREEN**

Run: `npm test -- src/server/job-recovery.test.ts`

Expected: recovery decision tests pass.

- [ ] **Step 5: Add startup reconciliation and retry enqueueing**

Call `markInterruptedJobsFailed()` once before `app.listen`. Replace the empty `resumeInterruptedJobs` export or remove it. Add `enqueueRetry(jobId)` in `pipeline.ts`, choosing planning when no plan exists and rendering when a plan exists.

- [ ] **Step 6: Add the retry endpoint**

Register `POST /api/jobs/:id/retry`. Require `failed` status, reset status/progress/stage/error, call `enqueueRetry`, and return `202`. Return `409` for non-failed jobs.

- [ ] **Step 7: Add the client retry action**

Add `api.retryJob(id)`. In the existing failure box, add a retry button that calls it, updates the selected job through `onJobUpdated`, and reports errors through `onError`.

- [ ] **Step 8: Run related tests and build**

Run: `npm test -- src/server/job-recovery.test.ts src/server/job-lifecycle.test.ts && npm run build`

Expected: tests and build pass.

- [ ] **Step 9: Commit**

```powershell
git add src/server/job-recovery.ts src/server/job-recovery.test.ts src/server/pipeline.ts src/server/index.ts src/client/api.ts src/client/App.tsx
git commit -m "feat: recover and retry interrupted jobs"
```

### Task 6: Production server build and runtime constraints

**Files:**
- Create: `tsconfig.server.json`
- Modify: `package.json`
- Modify: `package-lock.json`

- [ ] **Step 1: Add a failing packaging assertion**

Run before changing scripts:

```powershell
npm run build
Test-Path dist/server/index.js
```

Expected: `False`, proving the current build does not emit the server.

- [ ] **Step 2: Add the server build configuration**

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "noEmit": false,
    "rootDir": "src",
    "outDir": "dist",
    "sourceMap": true
  },
  "include": ["src/server/**/*.ts", "src/shared/**/*.ts"],
  "exclude": ["src/**/*.test.ts"]
}
```

- [ ] **Step 3: Update package scripts and engines**

Use scripts equivalent to:

```json
"clean": "node -e \"require('node:fs').rmSync('dist',{recursive:true,force:true})\"",
"build:server": "tsc -p tsconfig.server.json",
"build:client": "vite build",
"build": "npm run clean && npm run build:server && npm run build:client",
"start": "node dist/server/index.js"
```

Add:

```json
"engines": { "node": ">=22.5.0" }
```

- [ ] **Step 4: Upgrade `sharp`**

Run: `npm install sharp@^0.35.3`

Expected: `package.json` and `package-lock.json` update without unrelated dependency changes beyond the resolved `sharp` graph.

- [ ] **Step 5: Verify emitted layout**

Run: `npm run build`

Expected: `dist/server/index.js`, `dist/shared/video.js`, and `dist/client/index.html` exist.

- [ ] **Step 6: Smoke-test production start**

Start on an unused port with `PORT=8790`, request `/api/health`, verify `{ "ok": true }`, then stop that exact process.

- [ ] **Step 7: Commit**

```powershell
git add tsconfig.server.json package.json package-lock.json
git commit -m "build: compile the production server"
```

### Task 7: LAN configuration and operator documentation

**Files:**
- Modify: `.env.example`
- Modify: `README.md`

- [ ] **Step 1: Document configuration values**

Add to `.env.example`:

```dotenv
# Shared password for trusted LAN users. Leave blank only for local development.
LAN_ACCESS_TOKEN=

# Maximum simultaneous ffmpeg/provider render or retouch jobs.
MAX_CONCURRENT_RENDERS=1
```

- [ ] **Step 2: Update the production instructions**

Document Node 22.5+, setting a non-empty LAN token, running `npm run build && npm start`, opening the host LAN IP, Windows private-network firewall scope, persistent `data/`, and the warning not to configure router port forwarding.

- [ ] **Step 3: Run documentation/config checks**

Run: `git diff --check`

Expected: no whitespace errors.

- [ ] **Step 4: Commit**

```powershell
git add .env.example README.md
git commit -m "docs: add LAN deployment guidance"
```

### Task 8: Full verification

**Files:**
- Verify all modified files.

- [ ] **Step 1: Run the full automated test suite**

Run: `npm test`

Expected: all test files and tests pass with exit code 0.

- [ ] **Step 2: Run a clean production build**

Run: `npm run build`

Expected: TypeScript server compilation and Vite client build both succeed.

- [ ] **Step 3: Run the production dependency audit**

Run: `npm audit --omit=dev`

Expected: zero high or critical vulnerabilities.

- [ ] **Step 4: Run an authenticated production smoke test**

Start the compiled server on an unused port with a temporary `LAN_ACCESS_TOKEN`. Verify health is public, jobs return `401` before login, login sets a cookie, jobs return `200` with the cookie, and the home page returns `200`.

- [ ] **Step 5: Inspect the final diff**

Run: `git diff --check` and `git status --short`.

Expected: no whitespace errors; only intended implementation files are changed.

- [ ] **Step 6: Commit verification-only fixes if needed**

Do not create an empty commit. Commit only concrete corrections discovered during verification.
