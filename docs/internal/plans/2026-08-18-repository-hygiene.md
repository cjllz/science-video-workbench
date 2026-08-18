# Repository Hygiene Checks Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a dependency-free repository hygiene check, a version-controlled pre-commit hook, and authoritative usage documentation so generated files, runtime data, real configuration, secrets, databases, logs, and media output cannot enter normal commits unnoticed.

**Architecture:** A Node.js script queries Git for either all tracked paths or the staged snapshot, applies deterministic path rules, and scans small staged text blobs for high-confidence secret markers without printing their values. A project-local POSIX hook calls staged mode, npm scripts expose installation and verification, and the existing README and project manual remain the only user-facing instructions.

**Tech Stack:** Node.js 22 standard library, Git CLI, POSIX shell, npm scripts, Node test runner, Markdown.

---

## File Map

| Path | Responsibility |
| --- | --- |
| `scripts/check-repository.mjs` | Query Git, enforce path/content rules, and return a stable exit code. |
| `scripts/check-repository.node-test.mjs` | Exercise the checker against isolated temporary Git repositories without entering Vitest discovery. |
| `.githooks/pre-commit` | Run staged hygiene checks without changing the index or worktree. |
| `.gitattributes` | Force LF line endings for the hook on Windows and Linux. |
| `.gitignore` | Keep generated/runtime/private files out of normal Git discovery. |
| `.dockerignore` | Keep the same irrelevant/private files out of Docker build context. |
| `package.json` | Expose `repo:check`, `hooks:install`, `test:repo`, and the complete `verify` pipeline. |
| `README.md` | Give every new clone the short hook-install and verification path. |
| `docs/PROJECT-MANUAL.md` | Document policy, commands, failure handling, and release checks in the authoritative manual. |

## Task 1: Specify the Checker with Temporary-Repository Tests

**Files:**
- Create: `scripts/check-repository.node-test.mjs`

- [ ] **Step 1: Add a temporary Git repository test harness**

Create `scripts/check-repository.node-test.mjs` with helpers that never touch the real repository index:

```js
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const checker = fileURLToPath(new URL("./check-repository.mjs", import.meta.url));

function git(repository, ...args) {
  return execFileSync("git", args, {
    cwd: repository,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });
}

function write(repository, relativePath, contents) {
  const absolutePath = path.join(repository, relativePath);
  mkdirSync(path.dirname(absolutePath), { recursive: true });
  writeFileSync(absolutePath, contents);
}

function makeRepository(t) {
  const repository = mkdtempSync(path.join(tmpdir(), "repository-hygiene-"));
  t.after(() => rmSync(repository, { recursive: true, force: true }));
  git(repository, "init", "--quiet");
  git(repository, "config", "user.name", "Repository Hygiene Test");
  git(repository, "config", "user.email", "repository-hygiene@example.invalid");
  write(repository, ".gitignore", [
    "node_modules/", "dist/", "data/", "output/", ".env", "*.log"
  ].join("\n"));
  return repository;
}

function runChecker(repository, ...args) {
  return spawnSync(process.execPath, [checker, ...args], {
    cwd: repository,
    encoding: "utf8"
  });
}

function output(result) {
  return `${result.stdout ?? ""}${result.stderr ?? ""}`;
}
```

- [ ] **Step 2: Add acceptance and rejection tests**

Append these cases to the same file:

