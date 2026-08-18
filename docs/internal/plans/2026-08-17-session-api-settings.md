# Session-scoped API Settings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let each authenticated LAN browser session supply separate script and Seedance API settings that remain server-memory-only and fall back independently to administrator configuration.

**Architecture:** Extend the signed LAN cookie with a random session ID, use that ID as the key for an in-memory settings store, and resolve immutable provider configuration snapshots at each job command. Provider adapters receive those snapshots explicitly instead of consulting mutable global state. A focused React dialog edits redacted settings through authenticated endpoints.

**Tech Stack:** TypeScript, Express 5, React 19, Zod, Node crypto, Vitest, native fetch, Vite

---

### Task 1: Add unique authenticated session identities

**Files:**
- Modify: `src/server/auth.ts`
- Modify: `src/server/auth.test.ts`
- Modify: `src/server/auth-http.ts`
- Modify: `src/server/auth-http.test.ts`

- [ ] **Step 1: Write failing tests for unique IDs and parsed sessions**

Add tests proving that two tokens created at the same time have different IDs, signatures cover both ID and expiry, and the authenticated session can be parsed:

```ts
it("creates unique signed session identities", () => {
  const auth = createLanAuth("shared-secret", 60);
  const first = auth.createSession(now);
  const second = auth.createSession(now);

  expect(first).not.toBe(second);
  expect(auth.readSession(first, now + 1_000)?.id).toMatch(/^[A-Za-z0-9_-]{20,}$/);
  expect(auth.readSession(second, now + 1_000)?.id).not.toBe(auth.readSession(first, now + 1_000)?.id);
});

it("rejects a modified session id", () => {
  const auth = createLanAuth("shared-secret", 60);
  const token = auth.createSession(now);
  const [id, expiresAt, signature] = token.split(".");
  expect(auth.readSession(`changed${id}.${expiresAt}.${signature}`, now + 1_000)).toBeUndefined();
});
```

Extend the HTTP test helper to capture login cookies and verify an optional logout callback receives the parsed session ID.

- [ ] **Step 2: Run the focused tests and verify failure**

Run: `npx vitest run src/server/auth.test.ts src/server/auth-http.test.ts`

Expected: FAIL because `readSession` and logout session callbacks do not exist and same-time tokens are identical.

- [ ] **Step 3: Implement signed ID-bearing sessions**

Change the token payload in `src/server/auth.ts` to `id.expiresAt.signature`, using `randomBytes(18).toString("base64url")`. Add a parsed type and implement `readSession` as a closure that validation delegates to:

```ts
export interface LanSession {
  id: string;
  expiresAt: number;
}

const signature = (id: string, expiresAt: string) =>
  createHmac("sha256", configured ?? "disabled")
    .update(`${id}.${expiresAt}`)
    .digest("base64url");

const readSession = (token: string | undefined, now = Date.now()): LanSession | undefined => {
  if (!configured || !token) return undefined;
  const [id, expiresAt, suppliedSignature, extra] = token.split(".");
  if (!id || !expiresAt || !suppliedSignature || extra || Number(expiresAt) <= now) return undefined;
  if (!secureEqual(suppliedSignature, signature(id, expiresAt))) return undefined;
  return { id, expiresAt: Number(expiresAt) };
};

createSession(now = Date.now()): string {
  const id = randomBytes(18).toString("base64url");
  const expiresAt = String(now + lifetimeSeconds * 1000);
  return `${id}.${expiresAt}.${signature(id, expiresAt)}`;
},
readSession,
validateSession(token: string | undefined, now = Date.now()): boolean {
  return configured ? Boolean(readSession(token, now)) : true;
}
```

Update `registerLanAuthRoutes` to accept `onLogout?: (sessionId: string) => void`. Parse the cookie before clearing it, invoke the callback only for a valid authenticated session, and retain current behavior when authentication is disabled.

- [ ] **Step 4: Run focused tests**

Run: `npx vitest run src/server/auth.test.ts src/server/auth-http.test.ts`

Expected: both files PASS.

- [ ] **Step 5: Commit**

```powershell
git add src/server/auth.ts src/server/auth.test.ts src/server/auth-http.ts src/server/auth-http.test.ts
git commit -m "feat: add unique LAN session identities"
```

