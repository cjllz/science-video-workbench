# Three-Manual Documentation Set Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the mixed project manual with one concise README and three complete, audience-specific manuals for users, developers, and deployment operators.

**Architecture:** Preserve verified content by parsing the existing manual at second-level chapter boundaries, then assemble each formal manual from owned chapters plus audience-specific introductions, navigation, cross-references, and missing technical explanations. Update the standard-library documentation checker so the new four-entry structure is mandatory and the old manual is forbidden.

**Tech Stack:** Markdown, Node.js 22 standard library, npm documentation checks, Git.

---

## File Map

| Path | Responsibility |
| --- | --- |
| `README.md` | Concise project description, support boundary, quick start, and manual index. |
| `docs/USER-GUIDE.md` | Complete end-user workflow and user-facing troubleshooting. |
| `docs/DEVELOPMENT.md` | Architecture, code, data, configuration, API, test, build, and clean-commit guidance. |
| `docs/DEPLOYMENT.md` | Linux/Docker/HTTPS deployment, operations, backup, recovery, upgrade, and server troubleshooting. |
| `docs/PROJECT-MANUAL.md` | Delete after all owned content moves to the new manuals. |
| `docs/internal/README.md` | Point historical readers to the three current manuals. |
| `scripts/check-docs.mjs` | Require the new formal documents, reject the old path, and validate every formal document. |

## Task 1: Make the Documentation Contract Fail for the Old Structure

**Files:**
- Modify: `scripts/check-docs.mjs`

- [ ] **Step 1: Change required and forbidden paths**

Replace the current path lists with:

```js
const officialFiles = [
  "README.md",
  "docs/USER-GUIDE.md",
  "docs/DEVELOPMENT.md",
  "docs/DEPLOYMENT.md"
];
const requiredFiles = [...officialFiles, "docs/internal/README.md"];
const forbiddenPaths = [
  "docs/PROJECT-MANUAL.md",
  "docs/deployment/linux-docker.md",
  "docs/superpowers"
];
```

Replace the hard-coded placeholder loop with:

```js
for (const official of officialFiles) {
```

- [ ] **Step 2: Run the checker and verify the new contract fails**

Run:

```powershell
npm run docs:check
```

Expected: exit 1, reporting the three missing manuals and forbidden `docs/PROJECT-MANUAL.md`. Existing internal history remains excluded from heading-jump enforcement.

- [ ] **Step 3: Commit the failing contract**

```powershell
git add scripts/check-docs.mjs
git commit -m "test: require audience-specific project manuals"
```

## Task 2: Build the Detailed User Guide

**Files:**
- Create: `docs/USER-GUIDE.md`
- Source: `docs/PROJECT-MANUAL.md` chapters 5, 6, 16, and 21

- [ ] **Step 1: Create independent user-guide navigation**

Start the document with this structure and fill every listed chapter with the existing verified user content:

```markdown
# 科普视频工作台详细使用说明

本文档面向使用浏览器创建、生成和返修视频的普通用户。服务器安装请阅读部署运维手册，代码实现请阅读开发技术文档；正式成稿时分别链接 `DEPLOYMENT.md` 和 `DEVELOPMENT.md`。

## 目录

1. 开始前准备
2. 登录、退出与页面布局
3. 定义视频
4. 导入现有剧本
5. 上传和管理素材
6. 生成、检查和编辑分镜
7. 素材与剧本融合
8. 个人 API 设置
9. 确认生成、查看进度与下载
10. 返修和历史版本
11. 反馈、内容审核和安全
12. 常见问题与故障处理
```

Each operation chapter must retain or add: entry point, exact steps, success signal, failure handling, and safety note.

- [ ] **Step 2: Preserve the complete creation and editing workflow**

Migrate and reorganize all behavior from old chapters 5 and 6, including:

- local authentication and logout;
- topic, keywords, style, duration, aspect ratio, mixed/all-AI generation;
- TXT/Markdown/DOCX import and CSV/XLSX upload;
- shot title, narration, visual prompt, order, duration, and total-duration constraint;
- progress, output, subtitle, feedback, retouch, revision restore;
- script/video provider selection, session-only secret storage, setting snapshots, URL policy, and user-visible error codes.

- [ ] **Step 3: Add a complete material/script fusion explanation**

Document the exact current flow:

```text
上传素材 -> 选择镜头 -> 选择 @素材变量 -> 添加绑定 -> 选择用途 -> 设置位置/时间 -> 确认并生成
```

Explain these mappings without implementation jargon:

| Material | User option | Result |
| --- | --- | --- |
| Image/video | 融入画面 | Provider uses it as an AI reference; public HTTPS URL required. |
| Image/video | 原样展示 | Local ffmpeg overlays original pixels after base-shot generation. |
| Audio | 作为声音 | Bound as an audio reference for a provider-capable shot. |
| CSV/XLSX | 展示数据 | Local line/bar/table graphic is rendered and overlaid. |

State that adding material changes visual design/binding, not narration, and that one material can be used in multiple shots with independent placement and time ranges.

- [ ] **Step 4: Complete user troubleshooting and FAQ**

