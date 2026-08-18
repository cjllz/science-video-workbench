# 统一项目手册实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将分散的项目说明整理为中文 `README.md`、唯一正式主手册 `docs/PROJECT-MANUAL.md` 和隔离的 `docs/internal` 历史资料，并建立可重复执行的文档结构与链接检查。

**Architecture:** `README.md` 只承担项目入口职责，`docs/PROJECT-MANUAL.md` 是使用、部署、运维和开发说明的唯一权威正文，历史规格和计划统一放在 `docs/internal`。一个不依赖第三方包的 Node.js 检查脚本负责验证目标结构、Markdown 标题层级、代码围栏和本地链接，防止文档再次散乱。

**Tech Stack:** Markdown、Node.js 22、PowerShell、Git、现有 Vitest/TypeScript/Vite 构建链。

---

## 文件映射

### 新建

- `docs/PROJECT-MANUAL.md`：唯一正式完整项目手册。
- `docs/internal/README.md`：内部资料用途和阅读边界。
- `docs/internal/plans/2026-08-18-documentation-reorganization.md`：本实施计划。
- `scripts/check-docs.mjs`：文档结构、标题、代码围栏和本地链接检查器。

### 修改

- `README.md`：改写为简洁中文项目首页。
- `package.json`：增加 `docs:check` 和 `verify` 命令。
- `docs/internal/specs/2026-08-18-documentation-reorganization-design.md`：只在目录迁移后确有路径变化时修正相对路径；不改变已确认设计。

### 移动

- `docs/superpowers/specs/*.md` → `docs/internal/specs/*.md`。
- `docs/superpowers/plans/*.md` → `docs/internal/plans/*.md`。

### 删除

- `docs/deployment/linux-docker.md`：内容迁移并核对后删除，避免第二份正式部署正文。
- 空目录 `docs/deployment` 和 `docs/superpowers`：文件迁移后不再保留。

## 事实来源

写作时不得依靠记忆猜测，按下列来源核对：

- 启动、构建、测试、维护命令：`package.json`。
- 本地监听、认证和生产校验：`src/server/runtime-config.ts`、`src/server/server-config.test.ts`。
- HTTP 接口：`src/server/index.ts`、`src/server/auth-http.ts`、`src/server/provider-settings-http.ts`。
- 用户界面和业务流程：`src/client/App.tsx`、`src/client/ScriptWorkspace.tsx`、`src/client/RetouchWorkspace.tsx`、`src/client/ProviderSettingsDialog.tsx`。
- 个人 API 生命周期和限制：`src/server/provider-settings.ts`、`src/server/provider-url-policy.ts` 及对应测试。
- 生产配置：`compose.yaml`、`Dockerfile`、`deploy/.env.production.example`、`deploy/Caddyfile`。
- 备份恢复：`deploy/backup.sh`、`deploy/restore.sh`、`deploy/lib.sh`、`deploy/deployment-scripts.test.ts`。
- 现有部署正文：`docs/deployment/linux-docker.md`；只迁移仍与实现一致的内容。

---

### Task 1: 建立文档自动检查基线

**Files:**
- Create: `scripts/check-docs.mjs`
- Modify: `package.json`

- [ ] **Step 1: 新建检查器，并让它描述最终文档结构**

`scripts/check-docs.mjs` 使用 Node.js 标准库实现，不增加依赖。完整检查逻辑如下：

```js
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import process from "node:process";

const root = process.cwd();
const failures = [];
const requiredFiles = [
  "README.md",
  "docs/PROJECT-MANUAL.md",
  "docs/internal/README.md"
];
const forbiddenPaths = [
  "docs/deployment/linux-docker.md",
  "docs/superpowers"
];

function fail(message) {
  failures.push(message);
}

function markdownFiles(directory) {
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (["node_modules", ".git", ".worktrees"].includes(entry.name)) return [];
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) return markdownFiles(absolute);
    return entry.isFile() && entry.name.endsWith(".md") ? [absolute] : [];
  });
}

function slugHeadings(markdown, relativeFile) {
  const slugs = new Set();
  const counts = new Map();
  let previousLevel = 0;
  let fence = false;

  for (const [index, line] of markdown.split(/\r?\n/).entries()) {
    if (/^\s*```/.test(line)) {
      fence = !fence;
      continue;
    }
    if (fence) continue;
    const match = /^(#{1,6})\s+(.+?)\s*#?\s*$/.exec(line);
    if (!match) continue;
    const level = match[1].length;
    if (previousLevel > 0 && level > previousLevel + 1) {
      fail(`${relativeFile}:${index + 1} 标题层级从 H${previousLevel} 跳到 H${level}`);
    }
    previousLevel = level;
    const base = match[2]
      .trim()
      .toLowerCase()
      .replace(/<[^>]+>/g, "")
      .replace(/[^\p{L}\p{N}\s-]/gu, "")
      .replace(/\s+/g, "-")
      .replace(/-+/g, "-");
    const count = counts.get(base) ?? 0;
    counts.set(base, count + 1);
    slugs.add(count === 0 ? base : `${base}-${count}`);
  }

  if (fence) fail(`${relativeFile} 存在未闭合的代码围栏`);
  return slugs;
}