### Task 2: Build the session settings store and provider resolver

**Files:**
- Create: `src/shared/provider-settings.ts`
- Create: `src/server/provider-settings.ts`
- Create: `src/server/provider-settings.test.ts`

- [ ] **Step 1: Define shared request and redacted response contracts**

Create discriminated request types so key retention is explicit and response types cannot contain a secret:

```ts
export type ProviderSecretUpdate =
  | { action: "keep" }
  | { action: "replace"; value: string };

export type ScriptSettingsInput =
  | { mode: "server" }
  | { mode: "deepseek" | "openai" | "ark"; apiKey: ProviderSecretUpdate; baseUrl?: string; model: string };

export type VideoSettingsInput =
  | { mode: "server" }
  | { mode: "ark"; apiKey: ProviderSecretUpdate; model: string; maxGeneratedShots: number };

export interface ProviderSettingsInput {
  script: ScriptSettingsInput;
  video: VideoSettingsInput;
}

export interface ProviderSectionView {
  provider: "openai" | "deepseek" | "ark" | "http" | "local";
  source: "session" | "server" | "local";
  connected: boolean;
  model?: string;
  baseUrl?: string;
  maxGeneratedShots?: number;
  hasSessionKey: boolean;
}

export interface ProviderSettingsView {
  script: ProviderSectionView;
  video: ProviderSectionView;
}
```

- [ ] **Step 2: Write failing store and resolver tests**

Cover separate sessions, key retention, provider-change rejection, independent fallback, and redaction:

```ts
it("isolates settings by session", () => {
  const store = createProviderSettingsStore();
  store.replace({ id: "session-a", expiresAt: 2_000 }, {
    script: {
      mode: "deepseek",
      apiKey: { action: "replace", value: "deepseek-a" },
      baseUrl: "https://api.deepseek.com/v1",
      model: "deepseek-chat"
    },
    video: {
      mode: "ark",
      apiKey: { action: "replace", value: "ark-video-a" },
      model: "seedance-test",
      maxGeneratedShots: 3
    }
  }, 1_000);
  expect(store.get("session-a", 1_000)?.script?.apiKey).toBe("deepseek-a");
  expect(store.get("session-b", 1_000)).toBeUndefined();
});

it("falls back independently to administrator providers", () => {
  const resolved = resolveProviderConfig(
    { script: { provider: "deepseek", apiKey: "personal", baseUrl: "https://api.deepseek.com/v1", model: "deepseek-chat" } },
    { ARK_API_KEY: "server-ark", ARK_VIDEO_MODEL: "server-video" }
  );
  expect(resolved.planner?.apiKey).toBe("personal");
  expect(resolved.video).toMatchObject({ provider: "ark", apiKey: "server-ark", model: "server-video" });
  expect(JSON.stringify(resolved.view)).not.toContain("personal");
  expect(JSON.stringify(resolved.view)).not.toContain("server-ark");
});
```

- [ ] **Step 3: Run the new test and verify failure**

Run: `npx vitest run src/server/provider-settings.test.ts`

Expected: FAIL because the module does not exist.

- [ ] **Step 4: Implement the in-memory store and resolver**

In `src/server/provider-settings.ts`, define internal stored settings with actual keys and exported operation configuration:

```ts
export interface PlannerConfig {
  provider: "openai" | "deepseek" | "ark";
  apiKey: string;
  baseUrl: string;
  model: string;
  supportsJsonMode: boolean;
  disableThinking: boolean;
}

export type VideoProviderConfig =
  | { provider: "ark"; apiKey: string; model: string; maxGeneratedShots: number }
  | { provider: "http"; endpoint: string; apiKey?: string; maxGeneratedShots: number }
  | { provider: "local"; maxGeneratedShots: 0 };

export interface OperationProviderConfig {
  planner?: PlannerConfig;
  video: VideoProviderConfig;
  view: ProviderSettingsView;
  secrets: string[];
}
```

Implement `createProviderSettingsStore()` with `get(sessionId, now)`, `replace(session, input, now)`, and `clear(sessionId)`, where `session` has `{ id, expiresAt }`. Store each settings record with the signed session expiry. Every `get` and `replace` first prunes all expired records, giving lazy expiry cleanup without timers. `replace` resolves `keep` only against an existing setting for the same provider, requires `replace` for new/provider-changed settings, and removes a section in server mode. Return copies so callers cannot mutate stored values.