Move user-owned symptoms from old chapters 16 and 21: login failure, saved key field appearing blank, personal settings disappearing after restart, provider authentication/quota errors, unresolved material variables, inaccessible AI references, running-task setting snapshots, output download, and content review responsibility.

- [ ] **Step 5: Validate the user guide in isolation**

Run:

```powershell
node scripts/check-docs.mjs
```

Expected: the checker still fails only for the missing development/deployment manuals and old forbidden manual; it must not report heading, fence, link, or placeholder errors in `USER-GUIDE.md`.

## Task 3: Build the Development Technical Document

**Files:**
- Create: `docs/DEVELOPMENT.md`
- Source: `docs/PROJECT-MANUAL.md` chapters 2-4, 18, and development-owned parts of 19
- Reference: `src/client/`, `src/server/`, `src/shared/`, `package.json`, `.env.example`

- [ ] **Step 1: Create the technical reading path**

Use these top-level chapters:

```markdown
# 科普视频工作台开发技术文档

## 目录
## 1. 技术栈、运行模式与边界
## 2. 系统架构与数据流
## 3. 仓库结构与模块职责
## 4. 本地开发环境
## 5. 配置解析与新增配置契约
## 6. 数据模型、SQLite 与文件存储
## 7. 认证、会话和个人 API 设置
## 8. 剧本、任务队列与生成流程
## 9. 素材融合与视频合成
## 10. HTTP 接口与状态码
## 11. 测试、视觉 QA 与构建
## 12. 发布验证、文档同步与提交规范
```

- [ ] **Step 2: Preserve architecture and local development content**

Move the production data-flow diagram, trust boundaries, repository tree, SQLite single-process rule, local quick start, build/start commands, module table, test layout, and release validation from old chapters 2-4 and 18. Clearly distinguish loopback development from supported LAN deployment.

- [ ] **Step 3: Document configuration and data contracts**

Explain:

- `src/server/runtime-config.ts` parsing and security validation;
- `.env.example`, `deploy/.env.production.example`, and `compose.yaml` synchronization;
- database, WAL, `data/`, `output/`, uploads, revisions, and maintenance validation;
- the exact checklist for adding/changing an environment variable;
- link to `DEPLOYMENT.md` for production values rather than duplicating its full variable table.

- [ ] **Step 4: Document application workflows and material implementation**

Trace the flow from HTTP request to persistent job, planning, plan confirmation, preflight, provider generation/local fallback, narration, ffmpeg composition, inspection, and revision recording.

For material fusion, identify the current modules and responsibilities:

- `ScriptWorkspace.tsx` adds `@variable` and `ShotMaterialBinding`;
- `material-bindings.ts` maps UI purposes to `ai_reference`, `exact_overlay`, or `data_chart`;
- `material-variables.ts` resolves provider/local references;
- `preflight.ts` rejects missing bindings, fields, durations, and provider URLs;
- `providers/video.ts` submits AI references and first/last-frame roles;
- `renderer.ts` generates charts and exact ffmpeg overlays.

- [ ] **Step 5: Preserve API and code-quality reference**

Move the full primary HTTP endpoint table and common status-code table from old chapter 19. Add the existing test/build commands, `npm run qa:visual`, `npm run verify`, production audit, `git diff --check`, ignored-output policy, and rule that configuration/deployment behavior changes must update the applicable formal manual.

- [ ] **Step 6: Validate the development document**

Run `npm run docs:check` and confirm there are no errors attributed to `docs/DEVELOPMENT.md`.

## Task 4: Convert the Existing Manual into the Deployment Manual

**Files:**
- Create through rename: `docs/DEPLOYMENT.md`
- Delete through rename: `docs/PROJECT-MANUAL.md`
- Source: old chapters 7-17, deployment-owned parts of 2, 3, 19-21

- [ ] **Step 1: Rename before editing**

```powershell
git mv docs/PROJECT-MANUAL.md docs/DEPLOYMENT.md
```

This preserves Git history and ensures no duplicate old manual remains.

- [ ] **Step 2: Rebuild deployment-only navigation**

Retitle the file `# 科普视频工作台部署运维手册` and use these top-level chapters:

```markdown
## 目录
## 1. 支持拓扑、限制与部署前决策
## 2. Linux 主机、网络与目录准备
## 3. 生产环境变量
## 4. Docker Compose 首次部署
## 5. Caddy 内部 HTTPS 与客户端信任
## 6. 首次上线验收
## 7. 登录与日常运维
## 8. 数据、备份与恢复
## 9. 升级与回滚
## 10. 服务器故障排查
## 11. 安全边界、停止与卸载
## 12. 配置、端口、路径和脚本速查
## 13. 运维与变更记录模板
## 14. 部署常见问题
```

- [ ] **Step 3: Remove user/developer-owned chapters without losing deployment prerequisites**

Remove old detailed chapters 4-6 and 18, plus the HTTP API table. Replace any needed cross-context with links to `USER-GUIDE.md` or `DEVELOPMENT.md`. Retain architecture facts required to deploy safely: single host, one app container, Caddy, SQLite single writer, bind mounts, public material/output URL constraints, and backup consistency.