function verifyLinks(absoluteFile, markdown, headingsByFile) {
  const relativeFile = path.relative(root, absoluteFile).replaceAll("\\", "/");
  const linkPattern = /!?\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
  for (const match of markdown.matchAll(linkPattern)) {
    const rawTarget = match[1].replace(/^<|>$/g, "");
    if (/^(?:https?:|mailto:|data:)/i.test(rawTarget)) continue;
    const [rawPath, fragment] = rawTarget.split("#", 2);
    const decodedPath = decodeURIComponent(rawPath || "");
    const targetFile = decodedPath
      ? path.resolve(path.dirname(absoluteFile), decodedPath)
      : absoluteFile;
    if (!existsSync(targetFile)) {
      fail(`${relativeFile} 包含不存在的本地链接: ${rawTarget}`);
      continue;
    }
    if (fragment && targetFile.endsWith(".md")) {
      const normalized = path.normalize(targetFile);
      const targetHeadings = headingsByFile.get(normalized);
      if (!targetHeadings?.has(decodeURIComponent(fragment).toLowerCase())) {
        fail(`${relativeFile} 包含不存在的标题锚点: ${rawTarget}`);
      }
    }
  }
}

for (const required of requiredFiles) {
  if (!existsSync(path.join(root, required))) fail(`缺少正式文档: ${required}`);
}
for (const forbidden of forbiddenPaths) {
  if (existsSync(path.join(root, forbidden))) fail(`仍存在已废弃文档路径: ${forbidden}`);
}

const files = [path.join(root, "README.md"), ...markdownFiles(path.join(root, "docs"))]
  .filter((file, index, all) => all.indexOf(file) === index && existsSync(file));
const headingsByFile = new Map();
const contents = new Map();
for (const file of files) {
  const markdown = readFileSync(file, "utf8");
  const relativeFile = path.relative(root, file).replaceAll("\\", "/");
  contents.set(file, markdown);
  headingsByFile.set(path.normalize(file), slugHeadings(markdown, relativeFile));
}
for (const [file, markdown] of contents) verifyLinks(file, markdown, headingsByFile);

for (const official of ["README.md", "docs/PROJECT-MANUAL.md"]) {
  const absolute = path.join(root, official);
  if (!existsSync(absolute)) continue;
  const markdown = readFileSync(absolute, "utf8");
  if (/\b(?:TBD|TODO|FIXME)\b|replace[-_]me/i.test(markdown)) {
    fail(`${official} 包含未完成占位内容`);
  }
}