Implement `resolveProviderConfig(sessionSettings, environment = process.env)`. Preserve the current administrator priority for scripts (`OPENAI`, then `DEEPSEEK`, then `ARK`, then local) and videos (`ARK`, then generic HTTP, then local). A session override wins only for its own section. Build the redacted `view` without copying any secret fields.

Add `redactProviderError(error, secrets)` that converts an error to text and replaces every non-empty secret with `[redacted]`. Add a test that advances `now` beyond `expiresAt`, triggers a store read, and verifies the expired settings are gone.

- [ ] **Step 5: Run the resolver tests**

Run: `npx vitest run src/server/provider-settings.test.ts`

Expected: PASS, including absence of keys from serialized views.

- [ ] **Step 6: Commit**

```powershell
git add src/shared/provider-settings.ts src/server/provider-settings.ts src/server/provider-settings.test.ts
git commit -m "feat: resolve session provider settings"
```

### Task 3: Add authenticated provider-settings endpoints

**Files:**
- Create: `src/server/provider-settings-http.ts`
- Create: `src/server/provider-settings-http.test.ts`
- Modify: `src/server/index.ts`

- [ ] **Step 1: Write HTTP boundary tests with two cookie jars**

Create an ephemeral Express app with LAN auth, the settings store, and the new routes. Log in twice, retain each `Set-Cookie`, and assert isolation and redaction:

```ts
const firstCookie = await login(baseUrl, "shared-secret");
const secondCookie = await login(baseUrl, "shared-secret");

const saved = await fetch(`${baseUrl}/api/settings/providers`, {
  method: "PUT",
  headers: { Cookie: firstCookie, "Content-Type": "application/json" },
  body: JSON.stringify(personalSettings("personal-script-key", "personal-video-key"))
});
expect(saved.status).toBe(200);
expect(await saved.text()).not.toContain("personal-script-key");

const secondView = await fetch(`${baseUrl}/api/settings/providers`, { headers: { Cookie: secondCookie } });
expect(await secondView.json()).toMatchObject({
  script: { source: "local", hasSessionKey: false },
  video: { source: "local", hasSessionKey: false }
});
```

Also test `keep`, invalid initial `keep`, clear, logout cleanup, authentication-disabled `409`, malformed URLs, overlong model names, and invalid shot limits.

- [ ] **Step 2: Run the route test and verify failure**

Run: `npx vitest run src/server/provider-settings-http.test.ts`

Expected: FAIL because route registration does not exist.

- [ ] **Step 3: Implement Zod validation and route registration**

Create `registerProviderSettingsRoutes(app, auth, store, environment)` after the `/api` authentication middleware. Use a helper that parses the current signed cookie with `auth.readSession` and returns `409` when LAN authentication is disabled.

The PUT schema must enforce:

```ts
const secretUpdateSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("keep") }),
  z.object({ action: z.literal("replace"), value: z.string().trim().min(8).max(500) })
]);

const scriptSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("server") }),
  z.object({
    mode: z.enum(["deepseek", "openai", "ark"]),
    apiKey: secretUpdateSchema,
    baseUrl: z.string().url().max(500).optional(),
    model: z.string().trim().min(1).max(120)
  })
]);
```

Require HTTP(S) URLs for OpenAI-compatible and DeepSeek modes, ignore base URL for Ark, and constrain video `maxGeneratedShots` to integers from 1 through 6. Return only `resolveProviderConfig(store.get(session.id), environment).view`. PUT passes the complete parsed `{ id, expiresAt }` session to `store.replace` so the stored entry shares the cookie's expiry.

In `src/server/index.ts`, create one store before registering auth routes, pass `store.clear` as the logout callback, register settings routes after the `/api` authentication middleware, and make `/api/provider` resolve status from the current request session rather than global environment alone.

- [ ] **Step 4: Run HTTP and existing auth tests**

Run: `npx vitest run src/server/provider-settings-http.test.ts src/server/auth-http.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add src/server/provider-settings-http.ts src/server/provider-settings-http.test.ts src/server/index.ts
git commit -m "feat: expose session provider settings"
```

### Task 4: Make planner and video adapters accept explicit configuration

