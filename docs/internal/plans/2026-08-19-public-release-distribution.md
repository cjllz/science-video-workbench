# Public Release Distribution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publish the application as a versioned public GHCR image and GitHub Release containing a tested one-command Linux amd64 server installation bundle, while preserving Gitee as a non-destructive mirror.

**Architecture:** Keep source deployment intact, but add a separate `release/` surface whose Compose file references an immutable public image and whose shell commands configure, install, update, and stop the service without containing application source. A standard-library Node packager assembles release assets from an explicit allowlist, and a tag-triggered GitHub Actions workflow verifies, pushes, packages, checksums, and publishes the same version.

**Tech Stack:** Bash, Docker Compose v2, Docker Buildx, GHCR, GitHub Actions, Node.js 22 standard library, Vitest, Markdown, Git.

---

## File Map

| Path | Responsibility |
| --- | --- |
| `release/lib.sh` | Shared root, architecture, path, environment, Docker and Compose safety helpers. |
| `release/configure.sh` | Interactive/non-interactive production environment creation with secret-safe permissions. |
| `release/install.sh` | Idempotent first install, directory initialization, image pull, startup and readiness. |
| `release/update.sh` | Idle/backup-gated image update with old-image reporting and rollback instructions. |
| `release/uninstall.sh` | Default stop/remove that preserves data, config and Caddy CA; guarded destructive mode. |
| `release/compose.release.yaml` | Runtime-only app and Caddy topology using a fixed GHCR image without `build:`. |
| `release/README.txt` | Minimal text entry point bundled with every release. |
| `release/release-scripts.test.ts` | Static and executable safety contracts for release scripts and Compose. |
| `scripts/build-release.mjs` | Allowlist-based package assembly, tar creation and SHA-256 generation. |
| `scripts/build-release.test.ts` | Verifies package contents, modes, version and secret/source exclusions. |
| `.github/workflows/release.yml` | Tag validation, tests, audit, image publication, bundle creation and GitHub Release. |
| `CHANGELOG.md` | User/operator-facing version history. |
| `README.md` | Stable release and one-command installation entry. |
| `docs/DEPLOYMENT.md` | Release installation, certificates, upgrade, rollback and source-build fallback. |
| `docs/DEVELOPMENT.md` | Release maintenance, versioning and workflow contract. |
| `package.json` | `release:package` command. |

## Task 1: Define Release-Script Safety Contracts

**Files:**
- Create: `release/release-scripts.test.ts`
- Modify: `vitest.config.ts`

- [ ] **Step 1: Write the failing static contract tests**

Create tests that read the planned release files and assert:

```ts
expect(compose).toContain("image: ${APP_IMAGE:?APP_IMAGE must be set}:${APP_VERSION:?APP_VERSION must be set}");
expect(compose).not.toContain("build:");
expect(install).toContain("require_root");
expect(install).toContain("require_amd64");
expect(install).toContain(".science-video-workbench-data");
expect(update).toContain("check-idle");
expect(update).toContain("backup.sh");
expect(uninstall).toContain("--destroy-data");
expect(uninstall).toContain("--confirm-destroy-data");
```

Add a test that runs every shell file through `bash -n` when Bash is available. Add `release/**/*.test.ts` to the normal Vitest discovery without changing the `.worktrees/**` exclusion.

- [ ] **Step 2: Run the test and verify RED**

```powershell
npx vitest run release/release-scripts.test.ts
```

Expected: FAIL because the release scripts and Compose file do not exist.

- [ ] **Step 3: Commit the failing contract**

```powershell
git add release/release-scripts.test.ts vitest.config.ts
git commit -m "test: define server release contracts"
```

## Task 2: Implement the Runtime-Only Compose Topology

**Files:**
- Create: `release/compose.release.yaml`
- Create: `release/Caddyfile`
- Test: `release/release-scripts.test.ts`

- [ ] **Step 1: Create the image-only app service**