```js
test("staged mode accepts source and example environment files", (t) => {
  const repository = makeRepository(t);
  write(repository, "src/app.js", "export const ready = true;\n");
  write(repository, ".env.example", "API_KEY=example-not-a-real-key\n");
  write(repository, "deploy/.env.production.example", "LAN_HOST=science-video.lan\n");
  git(repository, "add", ".");

  const result = runChecker(repository, "--staged");

  assert.equal(result.status, 0, output(result));
  assert.match(result.stdout, /暂存区检查通过/);
});

test("staged mode rejects forced generated files and real environment files", (t) => {
  const repository = makeRepository(t);
  write(repository, "dist/generated.js", "generated\n");
  write(repository, ".env", "TOKEN=not-printed\n");
  git(repository, "add", "--force", "dist/generated.js", ".env");

  const result = runChecker(repository, "--staged");
  const combined = output(result);

  assert.equal(result.status, 1, combined);
  assert.match(combined, /dist\/generated\.js/);
  assert.match(combined, /\.env/);
  assert.doesNotMatch(combined, /not-printed/);
});

test("staged mode reports a private key rule without printing key contents", (t) => {
  const repository = makeRepository(t);
  const secretPayload = "PRIVATE_PAYLOAD_MUST_NOT_APPEAR";
  write(
    repository,
    "notes/credential.txt",
    `-----BEGIN OPENSSH PRIVATE KEY-----\n${secretPayload}\n`
  );
  git(repository, "add", "notes/credential.txt");

  const result = runChecker(repository, "--staged");
  const combined = output(result);

  assert.equal(result.status, 1, combined);
  assert.match(combined, /notes\/credential\.txt/);
  assert.match(combined, /私钥头/);
  assert.doesNotMatch(combined, new RegExp(secretPayload));
});

test("staged mode allows deletion of a previously tracked forbidden file", (t) => {
  const repository = makeRepository(t);
  write(repository, ".env", "TOKEN=legacy\n");
  git(repository, "add", "--force", ".env", ".gitignore");
  git(repository, "commit", "--quiet", "-m", "test: create legacy state");
  rmSync(path.join(repository, ".env"));
  git(repository, "add", "--update");

  const result = runChecker(repository, "--staged");

  assert.equal(result.status, 0, output(result));
});

test("full mode rejects tracked ignored output", (t) => {
  const repository = makeRepository(t);
  write(repository, "output/result.mp4", "not-a-real-video\n");
  git(repository, "add", "--force", "output/result.mp4", ".gitignore");
  git(repository, "commit", "--quiet", "-m", "test: create invalid tracked state");

  const result = runChecker(repository);
  const combined = output(result);

  assert.equal(result.status, 1, combined);
  assert.match(combined, /output\/result\.mp4/);
  assert.match(combined, /忽略规则/);
});

test("unknown arguments fail closed", (t) => {
  const repository = makeRepository(t);
  const result = runChecker(repository, "--unknown");

  assert.equal(result.status, 2, output(result));
  assert.match(output(result), /用法/);
});
```

- [ ] **Step 3: Run the tests and verify the missing implementation fails**

Run:

```powershell
node --test scripts/check-repository.node-test.mjs
```

Expected: FAIL because `scripts/check-repository.mjs` does not exist yet; no file is added to the real repository index by the tests.

- [ ] **Step 4: Commit the test specification**

```powershell
git add scripts/check-repository.node-test.mjs
git commit -m "test: specify repository hygiene checks"
```

Expected: one test-only commit; `git status --short` shows no temporary test repositories because they live under the operating-system temp directory and are deleted by `t.after`.

## Task 2: Implement the Repository Checker

**Files:**
- Create: `scripts/check-repository.mjs`
- Test: `scripts/check-repository.node-test.mjs`

- [ ] **Step 1: Implement Git path discovery and deterministic path rules**

Create `scripts/check-repository.mjs` with this complete implementation:

```js
import { execFileSync } from "node:child_process";
import path from "node:path";
import process from "node:process";

const root = process.cwd();
const maximumTextBytes = 1024 * 1024;
const forbiddenDirectories = new Set([
  "node_modules", "dist", "coverage", ".cache", ".vite", "data", "output",
  ".artifacts", ".playwright-cli", ".qa", ".worktrees", ".superpowers"
]);
const forbiddenExtensions = new Set([
  ".log", ".tmp", ".temp", ".bak", ".swp", ".swo", ".tsbuildinfo",
  ".sqlite", ".sqlite3", ".db", ".pem", ".key", ".p12", ".pfx",
  ".mp4", ".mov", ".webm", ".wav", ".mp3"
]);
const secretRules = [
  { name: "私钥头", pattern: /-----BEGIN (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----/ },
  { name: "OpenAI 风格长密钥", pattern: /\bsk-(?:proj-)?[A-Za-z0-9_-]{32,}\b/ },
  { name: "AWS Access Key", pattern: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: "GitHub Token", pattern: /\bgh[pousr]_[A-Za-z0-9]{36,}\b/ }
];

function runGit(args, options = {}) {
  try {
    return execFileSync("git", args, {
      cwd: root,
      encoding: options.binary ? null : "utf8",
      maxBuffer: options.maxBuffer,
      stdio: ["ignore", "pipe", "pipe"]
    });
  } catch (error) {
    const detail = Buffer.isBuffer(error.stderr)
      ? error.stderr.toString("utf8").trim()
      : String(error.stderr ?? "").trim();
    throw new Error(`Git 命令执行失败: git ${args.join(" ")}${detail ? `\n${detail}` : ""}`);
  }
}

function gitPaths(args) {
  return runGit([...args, "-z"])
    .split("\0")
    .filter(Boolean)
    .map((file) => file.replaceAll("\\", "/"));
}

function pathReasons(file) {
  const normalized = file.replaceAll("\\", "/").replace(/^\.\//, "");
  const components = normalized.split("/");
  const basename = components.at(-1).toLowerCase();
  const reasons = [];

  const forbiddenDirectory = components
    .slice(0, -1)
    .find((component) => forbiddenDirectories.has(component.toLowerCase()));
  if (forbiddenDirectory) reasons.push(`禁止跟踪目录: ${forbiddenDirectory}`);

  if (normalized === ".env" || normalized === "deploy/.env.production") {
    reasons.push("真实环境配置文件");
  }
  if (basename === ".ds_store" || basename === "thumbs.db") {
    reasons.push("操作系统生成文件");
  }
  if (/^npm-debug\.log(?:\..*)?$/i.test(basename)) {
    reasons.push("npm 调试日志");
  }

  const extension = path.posix.extname(normalized).toLowerCase();
  if (forbiddenExtensions.has(extension)) {
    reasons.push(`禁止跟踪扩展名: ${extension}`);
  }
  return reasons;
}

function stagedSecretReasons(file) {
  const object = `:${file}`;
  const size = Number.parseInt(runGit(["cat-file", "-s", object]).trim(), 10);
  if (!Number.isSafeInteger(size) || size < 0) {
    throw new Error(`无法确定暂存文件大小: ${file}`);
  }
  if (size > maximumTextBytes) return [];

  const contents = runGit(["show", object], {
    binary: true,
    maxBuffer: maximumTextBytes + 1
  });
  if (contents.includes(0)) return [];

  let text;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(contents);
  } catch {
    return [];
  }
  return secretRules
    .filter(({ pattern }) => pattern.test(text))
    .map(({ name }) => `疑似秘密内容: ${name}`);
}

function addFailure(failures, file, reason) {
  if (!failures.has(file)) failures.set(file, new Set());
  failures.get(file).add(reason);
}

function main() {
  const args = process.argv.slice(2);
  if (args.length > 1 || (args.length === 1 && args[0] !== "--staged")) {
    console.error("用法: node scripts/check-repository.mjs [--staged]");
    return 2;
  }

  const staged = args[0] === "--staged";
  const files = staged
    ? gitPaths(["diff", "--cached", "--name-only", "--diff-filter=ACMR"])
    : gitPaths(["ls-files"]);
  const failures = new Map();

  for (const file of files) {
    for (const reason of pathReasons(file)) addFailure(failures, file, reason);
    if (staged) {
      for (const reason of stagedSecretReasons(file)) addFailure(failures, file, reason);
    }
  }

  if (!staged) {
    for (const file of gitPaths(["ls-files", "-ci", "--exclude-standard"])) {
      addFailure(failures, file, "已跟踪文件命中当前忽略规则");
    }
  }

  if (failures.size > 0) {
    for (const file of [...failures.keys()].sort()) {
      for (const reason of [...failures.get(file)].sort()) {
        console.error(`- ${file}: ${reason}`);
      }
    }
    console.error("仓库整洁检查失败。请取消暂存，或将生成/私密文件移出版本控制后重试。");
    return 1;
  }

  const label = staged ? "暂存区" : "全仓库";
  console.log(`${label}检查通过，共检查 ${files.length} 个文件。`);
  return 0;
}

try {
  process.exitCode = main();
} catch (error) {
  console.error(`仓库整洁检查无法完成: ${error.message}`);
  process.exitCode = 1;
}
```

