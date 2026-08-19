# 科普视频工作台开发技术文档

本文档面向开发和维护代码的人员。生产值、服务器命令和恢复流程以 [部署运维手册](DEPLOYMENT.md) 为准；浏览器操作以 [详细使用说明](USER-GUIDE.md) 为准。

## 目录

1. 技术栈、运行模式与边界
2. 系统架构与数据流
3. 仓库结构与模块职责
4. 本地开发环境
5. 配置解析与新增配置契约
6. 数据模型、SQLite 与文件存储
7. 认证、会话和个人 API 设置
8. 剧本、任务队列与生成流程
9. 素材融合与视频合成
10. HTTP 接口与状态码
11. 测试、视觉 QA 与构建
12. 发布验证、文档同步与提交规范

## 1. 技术栈、运行模式与边界

### 技术栈

- TypeScript、Node.js 22、Express 5 和 Zod 组成服务端。
- React 19、Vite 7 和 Lucide React 组成浏览器界面。
- SQLite 保存共享业务数据；素材、输出和修订文件保存在数据目录。
- ffmpeg、Sharp、Edge TTS 和可选外部脚本/视频供应商完成媒体处理。
- Vitest 覆盖前后端纯逻辑、HTTP、数据库并发和部署脚本契约。

### 能做什么

科普视频工作台可以完成以下流程：

- 从主题、关键词、受众、时长和风格生成科普脚本。
- 导入 TXT、Markdown 或 DOCX 脚本，跳过从零撰写。
- 把脚本拆成可编辑的连续分镜，逐镜调整旁白、标题、时长和视觉方向。
- 上传图片、视频、音频、CSV、XLSX 素材，并把它们作为 `@变量名` 绑定到镜头。
- 使用本地信息卡和图表生成视频，也可调用外部脚本模型和 Ark Seedance。
- 在真正调用视频生成服务前停留在分镜确认阶段，避免误消耗额度。
- 对完成视频执行本地重组、编辑已有供应商镜头或仅重做一个镜头。
- 保存任务、输出、素材、反馈和修订版本，用于继续编辑和结构经验沉淀。
- 让不同登录会话使用各自的个人 API 设置，而不把密钥写入持久化存储。

### 正式支持的部署

正式支持基线为：

- 一台受维护的 Linux 服务器。
- Docker Engine 和 Docker Compose v2。
- 一个应用容器。
- 一个 Caddy 容器。
- 一份本机 SQLite 数据库。
- 一个宿主机持久化数据目录。
- 局域网客户端通过 Caddy 内部 CA 使用 HTTPS。
- 同一时刻只运行一个应用实例。
- 受信任的内部用户共享一个局域网访问口令，各浏览器会话相互独立。

### 明确不支持

以下场景不在当前正式支持范围内：

- 直接暴露到公网或通过路由器做端口转发。
- 多应用副本、负载均衡或 Kubernetes。
- 多台服务器共享同一 SQLite 文件。
- 把应用的 8787 HTTP 端口直接开放给局域网用户。
- 不中断写入的数据库备份、恢复或版本升级。
- 自动把 Caddy 根私钥分发给客户端。
- 企业级单点登录、细粒度账号权限和集中密钥托管。

需要公网、多节点或企业身份系统时，应先更换数据库、会话、对象存储和密钥管理架构，不能直接扩大当前 Compose 拓扑。

### 外部服务与本地回退

没有外部 API 时，系统仍可使用本地模板、动画信息卡、数据图表、旁白和字幕完成基础视频。外部脚本 API 决定脚本规划质量，Ark Seedance 决定真实 AI 镜头生成能力。

图片或视频使用“原样叠加”时由本机 ffmpeg 合成，不需要供应商访问素材。AI reference、首帧、尾帧或编辑已有镜头需要外部供应商读取素材/输出 URL，因此必须配置供应商可访问的公网 HTTPS 来源。局域网地址、`.local` 名称和内部 CA 通常无法被外部供应商访问。