Copy the security and persistence properties from root `compose.yaml`, but replace the build stanza with:

```yaml
services:
  app:
    image: ${APP_IMAGE:?APP_IMAGE must be set}:${APP_VERSION:?APP_VERSION must be set}
    platform: linux/amd64
```

Retain all application environment variables, `/app/data` bind mount, read-only root, `/tmp` tmpfs, UID-compatible entrypoint, health check, log rotation, private backend network and no published 8787 port. Retain Caddy on `${LAN_BIND_ADDRESS}:${HTTP_PORT}/${HTTPS_PORT}`, and mount `./Caddyfile` read-only plus named CA/config volumes.

- [ ] **Step 2: Add a production-only Caddyfile**

Use the existing internal-CA behavior exactly:

```caddyfile
{$LAN_HOST} {
  tls internal
  encode zstd gzip
  reverse_proxy app:8787
}
```

- [ ] **Step 3: Validate syntax and topology**

Run static tests, then on a host with Docker:

```bash
APP_IMAGE=ghcr.io/cjllz/science-video-workbench \
APP_VERSION=0.1.0 LAN_HOST=science-video.lan LAN_BIND_ADDRESS=127.0.0.1 \
DATA_DIR=/srv/science-video-workbench/data LAN_ACCESS_TOKEN=example-token-1234 \
docker compose -f release/compose.release.yaml config --quiet
```

Expected: exit 0 and no `build:` entry in rendered config.

- [ ] **Step 4: Commit**

```powershell
git add release/compose.release.yaml release/Caddyfile
git commit -m "feat: add runtime-only release topology"
```

## Task 3: Implement Configuration and Shared Safety Helpers

**Files:**
- Create: `release/lib.sh`
- Create: `release/configure.sh`
- Create: `release/.env.production.example`
- Test: `release/release-scripts.test.ts`

- [ ] **Step 1: Extend tests for input and secret handling**

Assert that `configure.sh` uses silent reads for secrets, validates the access token length, writes through a temporary file, sets mode 0600, and backs up an existing environment file. Add Bash tests that pass `NONINTERACTIVE=1` with missing required variables and expect a nonzero exit before file creation.

- [ ] **Step 2: Verify RED**

```powershell
npx vitest run release/release-scripts.test.ts
```

Expected: new configuration assertions fail.

- [ ] **Step 3: Implement `release/lib.sh`**

Define focused helpers with these contracts:

```bash
die() { printf 'error: %s\n' "$*" >&2; exit 1; }
require_root() { [[ "$(id -u)" == "0" ]] || die "run this command with sudo"; }
require_command() { command -v "$1" >/dev/null 2>&1 || die "required command is unavailable: $1"; }
require_amd64() { [[ "$(uname -m)" =~ ^(x86_64|amd64)$ ]] || die "this release supports linux/amd64 only"; }
compose_cmd() { docker compose --env-file "$ENV_FILE" -f "$INSTALL_ROOT/compose.release.yaml" "$@"; }
```

Resolve `INSTALL_ROOT`, `ENV_FILE`, `DATA_DIR` and `BACKUP_DIR` with `realpath -m`; reject `/`, `$HOME`, the install root, nested backup/data directories and paths without the expected sentinel for destructive operations. Reuse the existing project sentinel value `science-video-workbench-data-v1`.

- [ ] **Step 4: Implement the environment template and configurator**

Use fixed defaults:

```dotenv
APP_IMAGE=ghcr.io/cjllz/science-video-workbench
APP_VERSION=0.1.0
LAN_HOST=science-video.lan
LAN_BIND_ADDRESS=192.168.10.20
HTTP_PORT=80
HTTPS_PORT=443
DATA_DIR=/srv/science-video-workbench/data
BACKUP_DIR=/srv/science-video-workbench/backups
BACKUP_MIRROR_DIR=
BACKUP_RETENTION_DAYS=14
LAN_ACCESS_TOKEN=
TRUST_PROXY=1
MAX_CONCURRENT_RENDERS=1
```