**Files:**
- Modify: `src/server/planner.ts`
- Modify: `src/server/planner.test.ts`
- Modify: `src/server/providers/video.ts`
- Modify: `src/server/providers/video-materials.test.ts`

- [ ] **Step 1: Write failing explicit-configuration tests**

Add tests that pass provider objects directly without mutating `process.env`:

```ts
it("reports the supplied planner configuration", () => {
  const planner = testPlannerConfig({ provider: "deepseek", model: "personal-model" });
  expect(getPlannerStatus(planner)).toEqual({ connected: true, provider: "deepseek", model: "personal-model" });
});

it("builds Ark requests with the supplied video model", () => {
  const request = buildArkGenerationRequest(brief, shot, [], new Map(), {
    provider: "ark", apiKey: "personal-key", model: "personal-video", maxGeneratedShots: 2
  });
  expect(request.model).toBe("personal-video");
});
```

- [ ] **Step 2: Run focused provider tests and verify failure**

Run: `npx vitest run src/server/planner.test.ts src/server/providers/video-materials.test.ts`

Expected: FAIL because current functions read `process.env` and do not accept these arguments.

- [ ] **Step 3: Refactor the planner to use a passed config**

Import `PlannerConfig` from `provider-settings.ts`. Change `getPlannerStatus(config?: PlannerConfig)`, `planWithLlm(..., config?: PlannerConfig)`, and `createPlan(..., config?: PlannerConfig)`. Remove the private environment-reading `plannerConfig()` function. Preserve local planning when config is undefined.

Replace the current environment-derived endpoint and authorization expressions with values from the passed object. Keep the existing request-body construction unchanged:

```ts
const endpoint = `${config.baseUrl}/chat/completions`;
const headers = {
  "Content-Type": "application/json",
  Authorization: `Bearer ${config.apiKey}`
};
```

- [ ] **Step 4: Refactor video generation to use a passed config**

Pass `VideoProviderConfig` into `getVideoProviderStatus`, `buildArkGenerationRequest`, `arkRequest`, `generateShotAsset`, and `editShotAsset`. `arkRequest` must receive `apiKey` explicitly. `generateShotAsset` branches on `config.provider`; local returns the current motion card, Ark uses its supplied key/model, and HTTP uses its supplied endpoint/key.

Add an exported `ProviderRequestError` with provider and safe message fields. Ark and generic HTTP authentication, quota, timeout, and unavailable failures must throw this type without including request headers or keys. Prompt/material validation errors remain ordinary `Error` instances.

Do not add module-level mutable provider state. Existing pure request builders must remain deterministic.

- [ ] **Step 5: Run all planner and video tests**

Run: `npx vitest run src/server/planner.test.ts src/server/providers/video-materials.test.ts src/server/retouch.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add src/server/planner.ts src/server/planner.test.ts src/server/providers/video.ts src/server/providers/video-materials.test.ts
git commit -m "refactor: pass provider configuration explicitly"
```

### Task 5: Capture provider snapshots in queued operations

**Files:**
- Modify: `src/server/pipeline.ts`
- Create: `src/server/pipeline-provider-settings.test.ts`
- Modify: `src/server/providers/video.ts`
- Modify: `src/server/index.ts`

- [ ] **Step 1: Write failing snapshot tests**

Export `captureOperationProviderConfig` from `pipeline.ts`. It returns a `structuredClone` of the supplied settings, and every enqueue function must call it before creating its async closure. Test that later mutations of the source cannot change the captured snapshot:

```ts
it("uses the configuration captured when work is enqueued", async () => {
  const first = resolvedConfig("first-key");
  const captured = captureOperationProviderConfig(first);
  if (first.video.provider !== "ark" || captured.video.provider !== "ark") throw new Error("expected Ark test configuration");
  first.video.apiKey = "second-key";
  expect(captured.video.apiKey).toBe("first-key");
});
```

Add a second test that `redactProviderError(new Error("failed first-key"), captured.secrets)` returns text containing `[redacted]` and not `first-key`.

Prefer testing a focused exported helper over starting ffmpeg or contacting a provider.

- [ ] **Step 2: Run the test and verify failure**

Run: `npx vitest run src/server/pipeline-provider-settings.test.ts`