### 内容责任

系统不会替代事实核验、医学审核、版权审核或发布审批。医疗和健康内容必须引用权威来源，由具备相应知识或资质的人员复核；上传素材、音乐、图片和生成结果的使用权由发布者负责。

开发模式默认只监听回环地址，Vite 在 5173 端口代理 `/api` 和 `/outputs` 到 8787。正式模式由一个应用容器和 Caddy 组成，只支持单主机、单应用进程和 SQLite 单写。不要通过增加 Compose 副本数来扩容。

## 2. 系统架构与数据流

```text
受信任局域网客户端
        |
        | HTTPS 443
        v
Caddy 内部 CA + 反向代理
        |
        | Compose 私有网络 app:8787
        v
单个 Node.js 应用容器
        |
        +--> SQLite / 素材 / 输出 / 修订版本
        |        位于宿主机 DATA_DIR
        |
        +--> 外部脚本 API / Ark / TTS（出站 HTTPS）
```

Caddy 在宿主机绑定 80/443；应用端口 8787 只在 Compose 私有网络暴露。客户端 Cookie 使用 HTTPS 安全属性，应用通过 `TRUST_PROXY=1` 信任前方唯一一个 Caddy。不要在 Caddy 前再随意叠加代理层，否则来源和 Cookie 判断可能不符合预期。

### 信任边界

- **客户端与 Caddy**：客户端必须信任管理员核对过指纹的 Caddy 根证书。
- **Caddy 与应用**：只通过 Compose 私有网络通信，不发布应用端口。
- **应用与数据目录**：容器以 UID/GID 10001 写入唯一 bind mount；根文件系统只读。
- **应用与外部 API**：服务器携带管理员或当前会话的密钥发起出站请求。
- **管理员与备份**：备份/恢复脚本以受控权限运行，验证路径、哨兵、挂载、所有权和归档哈希。

### 业务数据流

```text
浏览器请求
  -> Express 路由与认证/来源保护
  -> Zod/业务校验
  -> SQLite 任务、计划、事件和素材记录
  -> 内存并发门控与持久化任务状态
  -> 脚本规划 / 供应商视频 / 本地回退
  -> TTS、ffmpeg、图表和字幕合成
  -> data/outputs 与修订记录
  -> 浏览器轮询任务并下载结果
```

应用启动时会恢复可恢复任务状态；关闭时先停止接单并等待活动任务。`/api/health` 只证明进程存活，`/api/ready` 还检查数据库、目录、ffmpeg 和 TTS。

## 3. 仓库结构与模块职责

| 路径 | 用途 | 是否运行时数据 |
| --- | --- | --- |
| `src/client/` | React 用户界面 | 否 |
| `src/server/` | Express API、任务、数据库、渲染和维护逻辑 | 否 |
| `src/shared/` | 前后端共享类型 | 否 |
| `deploy/` | Caddy、环境模板、入口、备份和恢复脚本 | 否 |
| `scripts/` | 开发和质量检查脚本 | 否 |
| `docs/DEPLOYMENT.md` | 当前部署运维手册 | 否 |
| `docs/internal/` | 历史规格和实施计划 | 否 |
| `dist/` | 本地生产构建产物，可重新生成 | 否 |
| `data/` | 本地开发数据，生产中由 `DATA_DIR` 挂载 | 是 |

### 主要模块