Include all server API and public URL variables from `deploy/.env.production.example`. For interactive use, prompt for every required value and use `read -r -s` for the access token/API keys. For `NONINTERACTIVE=1`, require the variables from the process environment. Write to `deploy/.env.production.tmp`, validate, chmod 0600, back up an existing file with a UTC timestamp, then atomically rename.

- [ ] **Step 5: Verify GREEN and commit**

```powershell
npx vitest run release/release-scripts.test.ts
git add release/lib.sh release/configure.sh release/.env.production.example release/release-scripts.test.ts
git commit -m "feat: add release configuration safeguards"
```

## Task 4: Implement Install, Update and Uninstall Commands

**Files:**
- Create: `release/install.sh`
- Create: `release/update.sh`
- Create: `release/uninstall.sh`
- Test: `release/release-scripts.test.ts`

- [ ] **Step 1: Add executable behavior tests**

With fake `docker`, `uname`, `id` and filesystem paths prepended to `PATH`, test:

- non-root install exits before mutation;
- non-amd64 install exits before Docker;
- missing Compose v2 exits with an actionable message;
- install refuses missing/unsafe production configuration;
- update calls maintenance idle check before pull/recreate;
- uninstall without flags never removes data/config/Caddy volumes;
- destructive uninstall requires both `--destroy-data` and `--confirm-destroy-data` plus a valid sentinel.

- [ ] **Step 2: Verify RED**

```powershell
npx vitest run release/release-scripts.test.ts
```

Expected: executable behavior tests fail because commands are absent.

- [ ] **Step 3: Implement idempotent installation**

`install.sh` must:

```bash
require_root
require_amd64
for command in docker curl tar sha256sum realpath; do require_command "$command"; done
docker compose version >/dev/null 2>&1 || die "Docker Compose v2 is required"
[[ -f "$ENV_FILE" ]] || die "run ./configure.sh first"
```

Then create/chown data directories, write the sentinel only into a dedicated empty/new data directory, copy allowlisted release files into `/srv/science-video-workbench/app`, preserve existing `.env.production`, run `compose_cmd pull`, `compose_cmd config --quiet`, `compose_cmd up -d`, and poll `/api/ready` through `docker compose exec`. Print the access URL and certificate export command only after readiness succeeds.

- [ ] **Step 4: Implement guarded update**

`update.sh` reads the new bundle's `VERSION`, requires a successful `check-idle`, requires a newly produced backup archive from `deploy/backup.sh`, records the current image ID, installs new allowlisted files without replacing `.env.production`, updates `APP_VERSION`, pulls and recreates. On readiness failure, print exact commands for restoring the previous environment backup/image; do not delete the new data directory or automatically restore a database.

- [ ] **Step 5: Implement non-destructive uninstall**

Default behavior is:

```bash
compose_cmd down
printf 'containers removed; data, backups, configuration and Caddy CA were preserved\n'
```

Do not pass `--volumes`. Only the exact pair `--destroy-data --confirm-destroy-data` enables destructive mode. Before removal, resolve and validate data/backup paths, verify the sentinel and print the exact targets. Keep program-file removal separate from persistent-directory removal.

- [ ] **Step 6: Verify GREEN and commit**

```powershell
npx vitest run release/release-scripts.test.ts
git add release/install.sh release/update.sh release/uninstall.sh release/release-scripts.test.ts
git commit -m "feat: add server lifecycle commands"
```

## Task 5: Build an Allowlist-Based Release Packager

**Files:**
- Create: `scripts/build-release.mjs`
- Create: `scripts/build-release.test.ts`
- Create: `release/README.txt`
- Modify: `package.json`

- [ ] **Step 1: Write the failing packager test**

The test creates a temporary output directory, runs:

```powershell
node scripts/build-release.mjs --output-dir <temp>
```