- [ ] **Step 2: Run the focused tests**

Run:

```powershell
node --test scripts/check-repository.node-test.mjs
```

Expected: 6 tests pass. The output must not contain `PRIVATE_PAYLOAD_MUST_NOT_APPEAR` or `not-printed`.

- [ ] **Step 3: Run the checker against the real tracked repository**

Run:

```powershell
node scripts/check-repository.mjs
```

Expected: exit 0 with `全仓库检查通过`; ignored local directories and log files do not fail because they are not tracked.

- [ ] **Step 4: Commit the implementation**

```powershell
git add scripts/check-repository.mjs
git commit -m "feat: enforce repository hygiene rules"
```

Expected: the test commit remains separate, and the implementation commit contains only the checker.

## Task 3: Wire the Hook, npm Commands, and Ignore Rules

**Files:**
- Create: `.githooks/pre-commit`
- Modify: `.gitattributes`
- Modify: `.gitignore`
- Modify: `.dockerignore`
- Modify: `package.json`
- Test: `scripts/check-repository.node-test.mjs`

- [ ] **Step 1: Add the project-local hook**

Create `.githooks/pre-commit`:

```sh
#!/usr/bin/env sh
set -eu

npm run repo:check -- --staged
```

Append this rule to `.gitattributes` so Git for Windows and Linux both preserve the hook's LF shell syntax:

```gitattributes
.githooks/* text eol=lf
```

After staging the hook, record its executable bit in Git:

```powershell
git update-index --add --chmod=+x .githooks/pre-commit
```

- [ ] **Step 2: Expand ignore rules without hiding source assets**

Keep the existing `.gitignore` entries and append:

```gitignore
coverage/
.cache/
.vite/
*.tsbuildinfo
*.tmp
*.temp
*.bak
*.swp
*.swo
.DS_Store
Thumbs.db
*.sqlite
*.sqlite3
*.db
*.pem
*.key
*.p12
*.pfx
*.mp4
*.mov
*.webm
*.wav
*.mp3
```

Append the same patterns to `.dockerignore`, retaining its existing entries. Do not add broad image patterns such as `*.png`, `*.jpg`, or `fixtures/`, because they can be legitimate source/test assets.

- [ ] **Step 3: Add npm entry points and put hygiene first in verification**

Update only the `scripts` object in `package.json` so these entries are present:

```json
{
  "hooks:install": "git config --local core.hooksPath .githooks",
  "repo:check": "node scripts/check-repository.mjs",
  "test:repo": "node --test scripts/check-repository.node-test.mjs",
  "docs:check": "node scripts/check-docs.mjs",
  "verify": "npm run repo:check && npm run test:repo && npm run docs:check && npm test && npm run build"
}
```

Preserve every existing script not shown in this excerpt.

- [ ] **Step 4: Verify the hook does not mutate staged state**

Run:

```powershell
npm run hooks:install
git config --local --get core.hooksPath
git diff --cached --name-status | Set-Content -Encoding utf8 $env:TEMP\science-video-index-before.txt
& .\.githooks\pre-commit
git diff --cached --name-status | Set-Content -Encoding utf8 $env:TEMP\science-video-index-after.txt
Compare-Object (Get-Content $env:TEMP\science-video-index-before.txt) (Get-Content $env:TEMP\science-video-index-after.txt)
```

Expected: `core.hooksPath` is `.githooks`, the hook exits 0, and `Compare-Object` prints nothing. Remove the two files from the operating-system temp directory after comparison.