| 目录/文件 | 职责 |
| --- | --- |
| `src/client/App.tsx` | 顶层工作流、登录、任务列表和状态切换 |
| `src/client/ScriptWorkspace.tsx` | 分镜和素材变量编辑 |
| `src/client/RetouchWorkspace.tsx` | 完成后返修和版本恢复 |
| `src/client/ProviderSettingsDialog.tsx` | 当前会话 API 设置 |
| `src/client/api.ts` | 浏览器 API 客户端、写请求保护头 |
| `src/server/index.ts` | Express 路由、上传和任务入口 |
| `src/server/db.ts` | SQLite 初始化和共享数据访问 |
| `src/server/pipeline.ts` | 规划、队列和渲染流程 |
| `src/server/renderer.ts` | ffmpeg/TTS/本地合成 |
| `src/server/providers/` | 外部视频供应商适配 |
| `src/server/auth*.ts` | 局域网认证、Cookie 和写请求来源保护 |
| `src/server/provider-settings*.ts` | 会话 API 设置、解析和 URL 策略 |
| `src/server/readiness.ts` | 数据库、目录、ffmpeg、TTS 就绪检查 |
| `src/server/maintenance*.ts` | 空闲检查和只读数据验证 |
| `src/server/shutdown.ts` | 停止接单、等待任务和关闭资源 |
| `src/shared/` | 前后端共享类型和协议 |
| `deploy/` | 容器入口、Caddy、生产环境模板、备份恢复 |

共享协议集中在 `src/shared/`，前后端都使用这些类型。新增字段时应从共享类型开始，依次更新服务端解析和持久化、客户端 API/表单、迁移或兼容默认值以及测试，避免只修一端。

## 4. 本地开发环境

### 适用场景

本节用于开发、演示和验证界面，不是局域网正式部署。默认服务只监听回环地址，不要求 `LAN_ACCESS_TOKEN`，个人 API 设置不可用。

### 前置条件

- Node.js `22.12.0` 或更新版本。
- npm（随 Node.js 安装）。
- Python `3.10` 或更新版本。
- 可访问 npm 和 Python 包源。
- 至少几 GiB 可用磁盘；视频处理会产生临时文件和输出。

Windows PowerShell：

```powershell
node --version
npm --version
python --version
```

Linux Bash：

```bash
node --version
npm --version
python3 --version
```

Node 低于 22.12 时不要继续。Python 命令名只有 `python3` 时，可以使用 `python3 -m pip install -r requirements.txt` 代替 npm 的 TTS 辅助脚本。

### 安装并启动

工作目录：仓库根目录。

Windows PowerShell 或 Linux Bash：

```text
npm install
npm run setup:tts
npm run dev
```

预期结果：

- Vite 客户端监听 `http://127.0.0.1:5173`。
- Express 服务监听 `http://127.0.0.1:8787`。
- 浏览器打开 5173 后显示“科普视频工作台”。
- 没有外部 API 时，界面显示本地脚本/本地生成服务，而不是启动失败。

验证 API：

```powershell
Invoke-RestMethod http://127.0.0.1:8787/api/health
Invoke-RestMethod http://127.0.0.1:8787/api/ready
```

预期返回包含 `ok: true`。`health` 只说明进程响应，`ready` 还会检查数据库、数据目录、ffmpeg 和 TTS。

### 停止与重新启动

在运行 `npm run dev` 的终端按 `Ctrl+C`。开发进程由 `concurrently` 管理，任一子进程退出时会停止另一进程。再次执行 `npm run dev` 即可启动；本地 `data/` 中的任务不会因正常重启自动删除。

### 本地生产模式

```powershell
npm run build
npm start
```

预期 `dist/server` 和 `dist/client` 生成，服务在 `http://127.0.0.1:8787` 提供 API 和构建后的前端。修改源码后必须重新构建。

### 常见启动问题

| 现象 | 检查 | 处理 |
| --- | --- | --- |
| `EBADENGINE` | `node --version` | 升级到 Node 22.12+ 后重新安装依赖 |
| 5173 或 8787 被占用 | 查找占用端口的进程 | 停止旧开发进程，不要同时启动两套写同一数据目录的服务 |
| TTS 导入失败 | `python -c "import edge_tts"` | 重新执行 `npm run setup:tts`，核对 Python/pip 环境 |
| ffmpeg 不可用 | 查看 `/api/ready` 的失败组件 | 允许 `ffmpeg-static` 安装，或通过绝对路径设置 `FFMPEG_PATH` |
| 页面能开但 API 失败 | 查看 dev:server 终端 | 确认 8787 服务运行，Vite 代理配置未被改动 |