if (failures.length > 0) {
  console.error(failures.map((item) => `- ${item}`).join("\n"));
  process.exit(1);
}
console.log(`文档检查通过，共检查 ${files.length} 个 Markdown 文件。`);
```

- [ ] **Step 2: 在 `package.json` 中增加稳定命令**

在 `scripts` 中加入：

```json
"docs:check": "node scripts/check-docs.mjs",
"verify": "npm run docs:check && npm test && npm run build"
```

保留全部现有脚本和顺序，不修改依赖。

- [ ] **Step 3: 运行检查器并确认它因旧结构而失败**

Run: `npm run docs:check`

Expected: 退出码为 1，并至少报告缺少 `docs/PROJECT-MANUAL.md`、缺少 `docs/internal/README.md`、仍存在 `docs/deployment/linux-docker.md` 和 `docs/superpowers`。这证明检查器能够识别本次要解决的问题。

- [ ] **Step 4: 提交检查基线**

```bash
git add package.json scripts/check-docs.mjs
git commit -m "test: add documentation structure checks"
```

---

### Task 2: 归档历史设计和计划

**Files:**
- Create: `docs/internal/README.md`
- Move: `docs/superpowers/specs/*.md` → `docs/internal/specs/*.md`
- Move: `docs/superpowers/plans/*.md` → `docs/internal/plans/*.md`

- [ ] **Step 1: 移动历史文件并保留 Git 追踪**

使用 `git mv` 逐目录移动。`docs/internal/specs` 已存在本次设计文件；移动时不能覆盖同名文件。移动后应满足：

```text
docs/internal/
├── README.md
├── specs/
│   ├── 2026-08-18-documentation-reorganization-design.md
│   └── 既有设计文件
└── plans/
    ├── 2026-08-18-documentation-reorganization.md
    └── 既有实施计划
```

- [ ] **Step 2: 写内部资料说明**

`docs/internal/README.md` 必须明确：

- 该目录用于追溯设计决策和历史实施过程，不是用户操作说明。
- 历史文件描述的是编写当时的计划，路径、命令和实现状态可能已经变化。
- 当前使用、部署、运维和开发说明只以 `../../README.md` 与 `../PROJECT-MANUAL.md` 为准。
- `specs` 保存“为什么这样设计”，`plans` 保存“当时如何实施”。
- 修改当前行为时，应先更新正式主手册；只有新设计需要追溯时才新增内部规格。

- [ ] **Step 3: 核对移动没有改写历史正文**

Run: `git diff --summary`

Expected: 既有文件显示为 rename；除新建 `docs/internal/README.md` 外，不应出现历史文件的大段内容变化。

- [ ] **Step 4: 提交内部归档**

```bash
git add docs/internal docs/superpowers
git commit -m "docs: archive internal design records"
```

---

### Task 3: 重写中文项目首页

**Files:**
- Modify: `README.md`

- [ ] **Step 1: 将 README 改为单一入口，而不是第二本手册**

README 采用以下标题结构，顺序不可打乱：

```markdown
# 科普视频工作台

## 项目简介
## 核心能力
## 正式支持范围
## 快速本地体验
## 正式部署
## 文档入口
## 开发验证
## 发布前提醒
```

各节必须包含：

- “项目简介”：说明这是从主题或脚本生成带旁白、字幕和镜头的科普短视频工作台，面向受信任局域网多人使用。
- “核心能力”：脚本导入/生成、分镜确认、图片/视频/音频/CSV/XLSX 素材变量、Seedance 或本地回退、局部返修和历史版本、会话级个人 API。
- “正式支持范围”：单台 Linux、一个 app、一个 Caddy、SQLite 单写实例、内部 HTTPS；明确不支持公网直暴露、多副本和共享 SQLite。
- “快速本地体验”：Node.js 22.12+、Python 3.10+，依次执行 `npm install`、`npm run setup:tts`、`npm run dev`，访问 `http://127.0.0.1:5173`；强调只用于本机开发。
- “正式部署”：只提供一句边界说明和指向 `docs/PROJECT-MANUAL.md` 正式部署章节的链接，不复制 Compose 命令。
- “文档入口”：列出普通用户、管理员、开发维护者三个锚点链接，以及内部资料入口并标注“不用于部署”。
- “开发验证”：列出 `npm run docs:check`、`npm test`、`npm run build` 和聚合命令 `npm run verify`。
- “发布前提醒”：医疗健康内容必须经过权威来源核验和人工复核。

- [ ] **Step 2: 检查 README 没有重复部署正文**

Run: `rg -n "docker compose|backup\.sh|restore\.sh" README.md`

Expected: 无输出。README 只链接主手册，不复制运维命令。

- [ ] **Step 3: 提交项目首页**

```bash
git add README.md
git commit -m "docs: rewrite project entrypoint in Chinese"
```

---

### Task 4: 编写主手册的项目、用户和个人 API 部分

**Files:**
- Create: `docs/PROJECT-MANUAL.md`

- [ ] **Step 1: 建立封面、目录和角色路线**

文档标题为 `# 科普视频工作台完整项目手册`。开头写明：版本适用范围、唯一权威说明、尖括号占位值规则、命令平台规则，以及三条阅读路线。目录链接覆盖全部 21 个二级章节。

- [ ] **Step 2: 完成第 1-4 章**

必须包含以下信息：

- 第 1 章：手册用途、普通用户/管理员/开发者路线、如何识别命令和安全警告。
- 第 2 章：能力、已知限制、正式支持与不支持范围；不得承诺公网、多副本或高可用。
- 第 3 章：客户端 → Caddy → app → SQLite/数据目录的文本架构图；解释入站 HTTPS、Compose 私有网络和外部 API 出站流量；列出仓库目录职责和生产数据布局。
- 第 4 章：Windows PowerShell 与 Linux Bash 两套本地开发准备，给出 Node/Python 版本检查、依赖安装、TTS 安装、开发服务器启动、访问地址、成功现象、停止方式和常见启动失败。

- [ ] **Step 3: 完成第 5 章普通用户操作**

按真实界面顺序说明：

1. 登录与退出。
2. 输入主题、关键词、受众、时长和风格。
3. AI 辅助脚本与自带脚本，导入 TXT/Markdown/DOCX。
4. CSV/XLSX 数据素材限制和解析结果。
5. 生成剧本后进入分镜，不会立即消耗全部视频生成额度。
6. 修改镜头顺序、时长、旁白、标题和视觉方向。
7. 上传图片、视频、音频、CSV、XLSX，理解 `@变量名`。
8. exact overlay、AI reference、first frame、last frame 和图表绑定的差异。
9. 明确确认后运行预检并开始生成。
10. 查看进度、结果、下载和失败重试。
11. Recompose、Edit existing shot、Regenerate shot 的费用和行为差异。
12. 历史版本恢复的影响。

每个关键流程写出“看见什么表示成功”和对应失败处理。

- [ ] **Step 4: 完成第 6 章个人 API 设置**

必须准确说明：

- 只有启用 `LAN_ACCESS_TOKEN` 的认证会话可使用个人设置。
- 脚本 API 支持 OpenAI 兼容端点或 DeepSeek；视频 API 使用 Ark Seedance。
- “服务器默认”和“个人配置”的优先级。
- 密钥提交后服务端不回显，重新打开密钥框为空是正常行为。
- 密钥只在服务端会话内存，登出、会话过期、进程重启时清除。
- 设置变更只影响之后提交的任务；排队/运行任务使用提交时捕获的设置；重试使用发起重试会话当时的设置。
- 自定义脚本端点必须是允许的 HTTPS 公网 DNS 主机；`PERSONAL_API_ALLOWED_HOSTS` 只由管理员配置。
- 通用 `VIDEO_PROVIDER_URL` 仍是管理员配置，个人设置不能选择。
- 分别给出 OpenAI、DeepSeek 和 Ark 的字段示例，但使用虚构密钥 `example-not-a-real-key` 并明确不可照抄。
- 提供 400、401、403、409、422 和上游 API 失败的判断与处理表。

- [ ] **Step 5: 执行阶段检查并提交**

Run: `node scripts/check-docs.mjs`

Expected: 此阶段仍会因旧部署文档存在而失败，但不得报告 `README.md`、`docs/PROJECT-MANUAL.md`、`docs/internal/README.md` 的缺失、标题跳级、围栏错误或本地链接错误。

```bash
git add docs/PROJECT-MANUAL.md
git commit -m "docs: add project and user manual"
```

---

### Task 5: 合并完整部署、运维、开发和速查内容

**Files:**
- Modify: `docs/PROJECT-MANUAL.md`
- Delete: `docs/deployment/linux-docker.md`

- [ ] **Step 1: 完成第 7-12 章部署流程**

以旧部署手册的有效内容为基础，但补足统一操作格式：

- 第 7 章：上线决策、最低/推荐资源、AMD64/ARM64、稳定 IP/DNS、存储容量、时间同步和上线前表格。
- 第 8 章：Docker Engine/Compose v2 检查，`/srv/science-video-workbench/{app,data,backups}` 和 UID/GID 10001，数据哨兵与权限，防火墙仅允许可信网段。
- 第 9 章：逐项表格解释 `deploy/.env.production.example` 中所有变量，包含是否必填、默认值、示例、敏感性、错误配置结果；另列本地 `.env.example` 差异。
- 第 10 章：获取代码、复制环境文件、生成口令、配置权限、Compose 静态验证、构建、启动、`ps`、日志和 readiness；每条命令注明工作目录、账号、预期结果和失败处理。
- 第 11 章：导出 Caddy 根证书、核对 SHA-256、Windows 导入受信任根、浏览器验证、证书轮换和私钥禁运规则。
- 第 12 章：自动测试、容器安全属性、真实局域网登录、任务生成、会话隔离、重启持久化和备份恢复回环验收。

- [ ] **Step 2: 完成第 13-17 章运维与安全**

- 第 13 章：状态、启动、停止、重启、日志、磁盘、inode、容器资源、readiness、维护 CLI；禁止默认建议强制杀进程。
- 第 14 章：数据组成、停机一致性备份、systemd timer、镜像备份、SHA-256 验证、恢复前检查、安全归档、恢复回滚和灾难恢复顺序。
- 第 15 章：升级前空闲检查与备份、记录提交/镜像、拉取目标版本、重建、验收、代码回滚和数据回滚边界。
- 第 16 章：按“证书警告、访问超时、登录循环、app unhealthy、SQLite locked、完整性失败、权限、磁盘、ffmpeg/TTS、外部 API、AI reference、ARM64”组织症状表；每项包含首选命令、判断和处理。
- 第 17 章：可信局域网、HTTPS、口令、密钥、非 root、只读根、no-new-privileges、单实例、备份异机副本、恢复演练和医疗内容复核清单。

- [ ] **Step 3: 完成第 18-21 章开发与参考**

- 第 18 章：开发依赖、目录说明、开发/生产命令、测试布局、构建产物、添加配置或接口时必须更新的文件，以及正式发布验证顺序。
- 第 19 章：环境变量、端口、宿主机路径、容器路径、npm 命令、部署脚本、维护 CLI、主要 HTTP 接口和常见状态码速查表；接口只记录当前源码存在的路径。
- 第 20 章：发布、备份恢复、证书变更、故障处理记录模板，字段足以追踪提交、镜像、备份哈希、证书指纹、验收和操作人。
- 第 21 章：解释 Caddy、内部 CA、readiness、SQLite WAL、会话级 API、exact overlay、AI reference、recompose、regenerate；FAQ 至少回答本地能否使用、能否公网开放、能否多副本、为何 API 密钥框为空、为何供应商访问不到局域网素材、服务重启后个人设置为何消失、备份是否能不停机。

- [ ] **Step 4: 删除重复部署正文并修正链接**

确认第 7-17 章包含旧手册的全部仍有效内容后删除 `docs/deployment/linux-docker.md`。运行：

```bash
rg -n "docs/deployment/linux-docker\.md|docs/superpowers" README.md docs --glob "*.md"
```

Expected: 正式 README 和主手册无旧路径；内部历史文件中作为历史文字出现的旧路径可以保留，但不能形成指向不存在文件的 Markdown 链接。

- [ ] **Step 5: 运行文档检查并提交**

Run: `npm run docs:check`

Expected: 输出“文档检查通过”，并显示实际检查到的正整数 Markdown 文件数。

```bash
git add README.md docs scripts/check-docs.mjs package.json
git commit -m "docs: publish unified project manual"
```

---

### Task 6: 全量发布验收

**Files:**
- Verify only; do not change business code.

- [ ] **Step 1: 检查文档结构和未完成内容**

```powershell
npm run docs:check
rg -n "TBD|TODO|FIXME|replace-me" README.md docs/PROJECT-MANUAL.md
rg --files docs
```

Expected: 文档检查通过；占位扫描无输出；`docs` 只包含 `PROJECT-MANUAL.md` 和 `internal` 树，不包含 `deployment` 或 `superpowers`。

- [ ] **Step 2: 检查手册与当前配置的一致性**

逐项对比：

```powershell
rg -n "^[A-Z][A-Z0-9_]*=" .env.example deploy/.env.production.example
rg -n "^[A-Z][A-Z0-9_]*=" docs/PROJECT-MANUAL.md
rg -n '"[a-z][a-z:-]*":' package.json
rg -n "npm run|docker compose|deploy/(backup|restore)\.sh" docs/PROJECT-MANUAL.md
```

Expected: 手册的配置表覆盖两个示例环境文件中的变量；所有 npm 和部署脚本命令都能在仓库中找到来源。

- [ ] **Step 3: 执行自动测试、构建和审计**

```powershell
$env:PATH = 'C:\Users\jiongle.chen\AppData\Local\Programs\Git\bin;' + $env:PATH
npm test -- --exclude ".worktrees/**"
npm run build
npm audit --omit=dev
```

Expected: 33 个测试文件、117 项测试通过；Vite/TypeScript 生产构建通过；生产依赖报告 0 个已知漏洞。若测试数量因新增测试发生合理增长，以全部通过为准。

- [ ] **Step 4: 检查部署静态文件和 Git 差异**

```powershell
bash -n deploy/entrypoint.sh deploy/lib.sh deploy/backup.sh deploy/restore.sh
docker compose --env-file deploy/.env.production.example config --quiet
git diff --check
git status --short --branch
```

Expected: Shell 语法检查通过；有 Docker 的环境中 Compose 配置通过；`git diff --check` 无输出；工作树只包含本计划产生且尚未提交的预期文件。当前 Windows 机器若没有 Docker，必须明确记录 Compose/镜像实机验证未执行，不能把静态检查描述为实机验收。

- [ ] **Step 5: 提交最终核对修正**

只有发现并修正文档错误时才创建此提交：

```bash
git add README.md docs package.json scripts/check-docs.mjs
git commit -m "docs: correct manual verification findings"
```

最终要求 `git status --short --branch` 只显示当前分支名，不包含未提交文件。