Expected: FAIL because enqueue functions have no provider argument.

- [ ] **Step 3: Thread immutable snapshots through the pipeline**

Change signatures to:

```ts
export function enqueuePlanning(jobId: string, providers: OperationProviderConfig): void;
export function enqueueRendering(jobId: string, providers: OperationProviderConfig): void;
export function enqueueRetry(jobId: string, providers: OperationProviderConfig): void;
export function enqueueRetouch(jobId: string, shotId: string, visualAction: RetouchVisualAction, providers: OperationProviderConfig): void;
```

Pass `providers.planner` to `createPlan`, and `providers.video` to status, generation, and editing calls. Each enqueue closure captures the supplied immutable snapshot before entering the concurrency gate.

Use `redactProviderError(error, providers.secrets)` for console messages, job errors, and fallback event details so neither a submitted key nor an administrator key can be persisted or printed.

When the per-shot generation catch receives `ProviderRequestError`, rethrow it so an invalid key, exhausted quota, timeout, or unavailable provider fails the job with a visible safe message. Retain the existing local-motion-card fallback for ordinary prompt/material errors and for shots excluded by generation policy.

- [ ] **Step 4: Resolve current-session configuration in every command route**

In `src/server/index.ts`, add one helper:

```ts
function providersFor(request: express.Request): OperationProviderConfig {
  const session = authSessionForRequest(request, lanAuth);
  return resolveProviderConfig(session ? providerSettings.get(session.id) : undefined, process.env);
}
```

Use it for create job, render, retry, and retouch calls. GET `/api/provider` reports the same effective configuration. Never put the resolved object into `VideoJob`, SQLite, events, or response JSON.

- [ ] **Step 5: Run pipeline and route tests**

Run: `npx vitest run src/server/pipeline-provider-settings.test.ts src/server/job-lifecycle.test.ts src/server/provider-settings-http.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add src/server/pipeline.ts src/server/pipeline-provider-settings.test.ts src/server/providers/video.ts src/server/index.ts
git commit -m "feat: capture provider settings per operation"
```

### Task 6: Add the client settings API and form model

**Files:**
- Modify: `src/client/api.ts`
- Create: `src/client/provider-settings-form.ts`
- Create: `src/client/provider-settings-form.test.ts`

- [ ] **Step 1: Write failing form-payload tests**

Test that blank secret inputs keep an existing same-provider key, non-blank values replace it, provider changes require a new key, and server mode sends no key:

```ts
it("keeps a saved key when its secret input remains blank", () => {
  const result = buildScriptSettingsInput(
    { mode: "deepseek", model: "deepseek-chat", baseUrl: "https://api.deepseek.com/v1", apiKey: "" },
    { provider: "deepseek", hasSessionKey: true }
  );
  expect(result.apiKey).toEqual({ action: "keep" });
});

it("requires replacement after changing providers", () => {
  expect(() => buildScriptSettingsInput(
    { mode: "openai", model: "gpt-5-mini", baseUrl: "https://api.openai.com/v1", apiKey: "" },
    { provider: "deepseek", hasSessionKey: true }
  )).toThrow("切换脚本服务后请输入新的 API Key");
});
```

- [ ] **Step 2: Run the form-model test and verify failure**

Run: `npx vitest run src/client/provider-settings-form.test.ts`

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement pure payload builders and client methods**

Keep form-to-request conversion in `provider-settings-form.ts`, with no React dependency. Add to `api.ts`:

```ts
getProviderSettings: () => request<ProviderSettingsView>("/api/settings/providers"),
saveProviderSettings: (input: ProviderSettingsInput) => request<ProviderSettingsView>("/api/settings/providers", {
  method: "PUT", body: JSON.stringify(input)
}),
clearProviderSettings: () => request<ProviderSettingsView>("/api/settings/providers", { method: "DELETE" })
```

- [ ] **Step 4: Run client model tests**

Run: `npx vitest run src/client/provider-settings-form.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add src/client/api.ts src/client/provider-settings-form.ts src/client/provider-settings-form.test.ts
git commit -m "feat: add provider settings client model"
```

### Task 7: Build and integrate the API settings dialog

**Files:**
- Create: `src/client/ProviderSettingsDialog.tsx`
- Modify: `src/client/App.tsx`
- Modify: `src/client/styles.css`