不要用 `HOST=0.0.0.0 npm start` 临时替代正式部署。非回环监听会强制要求至少 16 字符的 `LAN_ACCESS_TOKEN`，但裸 HTTP 仍不能保护登录口令、会话 Cookie 和个人密钥。

### 依赖与常用命令

推荐在 Node.js `22.12.0` 或更新版本、Python `3.10` 或更新版本上开发。生产容器使用 Node 22 Bookworm、系统 ffmpeg、Python 虚拟环境和 `tini`。本地依赖安装：

```powershell
npm install
npm run setup:tts
```

`npm install` 用于开发工作区；生产镜像使用锁文件和 `npm ci`。不要手工修改 `node_modules` 或把构建产物当作源码提交。

| 命令 | 用途 | 预期结果 |
| --- | --- | --- |
| `npm run dev` | 同时启动服务端和 Vite 客户端 | 5173 页面与 8787 API 可访问 |
| `npm run dev:server` | 监听服务端 TypeScript | 修改服务端后自动重启 |
| `npm run dev:client` | 只启动 Vite | 5173 代理 `/api`、`/outputs` 到 8787 |
| `npm test` | 单次运行 Vitest | 所有测试通过并退出 |
| `npm run test:watch` | 测试监听模式 | 文件变化后重跑相关测试 |
| `npm run build` | 清理并构建服务端/客户端 | 生成 `dist/server` 和 `dist/client` |
| `npm start` | 启动已构建版本 | 从 `dist/server/index.js` 运行 |
| `npm run maintenance -- check-idle` | 检查活动任务 | 空闲退出 0；有活动任务退出 2 |
| `npm run maintenance -- validate-data` | 验证数据目录 | 有效退出 0；无效退出 3 |
| `npm run docs:check` | 检查正式文档结构和本地链接 | 输出检查通过和文件数 |
| `npm run verify` | 文档检查、测试和生产构建 | 三步全部通过 |

维护命令依赖生产构建；源码变化后先执行 `npm run build`。

本地 `data/`、`dist/`、测试截图和媒体输出都可重新生成或属于运行数据，不应提交。开发服务和已构建服务不能同时写同一个数据目录。

## 5. 配置解析与新增配置契约

### 运行时配置入口

`src/server/runtime-config.ts` 负责读取环境变量、解析数值和布尔值、应用默认值并执行安全校验。`src/server/index.ts` 消费解析后的配置，不应在业务模块中再次用宽松字符串规则解释同一个变量。

关键约束包括：非回环 `HOST` 必须配合至少 16 字符且不是占位值的 `LAN_ACCESS_TOKEN`；端口和并发必须在允许范围；`FFMPEG_PATH` 只能使用可接受的绝对路径；代理信任层数和公开 URL 必须符合生产拓扑。

