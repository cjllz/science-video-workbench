# 仓库整洁自动检查设计

## 1. 目标

在不增加第三方依赖、不修改业务逻辑的前提下，为科普视频工作台建立可重复执行的仓库整洁检查，防止构建产物、运行数据、真实配置、密钥、日志、数据库、媒体输出和临时文件进入 Git 提交。

该机制必须同时覆盖：

- 提交前：项目内 `pre-commit` hook 检查暂存区并阻止违规提交。
- 日常检查：开发者可以手动检查全部已跟踪文件。
- 发布验证：`npm run verify` 自动执行仓库整洁检查。
- 新克隆仓库：提供明确的 hook 安装命令，不修改全局 Git 配置。

## 2. 当前基线

当前 `main` 工作树干净，117 个已跟踪文件中没有构建产物、运行数据、真实环境文件、数据库、媒体输出、证书或私钥。

现有 `.gitignore` 和 `.dockerignore` 已覆盖：

- `node_modules/`
- `dist/`
- `data/`
- `output/`
- `.env`
- `deploy/.env.production`
- 日志
- `.artifacts/`
- `.playwright-cli/`
- `.qa/`
- `.worktrees/`

当前缺口是没有自动提交拦截，且忽略规则没有覆盖测试覆盖率、工具缓存、TypeScript 增量文件和常见临时/备份后缀。

## 3. 采用方案

采用“标准库检查脚本 + 项目内 Git hook + npm 命令 + 忽略规则”的组合：

```text
.githooks/pre-commit
scripts/check-repository.mjs
package.json
.gitignore
.dockerignore
README.md
docs/PROJECT-MANUAL.md
```

不采用以下方案：

- 不依赖 Husky、lint-staged 或其他 npm 包，避免增加安装面和锁文件变化。
- 不把 hook 写入 `.git/hooks`，因为该目录不受版本控制。
- 不自动修改用户全局 `core.hooksPath`。
- 不增加新的独立用户手册，说明继续维护在现有 README 和完整项目手册中。

## 4. 检查模式

`scripts/check-repository.mjs` 提供两种模式：

### 4.1 全仓库模式

命令：

```text
npm run repo:check
```

检查：

- `git ls-files` 返回的全部已跟踪文件。
- `git ls-files -ci --exclude-standard` 返回的“已经跟踪但按当前规则应忽略”的文件。
- 每个已跟踪路径是否命中禁止目录、文件名或扩展名。

该模式用于人工检查和 `npm run verify`。

### 4.2 暂存区模式

命令：

```text
npm run repo:check -- --staged
```

检查 `git diff --cached --name-only --diff-filter=ACMR -z` 返回的新增、复制、修改和重命名目标文件。删除操作不会因为已删除路径而失败。

该模式由 `pre-commit` hook 调用。它只判断即将提交的暂存内容，不会擅自暂存、取消暂存或改写文件。

## 5. 禁止内容

以下目录无论位于仓库哪一层，都不能被跟踪或加入暂存提交：

- `node_modules`
- `dist`
- `coverage`
- `.cache`
- `.vite`
- `data`
- `output`
- `.artifacts`
- `.playwright-cli`
- `.qa`
- `.worktrees`
- `.superpowers`

以下文件不能被跟踪或提交：

- 根目录 `.env`
- `deploy/.env.production`
- `.DS_Store`
- `Thumbs.db`
- npm 调试日志
- 扩展名为 `.log`、`.tmp`、`.temp`、`.bak`、`.swp`、`.swo`、`.tsbuildinfo`
- 扩展名为 `.sqlite`、`.sqlite3`、`.db`
- 扩展名为 `.pem`、`.key`、`.p12`、`.pfx`
- 扩展名为 `.mp4`、`.mov`、`.webm`、`.wav`、`.mp3`

示例配置 `.env.example` 和 `deploy/.env.production.example` 是明确允许并且必须跟踪的文件。源代码需要的静态图片不按扩展名一刀切禁止，以免误伤真实前端资源。

## 6. 密钥内容检查