- [ ] **Step 5: Prove forced staging is blocked, then restore the real index**

Use a dedicated ignored file, never an existing project file:

```powershell
New-Item -ItemType Directory -Force dist | Out-Null
Set-Content -Encoding utf8 dist\repository-hygiene-probe.js 'generated'
git add --force dist/repository-hygiene-probe.js
npm run repo:check -- --staged
git restore --staged dist/repository-hygiene-probe.js
Remove-Item -LiteralPath dist\repository-hygiene-probe.js
git status --short
```

Expected: staged check exits 1 and names `dist/repository-hygiene-probe.js`; after cleanup, that path is absent from `git status --short`. Do not commit the probe.

- [ ] **Step 6: Run focused checks and commit the wiring**

Run:

```powershell
npm run test:repo
npm run repo:check
git diff --check
```

Expected: tests and full check pass, and `git diff --check` is silent.

Then commit:

```powershell
git add .gitattributes .gitignore .dockerignore package.json
git update-index --add --chmod=+x .githooks/pre-commit
git commit -m "chore: install repository hygiene guard"
```

## Task 4: Update the Existing Authoritative Documentation

**Files:**
- Modify: `README.md`
- Modify: `docs/PROJECT-MANUAL.md`

- [ ] **Step 1: Extend the README development verification section**

In `README.md`, replace the current development-verification block with:

````markdown
## 开发验证

首次克隆并安装依赖后，为当前仓库启用版本控制内的提交检查：

```powershell
npm install
npm run hooks:install
```

日常检查和正式提交前执行：

```powershell
npm run repo:check
npm run docs:check
npm test
npm run build
npm run verify
```

`npm run verify` 会依次检查仓库整洁度、检查器自身测试、正式文档、业务测试和生产构建。`pre-commit` hook 只检查暂存内容，不会自动暂存、取消暂存或删除文件；构建产物、运行数据、真实环境文件、日志、数据库、证书私钥和媒体输出会被拒绝。Docker 镜像构建、Caddy 证书和真实局域网功能必须在目标 Linux 主机上额外验收。
````

- [ ] **Step 2: Document commands and test layout in the project manual**

In section `18.3 常用开发命令`, add or update these rows:

```markdown
| `npm run hooks:install` | 为当前克隆启用项目内 pre-commit hook | `core.hooksPath` 为 `.githooks` |
| `npm run repo:check` | 检查全部已跟踪文件的仓库整洁度 | 输出全仓库检查通过和文件数 |
| `npm run test:repo` | 在临时 Git 仓库测试整洁检查器 | 6 个检查器测试通过 |
| `npm run verify` | 整洁检查、检查器测试、文档检查、业务测试和生产构建 | 五步全部通过 |
```

In section `18.4 测试布局`, add:

```markdown
- `scripts/check-repository.node-test.mjs`：在操作系统临时目录创建隔离 Git 仓库，验证强制暂存、示例配置、秘密内容和删除行为；文件名避免被 Vitest 重复收集。
- `scripts/check-repository.mjs`：检查全部已跟踪文件或即将提交的暂存快照，不读取未暂存版本代替暂存内容。
```

- [ ] **Step 3: Update release order and replace the submission policy**

At the start of section `18.6 正式发布验证顺序`, use:

```powershell
npm run verify
npm audit --omit=dev
git diff --check
git status --short --branch
```

Replace section `18.7 提交范围` with the following complete policy:

```markdown
### 18.7 提交范围与自动拦截

每个新克隆在 `npm install` 后执行一次 `npm run hooks:install`。该命令只把当前仓库的 `core.hooksPath` 设置为 `.githooks`，不会修改全局 Git 配置或其他项目。

提交钩子运行 `npm run repo:check -- --staged`，只检查即将提交的 Git 暂存快照，不会自动暂存、取消暂存、修改或删除文件。下列内容不得进入 Git：

- `node_modules`、`dist`、`coverage`、工具缓存、`data`、`output` 和本地 QA/worktree/agent 临时目录；
- 根目录 `.env`、`deploy/.env.production`、日志、临时文件、备份文件和 TypeScript 增量文件；
- SQLite/数据库文件、证书私钥和生成的视频/音频；
- PEM/OpenSSH 私钥头或符合高风险格式的长 API Key。

`.env.example` 和 `deploy/.env.production.example` 是必须保留的安全示例。正常源代码图片不被扩展名规则禁止。

钩子失败时，根据输出的路径取消暂存，例如 `git restore --staged <路径>`，再把生成文件删除或移出仓库；真实配置和密钥应保存在受控位置。检查器只打印路径与规则名，不打印匹配到的秘密值。不要用 `git add -f` 或 `git commit --no-verify` 绕过；只有代码库维护者明确批准的紧急处置才可临时绕过，并须立即补做 `npm run repo:check`、密钥处置和提交审计。

文档、测试和业务代码应按职责提交。提交前仍应执行 `npm run verify`、`git diff --check` 和 `git status --short`，确认没有无关文件。
```

- [ ] **Step 4: Validate documentation and commit it separately**

Run:

```powershell
npm run docs:check
npm run repo:check
git diff --check
```

Expected: both checkers pass and whitespace validation is silent.

Then commit:

```powershell
git add README.md docs/PROJECT-MANUAL.md
git commit -m "docs: document clean configuration and commits"
```

## Task 5: Run Release-Grade Verification and Leave a Clean Repository

**Files:**
- Verify only; do not create or commit generated artifacts.

- [ ] **Step 1: Run the complete project verification**

```powershell
npm run verify
```

Expected sequence:

1. Full repository hygiene check passes.
2. Six repository-checker tests pass.
3. Documentation check passes.
4. Existing Vitest suite passes.
5. Server and client production builds pass.

The build creates ignored `dist/` output locally; it must remain untracked.

- [ ] **Step 2: Run the production dependency audit**

```powershell
npm audit --omit=dev
```

Expected: exit 0 with no production vulnerabilities. If registry access is unavailable, record that exact limitation instead of claiming the audit passed.

- [ ] **Step 3: Confirm local hook configuration and tracked-file policy**

```powershell
git config --local --get core.hooksPath
npm run repo:check -- --staged
git ls-files -ci --exclude-standard
```

Expected: `.githooks`; staged check passes; `git ls-files -ci --exclude-standard` prints nothing.

- [ ] **Step 4: Confirm no intermediate or generated files entered a commit**

```powershell
git diff --check
git status --short --branch
git log --oneline -6
```

Expected: whitespace check is silent; status contains no staged/untracked implementation debris and only shows ignored local runtime/build files when explicitly requested with `--ignored`; recent commits are scoped to tests, checker, hook/config, and documentation.

- [ ] **Step 5: Record final limitations accurately**

Do not claim Docker deployment validation on this Windows development machine if Docker remains unavailable. Report that repository checks, tests, build, docs, audit, and hook behavior were verified locally, while Linux image build and real LAN acceptance still follow chapters 7-12 and 18 of `docs/PROJECT-MANUAL.md` on the target server.

## Self-Review Record

- Spec coverage: full/staged modes, forced-add protection, tracked-ignore detection, high-confidence secret scanning, 1 MiB limit, deletion handling, local hook installation, ignore rules, existing-doc updates, and final cleanup all map to explicit tasks.
- Scope: no business logic, deployment topology, environment-variable meaning, remote CI, Git history, or global Git configuration changes are included.
- Placeholder scan: the plan contains no unfinished placeholder markers or unspecified implementation steps.
- Name consistency: `repo:check`, `test:repo`, `hooks:install`, `--staged`, `.githooks/pre-commit`, and `scripts/check-repository.mjs` are identical across code, tests, npm scripts, and documentation.
- Safety: all negative tests run in operating-system temporary repositories except one explicit forced-stage probe; that probe has mandatory unstage/delete cleanup before any commit.