- [ ] **Step 1: Implement the focused dialog component**

Create a controlled modal that loads a `ProviderSettingsView`, keeps secrets only in component state until save, and clears those state fields after a successful request. Its props are:

```ts
interface ProviderSettingsDialogProps {
  initial: ProviderSettingsView;
  onClose: () => void;
  onSaved: (view: ProviderSettingsView) => void;
}
```

Use a select for the script provider (`server`, `deepseek`, `openai`, `ark`), a password input, model input, and conditional base URL input. Use a separate select for video (`server`, `ark`), password/model inputs, and numeric generated-shot stepper constrained to 1-6. Display compact source labels: `个人会话`, `服务器默认`, or `本地模式`.

The clear button must require an inline confirmation state before calling DELETE. Do not use `localStorage`, `sessionStorage`, URL state, or a password value returned by the server.

- [ ] **Step 2: Integrate the dialog into the authenticated app**

In `App.tsx`, import Lucide `Settings2`, add `providerSettings` and `settingsOpen` state, and load settings alongside the existing jobs/stats/provider/material requests only when `authRequired` is true. Add a top-bar icon button before logout:

```tsx
{authRequired && (
  <button className="topbar-icon-button" type="button" title="API 设置" aria-label="API 设置" onClick={() => setSettingsOpen(true)}>
    <Settings2 size={17} />
  </button>
)}
```

After save or clear, update the view, close only on save, and call `api.getProvider()` so the current generation policy/status refreshes immediately. Logout must clear all client-side settings state.

- [ ] **Step 3: Style stable desktop and mobile layouts**

Add un-nested modal sections with a maximum width near 620px, two columns on desktop, one column below 640px, fixed-height icon buttons, visible focus states, and non-overlapping action buttons. Reuse current `--ink`, `--paper`, `--line`, `--teal`, and error colors rather than introducing a new palette.

- [ ] **Step 4: Run type-aware tests and production build**

Run: `npm test`

Expected: all tests PASS.

Run: `npm run build`

Expected: server TypeScript and Vite client builds PASS without type errors.

- [ ] **Step 5: Commit**

```powershell
git add src/client/ProviderSettingsDialog.tsx src/client/App.tsx src/client/styles.css
git commit -m "feat: add session API settings dialog"
```

### Task 8: Document behavior and perform release verification

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Document session settings and fallback behavior**

Add a LAN usage section stating:

```markdown
Authenticated users can open **API settings** to supply separate script and Seedance credentials for the current browser session. Personal keys are kept only in server memory, are never returned to the browser after submission, and are cleared on logout, session expiry, or server restart. A section left on **Server default** uses the matching environment variables; if neither is configured, the existing local fallback is used.
```

State that running operations retain their captured settings, retry uses the initiating session's current settings, generic HTTP video configuration remains administrator-managed, and LAN authentication must be enabled for personal settings.

- [ ] **Step 2: Run the complete automated verification**

Run: `npm test`

Expected: all test files and tests PASS.

Run: `npm run build`

Expected: `dist/server/index.js` and `dist/client/index.html` exist.

Run: `npm audit --omit=dev`

Expected: 0 production vulnerabilities.

- [ ] **Step 3: Run an authenticated two-session HTTP smoke test**

Start the compiled server on an unused loopback port with `LAN_ACCESS_TOKEN` set and administrator API variables unset. Log in twice using separate cookie jars. Save different keys in the first session and assert:

- the first GET reports `source: "session"` and never returns either key;
- the second GET remains `source: "local"`;
- logout clears the first session's in-memory settings;
- protected settings endpoints reject missing cookies with `401`.

Expected: every assertion succeeds and the server exits cleanly.

- [ ] **Step 4: Perform browser QA**

Open the production build at 1440x900 and 390x844. Verify login, opening/closing the settings dialog, provider-dependent fields, blank secret behavior, save, source labels, clear confirmation, and no overlap or horizontal scroll. Verify browser console has zero errors and settings endpoints never expose key text.

- [ ] **Step 5: Commit documentation**

```powershell
git add README.md
git commit -m "docs: explain personal API settings"
```

- [ ] **Step 6: Confirm a clean release state**

Run: `git status --short --branch`

Expected: branch name only, with no modified or untracked files.