Then assert the archive name is `science-video-workbench-v0.1.0-online-linux-amd64.tar.gz`, its adjacent `.sha256` and `SHA256SUMS` exist, and its entries are exactly under one versioned root with the files listed in the design. Assert no entry matches `src/`, `.git`, `.env.production`, `node_modules`, `dist`, `data`, media extensions, databases, logs or certificates.

- [ ] **Step 2: Verify RED**

```powershell
npx vitest run scripts/build-release.test.ts
```

Expected: FAIL because the packager does not exist.

- [ ] **Step 3: Implement the Node packager**

Use only `node:fs`, `node:path`, `node:crypto`, `node:child_process`, `node:os` and `node:process`. Read `package.json` for the version, accept only `--output-dir`, create a temporary staging root, copy this explicit map, and chmod shell files 0755:

```js
const files = new Map([
  ["release/README.txt", "README.txt"],
  ["release/compose.release.yaml", "compose.release.yaml"],
  ["release/Caddyfile", "Caddyfile"],
  ["release/.env.production.example", "deploy/.env.production.example"],
  ["release/lib.sh", "lib.sh"],
  ["release/configure.sh", "configure.sh"],
  ["release/install.sh", "install.sh"],
  ["release/update.sh", "update.sh"],
  ["release/uninstall.sh", "uninstall.sh"],
  ["deploy/backup.sh", "deploy/backup.sh"],
  ["deploy/restore.sh", "deploy/restore.sh"],
  ["deploy/lib.sh", "deploy/lib.sh"]
]);
```

Generate `VERSION` containing `0.1.0`, invoke `tar -czf`, hash the final bytes with SHA-256, write both checksum files, and always remove staging in `finally`. Refuse a dirty/nonempty target asset path rather than overwriting silently.

- [ ] **Step 4: Add the npm command and bundled README**

Add:

```json
"release:package": "node scripts/build-release.mjs"
```

`README.txt` states supported OS/architecture, Docker/Compose prerequisites, SHA verification, `sudo ./configure.sh`, `sudo ./install.sh`, access URL, and the canonical GitHub deployment-manual URL. It contains no sample real secrets.

- [ ] **Step 5: Verify and commit**

```powershell
npx vitest run scripts/build-release.test.ts release/release-scripts.test.ts
npm run release:package -- --output-dir .artifacts/releases
git status --short
```

Expected: tests pass; ignored `.artifacts/releases` contains the archive/checksums; Git status contains only intended source changes.

```powershell
git add scripts/build-release.mjs scripts/build-release.test.ts release/README.txt package.json package-lock.json
git commit -m "feat: package versioned server releases"
```

## Task 6: Add the GitHub Release Workflow

**Files:**
- Create: `.github/workflows/release.yml`
- Create: `CHANGELOG.md`
- Test: `release/release-scripts.test.ts`

- [ ] **Step 1: Add workflow contract tests**

Assert the workflow:

- triggers only on `v*.*.*` tags and manual dispatch without publishing by default;
- declares `contents: write` and `packages: write`;
- compares `GITHUB_REF_NAME` to `v${package.json.version}`;
- runs `npm ci`, `npm run verify`, `npm audit --omit=dev` and `npm run release:package`;
- uses Buildx for `linux/amd64`;
- pushes `ghcr.io/cjllz/science-video-workbench` version and `latest` tags;
- uploads the tarball, `.sha256`, `SHA256SUMS` and `CHANGELOG.md` to a GitHub Release.

- [ ] **Step 2: Verify RED**

```powershell
npx vitest run release/release-scripts.test.ts
```

- [ ] **Step 3: Implement `.github/workflows/release.yml`**

Use pinned major actions from GitHub-maintained/Docker publishers:

```yaml
name: Release
on:
  push:
    tags: ["v*.*.*"]
permissions:
  contents: write
  packages: write
jobs:
  release:
    runs-on: ubuntu-latest
```