生产配置的完整变量表见 [部署运维手册第 3 章](DEPLOYMENT.md#3-生产环境变量)。代码中的解析和文档中的含义必须一致。

### 新增或修改变量的检查表

新增或修改环境变量时至少检查：

1. `src/server/runtime-config.ts` 的解析、默认值和安全校验。
2. `.env.example` 的本地开发说明。
3. `deploy/.env.production.example` 的生产示例。
4. `compose.yaml` 是否需要传入容器。
5. 部署运维手册的生产变量和速查章节。
6. 对应的运行时配置测试。

新增或修改接口时至少检查服务端路由、`src/client/api.ts`、共享类型、认证/写请求保护、接口测试和本手册速查表。

还要明确：变量是否敏感、是否允许为空、开发/生产默认值、容器是否需要透传、错误消息是否可操作、旧部署升级时的兼容行为。敏感变量不得打印到日志、错误响应、任务快照或测试快照。

## 6. 数据模型、SQLite 与文件存储

### 数据目录

推荐布局：

```text
/srv/science-video-workbench/
├── app/          # Git 工作树、Compose 和部署脚本
├── data/         # SQLite、素材、输出和修订
└── backups/      # 本机轮换备份
```

`data` 与 `backups` 必须是不同目录，备份目录不能嵌套在数据目录中。正式环境还应把经过校验的备份镜像到另一块物理介质、NAS 或受控备份系统。

本地默认 `data/` 下包含 SQLite 数据库、上传素材、生成输出、修订归档和运行所需的持久化文件。生产环境把宿主机 `DATA_DIR` 绑定到容器 `/app/data`；构建产物 `dist/` 不属于备份数据。

### SQLite 一致性

SQLite 使用单进程访问。应用启动会以幂等方式初始化表，并为并发初始化锁提供有限重试；这不意味着可以运行多个应用副本。备份脚本会检查任务空闲、停止应用、归档数据、生成 SHA-256 和清单，再重启应用。恢复脚本会先验证归档、创建安全备份、只读验证候选数据，并在启动失败时尝试回退。

数据库初始化使用 WAL 和幂等建表，对 SQLite 错误码 5 的锁冲突做有限期限的短暂错峰重试。该机制只解决同一数据库首次并发初始化的瞬时竞争，不提供多应用副本写入能力。

改变数据结构时，要同时评估旧数据库启动、空数据库初始化、恢复验证、任务恢复和回滚兼容性。至少运行数据库初始化、数据访问、任务生命周期、恢复和维护验证相关测试。

## 7. 认证、会话和个人 API 设置

### 局域网认证

`src/server/auth.ts` 和 `auth-http.ts` 实现共享口令、HttpOnly Cookie、会话过期和写请求来源保护。生产请求通过 `TRUST_PROXY=1` 信任唯一 Caddy；非 GET/HEAD/OPTIONS 请求要求 `X-Science-Video-Request: 1`，存在 `Origin` 时还校验协议和主机。

认证解决的是受信任局域网的访问门槛，不是细粒度租户隔离。任务、素材和输出是共享的，恢复版本和返修会改变所有用户看到的任务状态。

### 个人供应商设置

`provider-settings-store.ts` 把个人密钥放在服务端会话内存中，不写浏览器存储、SQLite、任务或输出；接口永不返回保存过的密钥。登出、会话过期和进程重启会清除设置。

`provider-settings.ts` 合并个人设置与服务器默认值，任务在规划、渲染、重试或返修提交时捕获有效设置快照。`provider-url-policy.ts` 要求个人 Base URL 使用允许的公网 HTTPS DNS 主机，拒绝重定向、凭据、自定义端口、IP、回环和私网解析结果，额外域名由 `PERSONAL_API_ALLOWED_HOSTS` 精确允许。

修改这一流程时，必须验证密钥不进入响应、日志、数据库和任务，旧会话不会跨用户复用，正在运行的任务不受后续设置变更影响。

## 8. 剧本、任务队列与生成流程

### 创建与规划

`POST /api/jobs` 校验视频定义或导入脚本，创建持久化任务。`pipeline.ts` 选择当前会话或服务器规划设置，调用外部脚本服务或本地规划器，保存可编辑的 `VideoPlan`，然后停在分镜确认阶段。

### 确认与预检

客户端通过 `PATCH /api/jobs/:id/plan` 保存分镜。点击最终生成后，`POST /api/jobs/:id/render` 捕获供应商设置并调用 `preflight.ts`，检查变量绑定、素材存在性、数据列、总时长和供应商可访问 URL。预检失败返回 422，不进入生成队列。

### 排队、生成与合成

`MAX_CONCURRENT_RENDERS` 限制渲染和返修并发。任务入队后按镜头选择 Ark/通用视频供应商或本地卡片回退，生成旁白和字幕，再由 `renderer.ts` 使用 ffmpeg 合成连续镜头、素材叠加和最终 MP4。任务状态、事件、输出路径和错误会持久化，浏览器通过查询任务观察进度。

### 返修与修订

重新合成只重跑本地旁白、字幕、图表和叠加；编辑已有镜头把当前供应商视频作为参考；重新生成镜头不使用原片。返修前归档当前 MP4、字幕、海报、计划和供应商片段，恢复接口把指定修订重新设为共享任务当前结果。

## 9. 素材融合与视频合成

### 数据结构与前端

`MaterialAsset` 保存素材类型、变量名、本地地址、可选公开地址和数据表信息；`ShotMaterialBinding` 保存素材 ID、变量名、角色、模式、位置、时间和可选图表配置。

`ScriptWorkspace.tsx` 在用户向镜头添加素材时，把 `@变量名` 追加到 `visualPrompt` 并创建绑定；移除时同时删除绑定和提示中的 `@` 引用。`material-bindings.ts` 把用户用途映射为 `ai_reference`、`exact_overlay` 或 `data_chart`，并提供按素材类型的默认角色、位置和时段。

### 解析与预检

`material-variables.ts` 扫描画面设计中的变量，解析绑定和素材。AI 引用会转换成供应商可理解的图片、视频或音频占位符；原样叠加和数据图表保留给本地渲染。

`preflight.ts` 在任何视频额度消耗前拒绝：未解析变量、素材记录缺失、图表字段不存在、时间范围/总时长无效，以及 AI 引用没有供应商可访问 URL。新增模式时必须先定义失败条件并补测试。

### 供应商与本地合成

`providers/video.ts` 把 AI 引用编码为 Ark 请求的 `image_url`、`video_url` 或 `audio_url` 内容，并为图片处理 `first_frame`、`last_frame` 角色；编辑已有镜头时额外提交参考视频。公开 URL 来自素材记录或 `MATERIAL_PUBLIC_BASE_URL`，已有输出来自 `OUTPUT_PUBLIC_BASE_URL`。

`renderer.ts` 在本机为数据素材生成折线图、柱状图或表格 SVG，再与 `exact_overlay` 一起通过 ffmpeg 按位置和开始/结束表达式叠加。原样模式保留源像素，不交给模型重画。

### 修改时的测试矩阵

- 前端用途映射、默认值、替换素材和变量重命名。
- 服务端变量解析、缺失绑定、公开 URL 和数据列预检。
- Ark 生成/编辑请求中的内容类型与首尾帧角色。
- 图表选择、叠加过滤、时间表达式和 ffmpeg 输入类型。
- 从保存计划到渲染/返修的集成路径，以及旧任务没有 `materialBindings` 时的兼容性。

## 10. HTTP 接口与状态码

### 主要 HTTP 接口

以下是维护和排障速查，不是稳定的第三方公共 API 承诺。业务客户端应以仓库中的共享类型和实现为准。

| 方法和路径 | 用途 | 认证/说明 |
| --- | --- | --- |
| `GET /api/health` | 进程存活 | 不代表依赖就绪 |
| `GET /api/ready` | 数据库、目录、ffmpeg、TTS 就绪 | 失败时返回组件信息 |
| `GET /api/auth/session` | 查询是否要求认证、当前是否登录 | `Cache-Control: no-store` |
| `POST /api/auth/login` | 使用共享口令创建会话 | 成功设置 HttpOnly Cookie |
| `POST /api/auth/logout` | 结束会话并清除个人设置 | 写请求保护 |
| `GET /api/provider` | 当前规划/视频来源摘要 | 登录后 |
| `GET/PUT/DELETE /api/settings/providers` | 查询、保存、清除会话 API 设置 | 认证开启且当前会话有效 |
| `POST /api/script-imports` | 导入 TXT/Markdown/DOCX | multipart 上传 |
| `GET/POST/PATCH /api/materials` | 列表、上传、重命名素材 | POST 为 multipart |
| `GET /api/jobs` | 列出共享任务 | 登录后 |
| `POST /api/jobs` | 创建脚本/分镜任务 | 返回新任务 |
| `GET /api/jobs/:id` | 查询任务 | 未找到返回 404 |
| `PATCH /api/jobs/:id/plan` | 保存分镜计划 | 仅允许合适任务状态 |
| `POST /api/jobs/:id/render` | 预检并进入渲染队列 | 设置在提交时捕获 |
| `POST /api/jobs/:id/retry` | 以当前会话设置重试 | 不能对处理中任务重复提交 |
| `GET /api/jobs/:id/revisions` | 查询修订版本 | 返回可恢复记录 |
| `POST /api/jobs/:id/retouch` | 重组、编辑或重做镜头 | 取决于模式调用供应商 |
| `POST /api/jobs/:id/revisions/:revisionId/restore` | 恢复历史版本 | 改变共享任务当前结果 |
| `POST /api/jobs/:id/feedback` | 提交评分和反馈 | 不得包含密钥/敏感信息 |

除 GET/HEAD/OPTIONS 外，浏览器客户端会发送 `X-Science-Video-Request: 1`。服务端还会在有 `Origin` 时验证协议和主机与当前请求一致；缺少保护头或跨来源会返回 403。

### 常见 HTTP 状态码

| 状态 | 常见含义 |
| --- | --- |
| 200 | 查询或修改成功 |
| 400 | 请求字段、API 设置或 URL 策略不合法 |
| 401 | 口令错误、未登录或会话过期 |
| 403 | 写请求保护头或来源校验失败 |
| 404 | 任务、素材或修订不存在 |
| 409 | 当前模式/任务状态不允许该操作，或认证未开启而请求个人设置 |
| 422 | 任务预检失败，需要修正镜头、素材或公网 URL |
| 429 | 外部供应商或服务侧限流；应用并发通常表现为排队 |
| 500 | 未处理的服务端错误；保留日志和操作时间排查 |
| 503 | readiness 失败或服务暂不可用 |

接口表用于仓库内维护和排障，不是独立的公共 API 稳定性承诺。更改接口时同步更新服务端路由、`src/client/api.ts`、共享类型、认证/写保护、测试和本章。

## 11. 测试、视觉 QA 与构建

### 测试布局

- `src/server/*.test.ts`：认证、配置、数据库、任务、材料、供应商、就绪和停机行为。
- `src/client/*.test.ts`：表单和素材绑定的纯逻辑。
- `deploy/deployment-scripts.test.ts`：部署脚本的安全拒绝条件和静态契约。
- `release/release-scripts.test.ts`：安装、配置、升级、卸载和发布流水线契约。
- `scripts/build-release.test.ts`：正式安装包白名单、版本、权限和 SHA-256 契约。
- `scripts/check-docs.mjs`：文档结构、标题、代码围栏、本地链接和正式占位内容。

`vitest.config.ts` 继承应用的 Vite 配置，并排除 `.worktrees/**`；隔离工作区可能保留其他分支的旧测试，不能把它们重复计入当前分支验证。

修改共享行为时应运行全量测试。数据库并发初始化测试会启动多个进程，不能用只跑一个函数的结果替代。

### 推荐验证顺序

```powershell
npm run docs:check
npm test
npm run qa:visual
npm run build
npm run verify
```

`npm run qa:visual` 会启动或连接本地应用并对关键界面做桌面/移动视口检查；需要安装可用 Chromium。视觉改动除自动测试外还应检查真实截图，确认三列独立滚动、窄屏重排、文本不溢出和交互控件不遮挡。

`npm run build` 先清理再生成 `dist/server` 和 `dist/client`；`npm run verify` 依次运行文档检查、Vitest 和生产构建。`dist/` 是生成物，不提交。

## 12. 发布验证、文档同步与提交规范

### 正式发布物

源码仓库不是交给普通用户安装的程序。每个正式版本由同一 Git 标签生成两类不可变交付物：

- `ghcr.io/cjllz/science-video-workbench:<版本>`：Linux/AMD64 应用容器镜像；
- `science-video-workbench-v<版本>-online-linux-amd64.tar.gz`：只包含 Compose、Caddy、配置器和运维脚本的服务器安装包，同时发布独立 `.sha256` 和 `SHA256SUMS`。

安装包通过 `scripts/build-release.mjs` 的显式白名单组装，不复制整个仓库。源码、`node_modules`、`dist`、`.git`、开发计划、数据、媒体、日志、真实环境文件和密钥都不会进入安装包。输出只写入已忽略的 `.artifacts/releases/`；脚本拒绝覆盖同名文件，避免误把旧产物当成本次发布。

标签推送触发 `.github/workflows/release.yml`。流水线要求 `vMAJOR.MINOR.PATCH` 标签与 `package.json` 版本完全一致，依次执行 `npm ci`、`npm run verify`、`npm audit --omit=dev`，然后构建并推送 Linux/AMD64 镜像，最后创建 GitHub Release 并上传安装包和校验文件。任一步失败都不会创建完整正式版本。

发布新版本时：

1. 按语义化版本更新 `package.json` 和 `package-lock.json`。
2. 在 [版本记录](../CHANGELOG.md) 顶部增加日期、用户变化、配置/数据兼容性和升级注意事项。
3. 同步安装包默认版本、示例命令和三份正式手册。
4. 本地执行下面的完整验证和安装包内容检查。
5. 合并到 `main` 后创建带签名或受保护的 `v<版本>` 标签并推送。
6. 等待 GitHub Actions 成功，检查 Release 附件、SHA-256 和 GHCR 镜像，再在真实 Linux 服务器执行部署手册第 6 章。

开发机：

```powershell
npm run docs:check
npm test
npm run build
npm audit --omit=dev
npm run release:package
git diff --check
```

Linux 发布主机还必须执行：

```bash
bash -n deploy/entrypoint.sh deploy/lib.sh deploy/backup.sh deploy/restore.sh
docker compose --env-file deploy/.env.production config --quiet
docker compose --env-file deploy/.env.production build --pull
docker compose --env-file deploy/.env.production up -d
docker compose --env-file deploy/.env.production ps
```

开发机测试不能替代真实镜像、容器安全属性、Caddy 证书、局域网客户端、数据持久化和备份恢复回环验收。

### 文档同步

- 用户操作、字段、提示或错误处理变化：更新 [详细使用说明](USER-GUIDE.md)。
- 模块、数据、接口、测试或配置契约变化：更新本开发文档。
- 环境变量、Compose、证书、备份、恢复或运维变化：更新 [部署运维手册](DEPLOYMENT.md)。
- `README.md` 只保留简介、边界、快速入口和三份手册索引。

### 提交与仓库整洁

文档、测试和业务代码应按职责提交。不要把个人 `.env`、`deploy/.env.production`、数据目录、输出、日志、证书私钥或真实 API 密钥加入 Git。提交前使用 `git status --short` 和 `git diff --check` 检查范围。

提交前执行：

```powershell
git status --short
git diff --check
git ls-files -ci --exclude-standard
```

不得提交 `dist/`、`.artifacts/`、`data/`、`node_modules/`、覆盖率、临时迁移脚本、日志、数据库、媒体输出、截图、真实 `.env`、证书私钥或供应商密钥。需要提交的示例文件只能包含明确的非真实值。生产依赖还应执行 `npm audit --omit=dev`，并在目标 Linux 主机完成真实镜像、HTTPS、持久化和备份恢复验收。