- [ ] **Step 4: Preserve every deployment contract**

Confirm the deployment manual still contains all 31 application/Compose variables documented by `.env.example` and `deploy/.env.production.example`, plus:

- host architecture/resource/time/disk checks;
- fixed IP/DNS, UFW/firewalld and unexposed port 8787;
- directory ownership, sentinel, UID/GID and bind mounts;
- Compose config/build/start/health commands;
- Caddy CA export and Windows/macOS/Linux/mobile trust;
- container security, actual video, persistence, restart and backup/restore acceptance;
- backup hashes/manifests, second copy, systemd timer and recovery drill;
- upgrade records, rollback, readiness troubleshooting and safe uninstall;
- release, backup, restore, certificate and incident record templates.

- [ ] **Step 5: Repair cross-references and numbering**

Update every “第 N 章” reference and local anchor to the new chapter names. Formal deployment content may link to the user guide for UI acceptance and to development for API/module details. Run `npm run docs:check` until `DEPLOYMENT.md` has no link or anchor failures.

## Task 5: Rebuild the README and Historical Index

**Files:**
- Modify: `README.md`
- Modify: `docs/internal/README.md`

- [ ] **Step 1: Keep README concise and route by audience**

Retain the current project summary, core capabilities, support boundary, quick local start, validation commands, and content-review reminder. Replace all old manual links with:

```text
文档入口

- 详细使用说明 -> docs/USER-GUIDE.md：登录、创建视频、剧本和素材融合、个人 API、生成、返修与常见问题。
- 开发技术文档 -> docs/DEVELOPMENT.md：架构、代码模块、配置、数据、接口、测试、构建和提交规范。
- 部署运维手册 -> docs/DEPLOYMENT.md：Linux、Docker Compose、HTTPS、生产配置、备份恢复、升级回滚和故障处理。
- 内部历史资料 -> docs/internal/README.md：历史设计规格和实施计划，不是当前操作依据。
```

The formal deployment section must link directly to `docs/DEPLOYMENT.md`.

- [ ] **Step 2: Update the internal-history authority notice**

State that current behavior is authoritative only in README plus the three formal manuals. Keep the definitions of `specs/` and `plans/`, and do not modify archived bodies.

- [ ] **Step 3: Scan all current files for old links**

Run:

```powershell
rg -n "docs/PROJECT-MANUAL\.md|PROJECT-MANUAL\.md|完整项目手册|第 18 章|第 19 章" README.md docs scripts package.json
```

Expected: no current README, formal manual, internal index, or checker references the deleted manual. Matches inside archived specs/plans are historical and remain unchanged.

## Task 6: Verify Completeness, Correctness, and Repository Cleanliness

**Files:**
- Verify all changed formal documents and checker.

- [ ] **Step 1: Check environment-variable coverage**

Extract variable names from `.env.example` and `deploy/.env.production.example`, then verify each appears in `docs/DEPLOYMENT.md`. Expected: no undocumented variable names and no real secrets.

- [ ] **Step 2: Check formal-document structure and links**

```powershell
npm run docs:check
git diff --check
```

Expected: documentation check passes for README, three manuals, and internal history; whitespace check is silent.

- [ ] **Step 3: Run full project verification**

```powershell
npm run verify
npm audit --omit=dev
```

Expected: documentation check, tests, production build, and production dependency audit pass.

- [ ] **Step 4: Inspect the final documentation diff**

Confirm the diff contains only Markdown and `scripts/check-docs.mjs`; no `dist/`, `data/`, logs, database, media, screenshot, secret, or temporary migration script is tracked.

- [ ] **Step 5: Commit by responsibility**

Use scoped commits:

```powershell
git add scripts/check-docs.mjs
git commit -m "test: require audience-specific project manuals"

git add README.md docs/USER-GUIDE.md docs/DEVELOPMENT.md docs/DEPLOYMENT.md docs/PROJECT-MANUAL.md docs/internal/README.md
git commit -m "docs: publish user development and deployment manuals"
```

If `git mv` already stages the old path removal as part of the new deployment document, stage with `git add -A README.md docs` so rename detection remains intact.

- [ ] **Step 6: Confirm final state**

```powershell
git status --short --branch
git ls-files -ci --exclude-standard
git log --oneline -6
```

Expected: clean branch; no tracked ignored files; scoped documentation commits at the tip.

## Self-Review Record

- Spec coverage: README, user guide, development document, deployment manual, old-manual deletion, history index, checker contract, content ownership, environment coverage, and clean-repository verification all map to explicit tasks.
- Content preservation: every old chapter 1-21 has an explicit destination; deployment commands and variables receive an additional completeness audit.
- Placeholder scan: no unfinished markers or unspecified editing steps remain.
- Naming consistency: `USER-GUIDE.md`, `DEVELOPMENT.md`, `DEPLOYMENT.md`, and forbidden `PROJECT-MANUAL.md` are consistent across tasks, checker behavior, and links.
- Scope: no business logic, UI, API behavior, environment meaning, deployment topology, generated file, or historical archive body changes are included.