After verification, use `docker/login-action`, `docker/setup-buildx-action`, and `docker/build-push-action` to push fixed tags. Run the packager and use `gh release create "$GITHUB_REF_NAME" ... --verify-tag --title ... --notes-file CHANGELOG.md` with `GH_TOKEN: ${{ github.token }}`.

- [ ] **Step 4: Create `CHANGELOG.md`**

Add `## 0.1.0 - 2026-08-19` with the current LAN workbench, script/material fusion, session API settings, independent panel scrolling, deployment hardening, three-manual documentation set and new public release packaging. Do not copy commit hashes or claim unverified Linux acceptance.

- [ ] **Step 5: Verify and commit**

```powershell
npx vitest run release/release-scripts.test.ts
git diff --check
git add .github/workflows/release.yml CHANGELOG.md release/release-scripts.test.ts
git commit -m "ci: publish versioned server releases"
```

## Task 7: Make Release Installation the Primary Documentation Path

**Files:**
- Modify: `README.md`
- Modify: `docs/DEPLOYMENT.md`
- Modify: `docs/DEVELOPMENT.md`
- Modify: `scripts/check-docs.mjs`

- [ ] **Step 1: Extend the documentation contract**

Require `CHANGELOG.md` as an official file, scan it for placeholders, and verify links. Add current links to the public repository, Releases page and package registry without adding links to uncreated individual Release asset names.

- [ ] **Step 2: Update README**

Add a “稳定版安装” section before source quick start:

```text
正式服务器优先从 GitHub Releases 下载带版本号的 Linux amd64 在线安装包。
Docker 镜像是可运行程序；Source code 归档仅供开发，不是安装包。
```

Link the Releases page and deployment manual, then retain source local development as a separate section.

- [ ] **Step 3: Update deployment manual**

Add a release-install path that covers SHA-256 verification, extraction, configuration, installation, readiness, CA export, upgrade and default-preserving uninstall. Keep current source/Compose build instructions under an explicit “源码构建与故障回退” heading. Ensure backup/restore commands account for the installed `/srv/science-video-workbench/app` paths.

- [ ] **Step 4: Update development documentation**

Document the version/tag invariant, release file allowlist, `npm run release:package`, GHCR tags, workflow permissions, generated `.artifacts/` policy, Linux acceptance boundary and two-remote rule.

- [ ] **Step 5: Verify and commit**

```powershell
npm run docs:check
rg -n "Source code|GitHub Releases|ghcr.io/cjllz|release:package" README.md docs CHANGELOG.md
git diff --check
git add README.md CHANGELOG.md docs scripts/check-docs.mjs
git commit -m "docs: document downloadable server releases"
```

## Task 8: Verify the Repository and Release Artifact

**Files:**
- Verify all modified files.

- [ ] **Step 1: Run focused release checks**

```powershell
npx vitest run release/release-scripts.test.ts scripts/build-release.test.ts
npm run release:package -- --output-dir .artifacts/releases
tar -tzf .artifacts/releases/science-video-workbench-v0.1.0-online-linux-amd64.tar.gz
```

Expected: tests pass and archive entries match the design allowlist.

- [ ] **Step 2: Run full project verification**

```powershell
npm run verify
npm audit --omit=dev
git diff --check
```

Expected: documentation, all tests, production build and dependency audit pass.

- [ ] **Step 3: Check secrets and tracked generated files**

Run focused scans for private keys, real environment files and high-risk credential patterns in tracked files. Then:

```powershell
git ls-files -ci --exclude-standard
git status --short
```

Expected: no tracked ignored files; `.artifacts/` remains ignored; no generated release archive is staged.

- [ ] **Step 4: Inspect commits and merge locally**

Review `git diff main...HEAD`, ensure only release automation/tests/docs are present, then fast-forward merge after the branch passes verification.

## Task 9: Create and Publish the Public GitHub Repository

**External state:** GitHub account `cjllz`; local repository remotes.

- [ ] **Step 1: Verify GitHub authentication and repository absence**