对于暂存区中可作为 UTF-8 文本读取、且大小不超过 1 MiB 的文件，检查以下高风险标记：

- PEM/OpenSSH 私钥头。
- 常见长格式 API Key 前缀。

检查只报告文件路径和规则名称，不打印匹配到的秘密值。二进制文件或超过大小限制的文件仍接受路径规则检查，但不加载全文。

示例文档中使用的 `example-not-a-real-key` 不应误报。

## 7. Hook 与安装

`.githooks/pre-commit` 使用 Git for Windows 和 Linux 都能执行的 POSIX shell：

```sh
#!/usr/bin/env sh
set -eu
npm run repo:check -- --staged
```

`package.json` 增加：

- `hooks:install`：执行 `git config --local core.hooksPath .githooks`。
- `repo:check`：运行仓库检查器。
- `verify`：按“仓库检查 → 文档检查 → 测试 → 构建”的顺序执行。

当前仓库实施完成后执行一次 `npm run hooks:install`。新克隆仓库的开发者需要在安装依赖后执行同一命令。该配置只写当前仓库的 `.git/config`，不影响其他仓库和全局 Git 设置。

## 8. 错误输出和退出码

检查通过时输出模式和检查文件数量，退出码为 0。

检查失败时：

- 每个违规文件单独列出相对路径和规则原因。
- 不输出文件内容或密钥值。
- 退出码为 1。
- 最后提示如何取消暂存或移动/删除生成文件，但脚本不自动执行修复。

Git 命令无法执行、当前目录不是仓库或暂存内容无法读取时，检查失败并返回非零退出码，不能静默放行。

## 9. 忽略规则

`.gitignore` 和 `.dockerignore` 在现有规则基础上补充：

- `coverage/`
- `.cache/`
- `.vite/`
- `*.tsbuildinfo`
- `*.tmp`
- `*.temp`
- `*.bak`
- `*.swp`
- `*.swo`
- `.DS_Store`
- `Thumbs.db`

数据库、证书和媒体输出也加入忽略规则，但不忽略正常源码媒体目录。忽略规则是第一层防护；检查脚本仍要阻止通过 `git add -f` 强制加入的违规文件。

## 10. 文档更新

`README.md` 的开发验证部分增加：

- 首次克隆后执行 `npm run hooks:install`。
- 提交前执行 `npm run repo:check` 或 `npm run verify`。
- 说明 hook 会拒绝哪些内容。

`docs/PROJECT-MANUAL.md` 的开发维护章节增加：

- hook 安装和检查命令。
- 禁止提交内容和允许示例配置。
- hook 失败时的处理方法。
- 不得使用 `--no-verify` 绕过，除非经过明确的代码库维护审批并在提交后补做检查。

配置和部署正文仍以现有第 7-19 章为唯一权威来源，不再新增重复文档。

## 11. 验证策略

实施后至少验证：

1. 当前仓库全量检查通过。
2. 正常源码文件在暂存模式通过。
3. 暂存 `dist/example.js` 被拒绝，即使通过 `git add -f` 强制加入。
4. 暂存 `.env` 被拒绝，`.env.example` 被允许。
5. 暂存私钥头文本时只输出文件路径，不输出秘密内容。
6. 删除一个原本违规的文件不会阻止提交。
7. hook 未暂存、取消暂存或修改任何文件。
8. `npm run hooks:install` 只设置本仓库 `core.hooksPath=.githooks`。
9. `npm run verify`、全量测试和生产构建通过。
10. `git diff --check` 和最终 `git status --short --branch` 干净。

测试违规暂存内容时只使用专用临时文件，验证后必须取消暂存并删除；这些文件不能进入任何提交。

## 12. 非目标

本次工作不包含：

- 不修改业务逻辑、部署拓扑或运行配置含义。
- 不引入 GitHub Actions 或其他远程 CI，因为当前仓库没有远程仓库配置。
- 不扫描完整 Git 历史。
- 不替代专业秘密扫描、软件成分分析或组织级提交策略。
- 不自动删除本地生成文件。
- 不阻止提交经过评审的正常静态资源或依赖锁文件。