Use `gh auth status` when available. Otherwise use the user-authenticated browser session. Confirm `https://github.com/cjllz/science-video-workbench` does not already contain another project before creating anything.

- [ ] **Step 2: Create the public repository**

Create `cjllz/science-video-workbench` as public with no generated README, license or `.gitignore`, because local history is authoritative. Add:

```powershell
git remote add origin https://github.com/cjllz/science-video-workbench.git
```

If `origin` exists, compare it to the target and update only when it is clearly stale; do not overwrite an unrelated remote silently.

- [ ] **Step 3: Push main without force**

```powershell
git push -u origin main
```

Expected: remote `main` equals local `main`; repository Actions can read the workflow. Do not create `v0.1.0` until branch checks and repository package visibility are ready.

- [ ] **Step 4: Configure package visibility expectation**

The workflow publishes GHCR under the public repository. After the first release, confirm the package is public and `docker pull ghcr.io/cjllz/science-video-workbench:0.1.0` works without authentication.

## Task 10: Configure Gitee Non-Destructive Synchronization

**External state:** Gitee enterprise repository `novlead/smart-video`; local Git remotes.

- [ ] **Step 1: Read the authenticated repository clone URL and remote heads**

Open the supplied enterprise repository page, copy its displayed HTTPS or SSH clone URL, then run `git ls-remote <clone-url>`. Record existing branches and tags before adding the remote.

- [ ] **Step 2: Add the `gitee` remote**

```powershell
git remote add gitee <authenticated-clone-url>
git fetch gitee --prune --tags
```

If `gitee/main` has unrelated history, stop synchronization and report the divergence; do not force push or merge unrelated histories automatically.

- [ ] **Step 3: Push only when fast-forward/non-conflicting**

When the remote is empty or its `main` is an ancestor of local `main`:

```powershell
git push -u gitee main
```

Version tags are pushed only after the GitHub release tag succeeds. Keep GitHub as the only Release source.

## Task 11: Publish `v0.1.0` and Verify the Release

**External state:** GitHub tag, Actions run, GHCR package and GitHub Release.

- [ ] **Step 1: Create and push the signed-off version tag**

After all local checks and remote `main` succeed:

```powershell
git tag -a v0.1.0 -m "science-video-workbench v0.1.0"
git push origin v0.1.0
```

- [ ] **Step 2: Monitor the GitHub Actions release job**

Wait for the tag workflow to complete. On failure, inspect logs, fix on `main`, bump the package/tag version rather than moving a published tag, and rerun with the new immutable tag.

- [ ] **Step 3: Verify public artifacts**

Confirm the Release contains the online tarball, adjacent checksum, `SHA256SUMS` and changelog. Download the archive to a temporary directory, recompute SHA-256, list contents and confirm no secrets/source/generated runtime data.

- [ ] **Step 4: Verify anonymous image pull**

On a Docker-capable environment:

```bash
docker pull ghcr.io/cjllz/science-video-workbench:0.1.0
docker image inspect ghcr.io/cjllz/science-video-workbench:0.1.0
```

Expected: pull succeeds without GitHub authentication and image platform is linux/amd64.

- [ ] **Step 5: Mirror the tag to Gitee when safe**

```powershell
git push gitee v0.1.0
```

Skip with an explicit divergence report if Task 10 found unrelated history or authentication is unavailable.

## Self-Review Record

- Spec coverage: program image, online bundle, lifecycle commands, release workflow, versioning, checksums, GitHub public repository, Gitee non-destructive mirror, documentation and clean-repository rules all have explicit tasks.
- TDD: shell behavior and packager tasks start with observable failing tests; external repository steps follow local verification and do not force remote state.
- Scope: no Windows client, ARM64 promise, offline image archive, public internet exposure, business logic or database change is included.
- Naming: repository, package, image, version, bundle and install paths match the approved design.
- Placeholder scan: angle-bracket command operands describe runtime values obtained in the immediately preceding step; no unfinished implementation content remains.
