# 科普视频工作台完整项目手册

本文档是科普视频工作台当前版本的唯一正式说明，面向普通用户、局域网服务器管理员和开发维护者。除仓库根目录的项目首页外，部署、运维和使用步骤以本文档为准；`docs/internal/` 中的规格和计划仅用于历史追溯。

本文中的 `<局域网主机名>`、`<服务器地址>`、`<仓库地址>`、`<备份文件>` 等尖括号内容必须替换成现场值。不要原样执行仍含尖括号的命令。命令块会注明 Windows PowerShell 或 Linux Bash；没有注明时，默认在目标 Linux 服务器的项目目录执行。

## 目录

- [1. 文档说明与阅读路线](#1-文档说明与阅读路线)
- [2. 项目能力、限制与支持范围](#2-项目能力限制与支持范围)
- [3. 系统架构、网络边界与目录](#3-系统架构网络边界与目录)
- [4. 五分钟本地体验](#4-五分钟本地体验)
- [5. 普通用户完整操作](#5-普通用户完整操作)
- [6. 个人 API 设置](#6-个人-api-设置)
- [7. 正式部署前决策与检查](#7-正式部署前决策与检查)
- [8. Linux、Docker、网络和目录准备](#8-linuxdocker网络和目录准备)
- [9. 生产环境变量](#9-生产环境变量)
- [10. Docker Compose 首次部署](#10-docker-compose-首次部署)
- [11. Caddy 内部 CA 与客户端信任](#11-caddy-内部-ca-与客户端信任)
- [12. 首次上线验收](#12-首次上线验收)
- [13. 登录与日常运维](#13-登录与日常运维)
- [14. 数据、备份与恢复](#14-数据备份与恢复)
- [15. 升级与回滚](#15-升级与回滚)
- [16. 故障排查](#16-故障排查)
- [17. 安全边界、发布检查与卸载](#17-安全边界发布检查与卸载)
- [18. 本地开发与发布维护](#18-本地开发与发布维护)
- [19. 配置、端口、路径、命令与接口速查](#19-配置端口路径命令与接口速查)
- [20. 运维、变更与故障记录模板](#20-运维变更与故障记录模板)
- [21. 术语表与常见问题](#21-术语表与常见问题)

## 1. 文档说明与阅读路线

### 普通用户路线

普通用户建议按以下顺序阅读：

1. [第 5 章](#5-普通用户完整操作)：登录、输入主题、导入脚本、上传素材、编辑分镜、生成和返修。
2. [第 6 章](#6-个人-api-设置)：为当前浏览器会话填写自己的脚本或视频 API。
3. [第 16 章](#16-故障排查)：遇到登录、生成、素材或外部 API 问题时按现象定位。

普通用户不需要执行 Docker、证书、备份或恢复命令。界面提示“任务正在处理”时不要反复提交；先查看进度或联系管理员检查日志。

### 服务器管理员路线

服务器管理员建议按以下顺序阅读：

1. [第 2 章](#2-项目能力限制与支持范围)和[第 3 章](#3-系统架构网络边界与目录)：确认本项目适合现场环境。
2. [第 7-11 章](#7-正式部署前决策与检查)：准备服务器、配置生产变量、启动 Compose、分发内部 CA。
3. [第 12 章](#12-首次上线验收)：使用真实客户端完成发布验收。
4. [第 13-17 章](#13-登录与日常运维)：日常运维、备份恢复、升级回滚、排障和安全检查。

正式部署命令默认项目位于 `/srv/science-video-workbench/app`，数据位于 `/srv/science-video-workbench/data`，备份位于 `/srv/science-video-workbench/backups`。现场使用其他路径时必须在环境文件和命令中保持一致。

### 开发维护者路线

开发维护者先阅读[第 4 章](#4-五分钟本地体验)和[第 18 章](#18-本地开发与发布维护)，再使用[第 19 章](#19-配置端口路径命令与接口速查)核对配置和接口。任何改变部署命令、环境变量、端口、数据目录或用户流程的代码提交，都必须同步更新本文档并执行 `npm run verify`。

### 操作说明格式

关键操作按以下顺序说明：

1. **适用场景**：什么时候执行。
2. **前置条件**：执行前必须满足什么。
3. **操作步骤**：在哪台机器、哪个目录、以什么账号执行。
4. **预期结果**：成功后应该看到什么。
5. **验证方法**：如何独立确认成功。
6. **失败处理**：失败时先检查什么。
7. **安全提醒**：会不会影响数据、服务或密钥。

带有“停止服务”“恢复”“回滚”“卸载”的命令会改变运行状态。执行前必须确认目标主机、项目目录、数据目录、备份哈希和当前任务是否空闲。

## 2. 项目能力、限制与支持范围

### 2.1 能做什么

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

### 2.2 正式支持的部署

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

### 2.3 明确不支持

以下场景不在当前正式支持范围内：

- 直接暴露到公网或通过路由器做端口转发。
- 多应用副本、负载均衡或 Kubernetes。
- 多台服务器共享同一 SQLite 文件。
- 把应用的 8787 HTTP 端口直接开放给局域网用户。
- 不中断写入的数据库备份、恢复或版本升级。
- 自动把 Caddy 根私钥分发给客户端。
- 企业级单点登录、细粒度账号权限和集中密钥托管。

需要公网、多节点或企业身份系统时，应先更换数据库、会话、对象存储和密钥管理架构，不能直接扩大当前 Compose 拓扑。

### 2.4 外部服务与本地回退

没有外部 API 时，系统仍可使用本地模板、动画信息卡、数据图表、旁白和字幕完成基础视频。外部脚本 API 决定脚本规划质量，Ark Seedance 决定真实 AI 镜头生成能力。

图片或视频使用“原样叠加”时由本机 ffmpeg 合成，不需要供应商访问素材。AI reference、首帧、尾帧或编辑已有镜头需要外部供应商读取素材/输出 URL，因此必须配置供应商可访问的公网 HTTPS 来源。局域网地址、`.local` 名称和内部 CA 通常无法被外部供应商访问。

### 2.5 内容责任

系统不会替代事实核验、医学审核、版权审核或发布审批。医疗和健康内容必须引用权威来源，由具备相应知识或资质的人员复核；上传素材、音乐、图片和生成结果的使用权由发布者负责。

## 3. 系统架构、网络边界与目录

### 3.1 生产数据流

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

### 3.2 信任边界

- **客户端与 Caddy**：客户端必须信任管理员核对过指纹的 Caddy 根证书。
- **Caddy 与应用**：只通过 Compose 私有网络通信，不发布应用端口。
- **应用与数据目录**：容器以 UID/GID 10001 写入唯一 bind mount；根文件系统只读。
- **应用与外部 API**：服务器携带管理员或当前会话的密钥发起出站请求。
- **管理员与备份**：备份/恢复脚本以受控权限运行，验证路径、哨兵、挂载、所有权和归档哈希。

### 3.3 仓库目录

| 路径 | 用途 | 是否运行时数据 |
| --- | --- | --- |
| `src/client/` | React 用户界面 | 否 |
| `src/server/` | Express API、任务、数据库、渲染和维护逻辑 | 否 |
| `src/shared/` | 前后端共享类型 | 否 |
| `deploy/` | Caddy、环境模板、入口、备份和恢复脚本 | 否 |
| `scripts/` | 开发和质量检查脚本 | 否 |
| `docs/PROJECT-MANUAL.md` | 当前完整项目手册 | 否 |
| `docs/internal/` | 历史规格和实施计划 | 否 |
| `dist/` | 本地生产构建产物，可重新生成 | 否 |
| `data/` | 本地开发数据，生产中由 `DATA_DIR` 挂载 | 是 |

### 3.4 生产宿主机目录

推荐布局：

```text
/srv/science-video-workbench/
├── app/          # Git 工作树、Compose 和部署脚本
├── data/         # SQLite、素材、输出和修订
└── backups/      # 本机轮换备份
```

`data` 与 `backups` 必须是不同目录，备份目录不能嵌套在数据目录中。正式环境还应把经过校验的备份镜像到另一块物理介质、NAS 或受控备份系统。

### 3.5 数据一致性

SQLite 使用单进程访问。应用启动会以幂等方式初始化表，并为并发初始化锁提供有限重试；这不意味着可以运行多个应用副本。备份脚本会检查任务空闲、停止应用、归档数据、生成 SHA-256 和清单，再重启应用。恢复脚本会先验证归档、创建安全备份、只读验证候选数据，并在启动失败时尝试回退。

## 4. 五分钟本地体验

### 4.1 适用场景

本节用于开发、演示和验证界面，不是局域网正式部署。默认服务只监听回环地址，不要求 `LAN_ACCESS_TOKEN`，个人 API 设置不可用。

### 4.2 前置条件

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

### 4.3 安装并启动

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

### 4.4 停止与重新启动

在运行 `npm run dev` 的终端按 `Ctrl+C`。开发进程由 `concurrently` 管理，任一子进程退出时会停止另一进程。再次执行 `npm run dev` 即可启动；本地 `data/` 中的任务不会因正常重启自动删除。

### 4.5 本地生产模式

```powershell
npm run build
npm start
```

预期 `dist/server` 和 `dist/client` 生成，服务在 `http://127.0.0.1:8787` 提供 API 和构建后的前端。修改源码后必须重新构建。

### 4.6 常见启动问题

| 现象 | 检查 | 处理 |
| --- | --- | --- |
| `EBADENGINE` | `node --version` | 升级到 Node 22.12+ 后重新安装依赖 |
| 5173 或 8787 被占用 | 查找占用端口的进程 | 停止旧开发进程，不要同时启动两套写同一数据目录的服务 |
| TTS 导入失败 | `python -c "import edge_tts"` | 重新执行 `npm run setup:tts`，核对 Python/pip 环境 |
| ffmpeg 不可用 | 查看 `/api/ready` 的失败组件 | 允许 `ffmpeg-static` 安装，或通过绝对路径设置 `FFMPEG_PATH` |
| 页面能开但 API 失败 | 查看 dev:server 终端 | 确认 8787 服务运行，Vite 代理配置未被改动 |

不要用 `HOST=0.0.0.0 npm start` 临时替代正式部署。非回环监听会强制要求至少 16 字符的 `LAN_ACCESS_TOKEN`，但裸 HTTP 仍不能保护登录口令、会话 Cookie 和个人密钥。

## 5. 普通用户完整操作

### 5.1 登录和退出

正式环境打开管理员提供的 `https://<局域网主机名>`。第一次使用必须先完成根证书信任；浏览器仍显示证书警告时不要输入访问口令或 API 密钥。

输入管理员提供的局域网访问口令。成功后进入工作台；失败时先确认大小写和当前网址，不要连续高频尝试。右上角退出按钮会结束当前会话并清除该会话的个人 API 设置。

同一台电脑的不同浏览器配置文件或无痕窗口会创建不同会话。任务列表属于共享工作台数据，但个人 API 密钥不会跨会话显示或复用。

### 5.2 定义视频

在“定义视频”区域填写：

- **主题**：视频要解释的核心问题。
- **关键词**：必须覆盖的概念或术语。
- **受众**：例如中学生、普通公众、专业培训。
- **时长**：目标上限，最终镜头总时长应保持在该范围内。
- **风格**：影响结构和视觉提示。
- **生成方式**：混合生成只调用部分 AI 镜头；全 AI 镜头会对普通分镜调用视频供应商。
- **脚本模式**：AI 辅助生成或使用自己提供的脚本。

描述越具体，脚本越稳定。医学主题应在输入中明确人群、适用条件、不确定性和来源要求，不要只写宽泛标题。

### 5.3 导入现有脚本

选择使用自带脚本后，可粘贴文本或导入 TXT、Markdown、DOCX。导入后先检查标题、段落、数字、单位和特殊字符；DOCX 的复杂布局不会作为排版保留，系统提取的是可用于分镜的正文。

导入失败时检查文件扩展名、文件是否损坏、是否受密码保护。不要上传包含无关个人信息、未获授权素材或 API 密钥的文档。

### 5.4 上传数据素材

起始表单可上传 CSV 或 XLSX，系统会解析列名和行数，并在规划阶段插入适合的数据图表镜头。每条视频最多使用 3 份数据素材。

上传后应确认：

- 列名清晰且不重复。
- 数字列没有混入单位文字；单位可放在列名。
- 日期格式一致。
- 工作表没有大面积空行、合并单元格或隐藏说明区。
- 图表展示不会泄露个人或敏感数据。

### 5.5 生成剧本和进入分镜

点击“生成剧本”后，系统先规划脚本和分镜，并停在“自动分镜”界面。此时尚未开始最终视频渲染，也不会立即消耗所有视频生成额度。

成功标志：右侧出现镜头列表，顶部显示镜头数量、目标时长和脚本来源。若显示本地脚本，说明没有可用的外部脚本 API 或调用失败后使用了本地回退。

### 5.6 编辑分镜

逐镜检查并修改：

- 镜头顺序和时长。
- 旁白是否能在该时长内自然读完。
- 屏幕标题和字幕是否简洁。
- 视觉方向是否准确描述人物、动作、场景、镜头和图表。
- 所有数字、单位和因果关系是否与来源一致。
- 相邻镜头是否连续，是否存在重复信息。

修改后先保存。不要把 API 密钥、内部地址或个人信息写入旁白和视觉提示。

### 5.7 素材变量

素材库支持图片、视频、音频、CSV 和 XLSX。上传后每项素材有一个可编辑变量名，例如 `@肺部结构`。变量名用于在视觉方向和镜头绑定中引用；重命名后应检查已有镜头引用是否同步。

镜头绑定包括素材用途、模式、位置、开始时间和结束时间。开始/结束值相对于当前镜头，必须位于 0 到镜头时长之间。

| 模式 | 处理位置 | 是否需要外部可访问 URL | 适用情况 |
| --- | --- | --- | --- |
| 原样叠加 | 本机 ffmpeg | 否 | Logo、截图、精确图片/视频，不允许模型改画 |
| AI reference | 视频供应商 | 是 | 让模型参考主体、风格或内容 |
| 首帧 | 视频供应商 | 是 | 用素材作为生成片段起始画面 |
| 尾帧 | 视频供应商 | 是 | 用素材约束生成片段结束画面 |
| 数据图表 | 本机渲染 | 否 | CSV/XLSX 的列和数值 |

`MATERIAL_PUBLIC_BASE_URL` 未配置时，图片/视频仍可原样叠加，但预检会阻止 AI reference、首帧或尾帧。不要为了绕过预检而填写局域网 HTTP 地址；外部供应商通常无法访问。

### 5.8 确认并生成

点击“确认并生成视频”前执行人工检查：

1. 分镜总时长合理。
2. 旁白和字幕经过事实审核。
3. 素材变量均存在，时间范围有效。
4. AI reference 所需公网 HTTPS 地址已准备。
5. 当前供应商、模型和预计 AI 镜头数符合成本预期。

系统先运行预检，只有预检通过才进入队列。`MAX_CONCURRENT_RENDERS` 控制同时处理的渲染/返修数量，其他任务会排队；排队不是故障。

### 5.9 查看进度和结果

处理中界面显示总体进度。完成后检查：

- MP4 能正常播放和下载。
- 旁白、字幕和镜头同步。
- 图表列、单位、范围和标签正确。
- 原样叠加素材没有被裁切到不可读。
- AI 镜头没有事实性误画、人物异常或不合适内容。

失败页面会显示错误并提供重新提交。重试前先修复明确原因；外部 API 认证失败、额度不足或素材 URL 不可访问时，连续重试不会解决问题。

### 5.10 完成后的返修

返修工作区把每个镜头视为连续时间段：

| 操作 | 是否调用 Seedance | 行为 |
| --- | --- | --- |
| 应用并重新合成（Recompose） | 否 | 保留已有镜头，重新应用旁白、字幕、图表和原样叠加 |
| 编辑已有镜头（Edit existing shot） | 是 | 把当前供应商视频作为参考视频，并带上 AI reference 素材 |
| 重新生成镜头（Regenerate shot） | 是 | 不使用原视频，重新生成所选镜头 |

只修改旁白、字幕、图表、叠加位置或相对时间时优先使用重新合成。改变人物、动作或场景构图时才需要编辑/重做镜头。

供应商结果 URL 只在有限时间内有效。需要长期编辑已有镜头时，应配置公开 HTTPS 的 `OUTPUT_PUBLIC_BASE_URL`，使供应商能访问 `/outputs/...`。没有可访问原镜头时，界面会要求完全重做。

### 5.11 历史版本恢复

返修前，系统会归档原 MP4、字幕、海报、计划和供应商片段。历史版本条显示最近修订，点击恢复会把共享任务恢复到所选版本。

恢复会改变所有用户看到的当前任务结果。执行前确认没有其他人正在查看或修改该任务，并记录要恢复的版本。恢复失败时不要手工删除输出目录，联系管理员保留日志和数据现场。

### 5.12 反馈和经验沉淀

完成视频可以提交评分和文字反馈。被接受、评分较高的结果会作为相似主题的结构示例。反馈中不要粘贴密钥、访问口令或敏感数据。

## 6. 个人 API 设置

### 6.1 适用范围

个人 API 设置只在启用了 `LAN_ACCESS_TOKEN` 的正式登录会话中出现。本机未启用认证的开发模式只能使用管理员环境变量或本地回退。

右上角打开“API 设置”，可以分别选择：

- **脚本 API**：服务器默认、DeepSeek、OpenAI 兼容或火山方舟。
- **视频 API**：服务器默认或 Ark Seedance。

服务器默认表示使用管理员配置；如果管理员也未配置，脚本或视频流程按当前实现使用本地回退。通用 `VIDEO_PROVIDER_URL` HTTP 适配器只能由管理员配置，不会出现在个人选项中。

### 6.2 密钥生命周期

个人密钥只保存在服务端当前进程的会话内存中：

- 不写入浏览器 localStorage/sessionStorage。
- 不写入 SQLite、任务、事件、上传文件或生成结果。
- API 响应不返回已保存密钥。
- 保存后重新打开对话框，密钥输入框为空，但会显示“已保存”；这是正常状态。
- 在同一服务商下把密钥框留空并保存，表示保持现有密钥。
- 第一次配置或切换服务商时必须输入新密钥。
- 退出登录、会话过期或服务器进程重启时自动清除。
- 点击“清除个人设置”并二次确认后，立即回到服务器默认或本地模式。

### 6.3 任务使用哪套设置

规划、渲染、重试或返修命令在提交时捕获当时的有效设置。之后修改或清除设置，不会改变已经排队或运行的任务。对共享任务点击重试时，使用发起重试的当前浏览器会话设置，而不是原任务创建者的旧密钥。

这意味着多人协作时应在任务记录中说明由谁发起了需要计费的生成/重试，但不能记录真实密钥。

### 6.4 脚本 API 示例

以下密钥是明确的虚构值，不能照抄：`example-not-a-real-key`。

DeepSeek：

| 字段 | 示例 |
| --- | --- |
| 服务商 | DeepSeek |
| API Key | `example-not-a-real-key` |
| 模型 | `deepseek-chat` |
| Base URL | `https://api.deepseek.com/v1` |

OpenAI 兼容：

| 字段 | 示例 |
| --- | --- |
| 服务商 | OpenAI 兼容 |
| API Key | `example-not-a-real-key` |
| 模型 | 管理员或供应商确认的模型 ID |
| Base URL | `https://api.openai.com/v1` 或管理员允许的兼容域名 |

火山方舟脚本：

| 字段 | 示例 |
| --- | --- |
| 服务商 | 火山方舟 |
| API Key | `example-not-a-real-key` |
| 模型 | `doubao-seed-2-1-pro-260628` |

### 6.5 Ark Seedance 视频示例

| 字段 | 示例 |
| --- | --- |
| 服务商 | Ark Seedance |
| API Key | `example-not-a-real-key` |
| 模型 | `doubao-seedance-2-0-mini-260615` |
| AI 生成镜头数 | 1 到 6；默认 3 |

“混合生成”使用设置的 AI 镜头数量，其余镜头由本地动画/图表完成；“全 AI 镜头”会按实际普通镜头生成，使用前确认供应商额度和计费。

### 6.6 自定义 Base URL 安全规则

个人 OpenAI/DeepSeek Base URL 必须：

- 使用 `https://`。
- 不包含用户名、密码或自定义端口。
- 使用管理员允许的完整 DNS 主机名。
- 不能是 IP、`localhost`、`.localhost` 或 `.local`。
- DNS 解析结果必须全部是公网地址，不能指向回环、私网、链路本地、文档保留或组播地址。
- 请求不跟随 HTTP 重定向，避免密钥被带到另一个主机。

默认允许 `api.openai.com` 和 `api.deepseek.com`。其他兼容域名必须由管理员加入 `PERSONAL_API_ALLOWED_HOSTS`，使用逗号分隔的精确主机名；不要加入通配符或用户可控制的域名。

### 6.7 保存与验证

1. 选择脚本和视频服务商。
2. 第一次配置时输入真实密钥，核对模型和 Base URL。
3. 点击“保存”。
4. 重新打开对话框，确认来源显示“个人会话”和“已保存”，密钥框应为空。
5. 先创建一个短小、低成本的测试任务。
6. 检查任务使用的规划/视频来源和供应商账单。
7. 测试完成后，如不再使用，点击“清除个人设置”并退出登录。

### 6.8 常见错误

| 状态/现象 | 含义 | 处理 |
| --- | --- | --- |
| 400，设置格式不正确 | 字段缺失、模型为空、密钥过短、镜头数不在 1-6 | 按字段提示修正；切换服务商时输入新密钥 |
| 400，地址必须使用允许的公网 HTTPS 域名 | Base URL 协议、主机、端口、DNS 或 allowlist 不符合策略 | 使用官方端点，或让管理员核对 `PERSONAL_API_ALLOWED_HOSTS` |
| 401，登录已过期 | Cookie 会话不存在或过期 | 重新登录并重新填写个人设置；旧密钥不会恢复 |
| 403 | 请求来源或写请求保护校验失败 | 通过正式 HTTPS 页面操作，不要从其他站点或手写跨站请求调用 |
| 409，需要启用局域网访问口令 | 当前服务未启用认证 | 本地模式使用管理员环境变量；正式环境配置 `LAN_ACCESS_TOKEN` |
| 422，任务预检失败 | 素材、时长、URL 或供应商能力不满足任务 | 按预检条目修正镜头和素材，不要盲目重试 |
| 上游 401/403 | API Key 无效、权限或模型未开通 | 到供应商后台验证密钥、项目和模型权限 |
| 上游 429 | 额度、速率或并发限制 | 等待、降低并发/AI 镜头数，核对供应商配额 |
| 上游超时 | 出站 DNS、网络、防火墙或供应商故障 | 管理员从容器内检查目标地址和供应商状态 |

日志和错误响应应经过脱敏，但管理员仍不应把完整请求体、环境文件或密钥粘贴到工单和聊天中。

## 7. 正式部署前决策与检查

正式支持的拓扑是：

- 一台 Linux 服务器；
- Docker Engine 和 Docker Compose v2；
- 一个应用容器；
- 一个 Caddy 容器；
- 一份本机 SQLite 数据库；
- 一个宿主机持久化数据目录；
- 局域网客户端通过 Caddy 的内部 CA 使用 HTTPS；
- 同一时刻只运行一个应用实例。

本部署不支持：

- 公网直接暴露；
- 路由器端口转发；
- 多副本或负载均衡；
- 多台应用服务器共享同一个 SQLite 文件；
- Kubernetes；
- 无停机备份或升级；
- 自动把 Caddy 私钥分发到客户端。

系统架构：

```text
可信局域网客户端
        |
        | HTTPS 443
        v
Caddy 内部 CA + 反向代理
        |
        | Compose 私有网络 app:8787
        v
单个 Node.js 应用容器
        |
        v
/srv/science-video-workbench/data
        |
        +-- 本机轮换备份
        +-- 可选 NAS / 移动硬盘镜像
```

应用的 8787 端口不会发布到宿主机。宿主机只发布 Caddy 的 80 和 443 端口。Compose 网络仍允许应用主动访问外部 API。

### 推荐资源

最低起点：

- 4 个 CPU 核心；
- 8 GiB 内存；
- 100 GiB 可用磁盘；
- 千兆局域网；
- Ubuntu 24.04 LTS、Debian 12 或更新的受支持稳定版本。

建议配置：8 个 CPU 核心、16 GiB 内存和独立 SSD。视频、历史修订和上传素材会持续增长，100 GiB 不是容量上限。生产服务器应监控磁盘空间。

### 检查 CPU 架构

工作目录：任意目录。

```bash
uname -m
```

预期结果：

- `x86_64`：AMD64，可部署；
- `aarch64` 或 `arm64`：ARM64，可部署，但必须完成[第 12 章](#12-首次上线验收)中的实际视频验收；
- 其他值：当前不作为正式支持目标。

失败处理：如果命令不可用或架构不在列表中，先停止部署。不要用未知架构直接承载生产数据。

### 稳定局域网地址

为服务器配置固定 IP 或 DHCP 保留地址，并准备一个稳定的局域网 DNS 名称，例如 `science-video.lan`。如果没有内部 DNS，也可以把 `LAN_HOST` 设置为固定 IP，但 DNS 名称更便于后续迁移。

禁止在路由器上把 80、443 或 8787 转发到公网。

### 检查时间与磁盘

工作目录：任意目录。

```bash
timedatectl status
df -h /srv
```

预期结果：系统时间同步为 `yes`，并且 `/srv` 所在分区有足够空间。

失败处理：先修复 NTP；磁盘不足时先扩容或换盘。证书验证、任务时间和备份保留都依赖正确时间。

## 8. Linux、Docker、网络和目录准备

从 Docker 官方文档选择当前 Ubuntu/Debian 的 apt 仓库安装步骤：<https://docs.docker.com/engine/install/>。不要执行来源不明的 `curl ... | sh` 命令。

安装完成后，工作目录为任意目录：

```bash
docker version
docker compose version
sudo systemctl is-enabled docker
sudo systemctl is-active docker
```

预期结果：

- 客户端和服务端都能显示版本；
- Compose 显示 `Docker Compose version v2...`；
- Docker 服务为 `enabled` 和 `active`。

失败处理：

- 只有客户端版本、没有服务端版本：检查 `sudo systemctl status docker`；
- `docker compose` 不存在：安装 Compose v2 插件，不要使用旧的 `docker-compose` Python 工具；
- 权限不足：管理员可以使用 `sudo docker ...`，或按组织规范把受信任运维账号加入 `docker` 组。`docker` 组等同于高权限账号。

推荐布局：

```text
/srv/science-video-workbench/
├── app/          # Git 工作树和 compose.yaml
├── data/         # SQLite、素材、输出和修订
└── backups/      # 本机备份
```

创建目录。工作目录：任意目录。

```bash
sudo install -d -m 0755 /srv/science-video-workbench
sudo install -d -m 0755 /srv/science-video-workbench/app
sudo install -d -m 0750 -o 10001 -g 10001 /srv/science-video-workbench/data
sudo install -d -m 0750 /srv/science-video-workbench/backups
printf 'science-video-workbench-data-v1\n' | \
  sudo tee /srv/science-video-workbench/data/.science-video-workbench-data >/dev/null
sudo chown 10001:10001 \
  /srv/science-video-workbench/data/.science-video-workbench-data
```

预期结果：`data` 的 UID/GID 为 `10001:10001`。

```bash
stat -c '%u:%g %a %n' /srv/science-video-workbench/data
```

失败处理：如果不是 `10001:10001`，执行：

```bash
sudo chown -R 10001:10001 /srv/science-video-workbench/data
sudo chmod 0750 /srv/science-video-workbench/data
```

将代码检出到 `app`。工作目录：`/srv/science-video-workbench`。

```bash
git clone <仓库地址> app
cd app
git status --short --branch
```

预期结果：位于计划发布的分支或标签，工作树没有未提交文件。

失败处理：如果服务器不允许直接访问 Git，可以通过组织批准的软件分发流程把完整发布包传到 `app`，但必须同时保留提交号或发布版本记录。

先确认局域网网段，例如 `192.168.10.0/24`，以及服务器固定地址。不要照抄示例网段。Compose 会把 Caddy 端口只绑定到 `LAN_BIND_ADDRESS`，防火墙是第二层限制。

### UFW

工作目录：任意目录。

```bash
sudo ufw allow OpenSSH
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow from <局域网网段> to any port 80 proto tcp
sudo ufw allow from <局域网网段> to any port 443 proto tcp
sudo ufw status numbered
sudo ufw enable
sudo ufw status verbose
```

执行 `ufw enable` 前必须先确认真实 SSH 端口已被允许；如果不是默认 SSH 端口，应先添加对应规则，避免锁死远程会话。检查并删除任何已有的全网 80/443 allow 规则。预期结果是默认拒绝入站，80/443 只允许指定局域网网段。不要开放 8787。

### firewalld

```bash
sudo firewall-cmd --get-active-zones
sudo firewall-cmd --permanent --remove-service=http || true
sudo firewall-cmd --permanent --remove-service=https || true
sudo firewall-cmd --permanent --remove-port=80/tcp || true
sudo firewall-cmd --permanent --remove-port=443/tcp || true
sudo firewall-cmd --permanent --add-rich-rule='rule family="ipv4" source address="<局域网网段>" port protocol="tcp" port="80" accept'
sudo firewall-cmd --permanent --add-rich-rule='rule family="ipv4" source address="<局域网网段>" port protocol="tcp" port="443" accept'
sudo firewall-cmd --reload
sudo firewall-cmd --list-all
```

预期结果：活动 zone 中没有面向所有来源的 `http`、`https`、`80/tcp` 或 `443/tcp` 服务/端口，只保留来源受限的 rich rule。失败处理：如果服务器有多网卡、VPN 或多个 VLAN，逐个明确允许来源，不要临时改成全网开放。

### 验证没有发布应用端口

工作目录：`/srv/science-video-workbench/app`。

```bash
docker compose --env-file deploy/.env.production ps
sudo ss -lntp | grep -E ':(80|443|8787)\b'
```

预期结果：宿主机只在 `LAN_BIND_ADDRESS` 上监听 80/443，不监听 8787，也不在公网或 VPN 网卡上监听 80/443。

## 9. 生产环境变量

工作目录：`/srv/science-video-workbench/app`。

```bash
cp deploy/.env.production.example deploy/.env.production
chmod 0600 deploy/.env.production
openssl rand -base64 32
```

把最后一条命令生成的随机值写入 `LAN_ACCESS_TOKEN`，然后编辑配置：

```bash
nano deploy/.env.production
```

不要把 `deploy/.env.production` 提交到 Git、聊天、工单或日志。该文件已经被 `.gitignore` 排除。

### 必填变量

| 变量 | 生产建议 | 说明 |
| --- | --- | --- |
| `APP_IMAGE` | `science-video-workbench` | 本地镜像名 |
| `APP_VERSION` | 发布标签或短提交号 | 镜像标签和备份清单版本 |
| `LAN_HOST` | `science-video.lan` | Caddy 证书中的局域网 DNS 名或固定 IP |
| `LAN_BIND_ADDRESS` | 服务器固定局域网 IP | Caddy 只绑定该宿主机网卡；不能填不存在的地址 |
| `HTTP_PORT` | `80` | 仅用于 HTTP 到 HTTPS 跳转 |
| `HTTPS_PORT` | `443` | 用户访问端口 |
| `DATA_DIR` | `/srv/science-video-workbench/data` | 必须是绝对路径，容器内映射到 `/app/data` |
| `BACKUP_DIR` | `/srv/science-video-workbench/backups` | 必须是绝对路径，不能位于 `DATA_DIR` 内 |
| `BACKUP_RETENTION_DAYS` | `14` 或更长 | 本地完整备份保留天数，范围 1 到 3650 |
| `LAN_ACCESS_TOKEN` | 32 字节随机值 | 局域网共享访问口令，至少 16 个字符 |
| `TRUST_PROXY` | `1` | 只信任前方一个 Caddy 代理，不要改成其他值 |
| `MAX_CONCURRENT_RENDERS` | `1` | 支持 1 到 8；先从 1 开始，根据 CPU、内存和 API 配额调高 |

`LAN_ACCESS_TOKEN` 用于登录，不是第三方 API 密钥。登录成功后浏览器获得 12 小时有效的 HttpOnly Cookie。HTTPS 下 Cookie 带 `Secure` 属性。

### 备份镜像变量

| 变量 | 说明 |
| --- | --- |
| `BACKUP_MIRROR_DIR` | 可选的 NAS、第二块磁盘或移动介质挂载点；留空表示不镜像 |

同一磁盘上的 `BACKUP_DIR` 只能防误删和应用损坏，不能防硬盘损坏。正式使用应配置第二份物理独立副本。

### 管理员级 API 回退配置

所有 API 变量都可留空。留空时用户仍可在登录后的“API 设置”中提交个人密钥；个人密钥只保存在当前应用进程内存中，不写入浏览器存储、SQLite、任务记录或文件，并在退出、会话过期或服务器重启时清除。

| 变量 | 用途 | 注意事项 |
| --- | --- | --- |
| `OPENAI_API_KEY` | OpenAI 兼容脚本规划 | 还需要 `OPENAI_MODEL` 才会启用 |
| `OPENAI_BASE_URL` | OpenAI 兼容基地址 | 必须是 HTTP(S)，默认 `https://api.openai.com/v1` |
| `OPENAI_MODEL` | 规划模型名 | 留空时不会启用 OpenAI 管理员回退 |
| `DEEPSEEK_API_KEY` | DeepSeek 兼容脚本规划 | 配置后优先于 Ark 文本规划 |
| `DEEPSEEK_BASE_URL` | DeepSeek 基地址 | 必须是 HTTP(S) |
| `DEEPSEEK_MODEL` | DeepSeek 模型名 | 示例为 `deepseek-chat` |
| `ARK_API_KEY` | Ark 文本和视频生成 | 可以只让用户在会话中提供，不必写服务器配置 |
| `ARK_TEXT_MODEL` | Ark 文本规划模型 | 仅在 Ark 管理员回退启用时使用 |
| `ARK_VIDEO_MODEL` | Ark Seedance 视频模型 | 发布前核对供应商账号可访问该模型 |
| `ARK_MAX_GENERATED_SHOTS` | 单任务最多生成镜头数 | 默认 3，增加会提高时间和费用 |
| `VIDEO_PROVIDER_URL` | 管理员维护的通用视频适配器 | 用户不能在个人设置中覆盖 |
| `VIDEO_PROVIDER_API_KEY` | 通用视频适配器密钥 | 可留空 |
| `PERSONAL_API_ALLOWED_HOSTS` | 额外个人兼容 API 域名 | 逗号分隔的精确 DNS 主机名；默认已允许 OpenAI 和 DeepSeek 官方域名 |

没有外部规划或视频配置时，系统使用本地规划和动画信息卡，并仍可生成本地视频。

### 对外素材地址

| 变量 | 用途 |
| --- | --- |
| `MATERIAL_PUBLIC_BASE_URL` | 外部视频供应商拉取 `/materials/...` 的公开 HTTPS 根地址 |
| `OUTPUT_PUBLIC_BASE_URL` | 外部供应商编辑旧镜头时拉取 `/outputs/...` 的公开 HTTPS 根地址 |

局域网地址、`localhost`、`192.168.x.x`、`10.x.x.x` 和 `172.16/12` 通常无法被外部供应商访问。只有“AI reference / 首帧 / 尾帧 / 编辑既有供应商镜头”需要公开地址。本地精确叠加和 CSV/XLSX 图表不需要公开地址。

不要为了这两个变量把整个工作台直接暴露到公网。应使用受控对象存储或只暴露必要素材路径的独立 HTTPS 服务。

### 检查配置文件

工作目录：`/srv/science-video-workbench/app`。

```bash
stat -c '%a %n' deploy/.env.production
docker compose --env-file deploy/.env.production config --quiet
```

预期结果：权限为 `600`，Compose 配置命令无输出且退出码为 0。

失败处理：

- 提示 `LAN_ACCESS_TOKEN must be set`：补充访问口令；
- 提示 `DATA_DIR must be set`：填写绝对路径；
- YAML 或变量替换错误：从示例文件重新逐项合并，不要在等号两侧加空格；
- 值包含空格或特殊字符：用单引号包围，并再次运行 `config --quiet`。

## 10. Docker Compose 首次部署

工作目录：`/srv/science-video-workbench/app`。

```bash
docker compose --env-file deploy/.env.production build --pull
docker compose --env-file deploy/.env.production up -d
docker compose --env-file deploy/.env.production ps
```

预期结果：

- `app` 最终显示 `healthy`；
- `caddy` 显示 `running`；
- `PORTS` 只出现在 Caddy 行，应用行只有容器内部的 `8787/tcp`。

第一次启动可能需要数分钟下载基础镜像、apt 包、Python 包和 npm 包。

查看启动日志。工作目录不变：

```bash
docker compose --env-file deploy/.env.production logs --tail=200 app
docker compose --env-file deploy/.env.production logs --tail=200 caddy
```

应用日志预期包含版本、CPU 架构、UID `10001` 和监听地址，不应包含 API 密钥。

失败处理：先看[第 16 章](#16-故障排查)。不要反复删除 `data` 目录来尝试修复。

### 本机健康检查

在证书尚未受信任前，`-k` 只用于服务器本机诊断：

```bash
curl -k --resolve '<LAN_HOST>:443:<LAN_BIND_ADDRESS>' --fail --silent https://<LAN_HOST>/api/health
curl -k --resolve '<LAN_HOST>:443:<LAN_BIND_ADDRESS>' --fail --silent https://<LAN_HOST>/api/ready
```

预期结果：

```json
{"ok":true}
```

以及：

```json
{"ok":true,"failed":[]}
```

`/api/health` 只说明 Node 事件循环能响应。`/api/ready` 还会检查数据库、数据目录、ffmpeg 和 edge-tts。正式监控应优先观察 readiness。

## 11. Caddy 内部 CA 与客户端信任

Caddy 会在首次启动时创建内部 CA。客户端只有信任根证书后，浏览器才会无警告访问 HTTPS。

### 导出根证书

工作目录：`/srv/science-video-workbench/app`。

```bash
docker compose --env-file deploy/.env.production cp \
  caddy:/data/caddy/pki/authorities/local/root.crt \
  ./caddy-root.crt
openssl x509 -in caddy-root.crt -noout -subject -issuer -dates -fingerprint -sha256
```

预期结果：显示主题、签发者、有效期和 SHA-256 指纹。通过组织已有的可信渠道把指纹发送给客户端管理员，并在安装证书前逐字符核对。

只分发 `root.crt`。绝对不要分发 `/data/caddy/pki/authorities/local/root.key`。任何获得根私钥的人都能签发被这些客户端信任的证书。

### Windows 客户端

方法一：以管理员身份运行 `certlm.msc`，导入到“受信任的根证书颁发机构/证书”。

方法二：管理员 PowerShell：

```powershell
certutil -addstore -f Root .\caddy-root.crt
```

预期结果：显示证书已添加。关闭并重新打开浏览器，访问 `https://science-video.lan`。

失败处理：确认访问名称与 `LAN_HOST` 完全一致，并核对证书指纹。

### macOS 客户端

使用“钥匙串访问”把证书导入“系统”钥匙串，将信任设置改为“始终信任”。也可由管理员执行：

```bash
sudo security add-trusted-cert -d -r trustRoot \
  -k /Library/Keychains/System.keychain caddy-root.crt
```

预期结果：重新打开浏览器后不再显示证书警告。

### Debian/Ubuntu 客户端

```bash
sudo cp caddy-root.crt /usr/local/share/ca-certificates/science-video-caddy.crt
sudo update-ca-certificates
```

预期结果：输出包含新增 1 个证书。

### iOS/iPadOS 与 Android

- iOS/iPadOS：安装描述文件后，还需在“设置/通用/关于本机/证书信任设置”中为该根证书启用完全信任；
- Android：从安全设置安装 CA 证书。不同厂商路径不同，部分应用不信任用户安装的 CA，但主流浏览器通常可用；
- 移动设备同样必须先核对 SHA-256 指纹；
- 不要通过公开网盘分发根证书。

### CA 数据保护

Caddy CA 保存在命名卷 `science-video-workbench_caddy_data`。普通 `docker compose down` 不会删除它。删除该卷会生成新 CA，所有客户端都要重新安装证书。

应用的 `backup.sh` 只备份应用数据，不包含 Caddy 根私钥。若组织要求灾难恢复后继续使用原 CA，应按组织密钥备份规范单独加密备份 Caddy 数据卷，并限制访问。无法安全保管私钥时，宁可灾后重新分发新根证书。

## 12. 首次上线验收

以下检查必须在实际 Linux/Docker 主机完成。本 Windows 开发机上的单元测试不能替代这些检查。

### 静态与构建

工作目录：`/srv/science-video-workbench/app`。

```bash
npm ci
npm test
npm run build
npm audit --omit=dev
bash -n deploy/entrypoint.sh deploy/lib.sh deploy/backup.sh deploy/restore.sh
docker compose --env-file deploy/.env.production config --quiet
docker compose --env-file deploy/.env.production build --pull
```

预期结果：测试和构建通过，生产依赖漏洞数为 0，Shell 与 Compose 校验退出 0。

### 容器安全与架构

```bash
docker compose --env-file deploy/.env.production exec -T app id
docker inspect "$(docker compose --env-file deploy/.env.production ps -q app)" \
  --format 'user={{.Config.User}} readonly={{.HostConfig.ReadonlyRootfs}} security={{json .HostConfig.SecurityOpt}}'
docker compose --env-file deploy/.env.production exec -T app uname -m
docker compose --env-file deploy/.env.production ps
```

预期结果：用户为 `10001:10001`，`readonly=true`，包含 `no-new-privileges:true`，架构与宿主机目标一致，应用 healthy。

### 数据持久化

```bash
sudo -u '#10001' touch /srv/science-video-workbench/data/release-persistence-marker
docker compose --env-file deploy/.env.production restart app
test -f /srv/science-video-workbench/data/release-persistence-marker
sudo rm /srv/science-video-workbench/data/release-persistence-marker
```

预期结果：重启后标记仍存在。

### 功能冒烟

使用已信任根证书的真实局域网客户端：

1. 打开 `https://<LAN_HOST>`，确认没有证书警告；
2. 使用共享口令登录；
3. 打开 API 设置，分别测试服务器默认和个人配置；
4. 保存个人密钥后重新打开，确认密钥框为空但来源显示为个人配置；
5. 创建一个本地回退任务并进入分镜确认；
6. 上传一个小型素材和 CSV；
7. 生成一段测试视频，确认旁白、字幕、画面和下载；
8. 退出登录，确认个人 API 设置被清除；
9. 使用第二个浏览器会话登录，确认看不到第一个会话的个人设置；
10. 确认服务端日志和 API 响应没有密钥。

### 备份恢复回环

在可丢弃测试数据或非生产主机上：

1. 创建唯一测试任务；
2. 执行 `sudo ./deploy/backup.sh`；
3. 修改或新增测试数据；
4. 执行 `sudo ./deploy/restore.sh <归档> --confirm-restore`；
5. 确认唯一测试任务恢复、备份后的修改消失；
6. 确认应用重新 healthy；
7. 保存演练记录。

### 发布通过标准

- 所有自动测试通过；
- 生产构建通过；
- 生产依赖审计为 0 个已知漏洞；
- AMD64 或 ARM64 实机镜像构建通过；
- app 端口未发布到宿主机；
- HTTPS 根证书指纹已核对；
- 非 root、只读根文件系统和 no-new-privileges 已验证；
- health/readiness 均正常；
- 重启后数据持久；
- 两个浏览器会话的个人密钥隔离；
- 备份与恢复回环通过；
- 防火墙只允许受信局域网；
- 没有路由器公网转发；
- 运维人员知道数据目录、备份目录、当前提交号和恢复步骤。

## 13. 登录与日常运维

用户打开 `https://<LAN_HOST>`，输入 `LAN_ACCESS_TOKEN`。同一局域网内的任务和素材是共享的，但每个浏览器会话的个人 API 设置彼此隔离。

个人 API 设置规则：

- 密钥提交后不会返回浏览器；重新打开设置时密钥输入框为空是正常行为；
- 密钥只保存在服务端内存；
- 退出登录、会话过期或应用重启会清除密钥；
- 每个任务在提交时抓取当时的有效配置；之后清除密钥不会改变已经排队或运行的任务；
- 重试任务使用发起重试的当前会话配置；
- 服务器级变量是可选回退，不会自动显示给用户；
- 通用 `VIDEO_PROVIDER_URL` 只能由管理员配置。
- 个人 OpenAI/DeepSeek 兼容地址必须使用 HTTPS、命中管理员域名白名单，并在请求时只解析到公网地址；重定向不会被跟随。

建议每位用户使用自己的供应商账号和配额，不要在群聊中共享第三方 API 密钥。

浏览器客户端会为所有写请求自动添加 `X-Science-Video-Request: 1`。自行编写的 API 调用也必须添加该请求头；服务端还会核对浏览器发送的 `Origin`。缺少请求头或来源不一致会返回 403。

除非另有说明，工作目录均为 `/srv/science-video-workbench/app`。

| 目的 | 命令 | 预期结果 |
| --- | --- | --- |
| 查看状态 | `docker compose --env-file deploy/.env.production ps` | app healthy，caddy running |
| 跟随应用日志 | `docker compose --env-file deploy/.env.production logs -f --tail=200 app` | 持续输出，无密钥 |
| 跟随代理日志 | `docker compose --env-file deploy/.env.production logs -f --tail=200 caddy` | HTTPS 请求与代理状态 |
| 启动 | `docker compose --env-file deploy/.env.production up -d` | 两个服务运行 |
| 停止但保留数据 | `docker compose --env-file deploy/.env.production stop` | 容器停止，卷和宿主数据保留 |
| 重启应用 | `docker compose --env-file deploy/.env.production restart app` | 约 1 分钟内恢复 healthy |
| 重建容器 | `docker compose --env-file deploy/.env.production up -d --force-recreate` | 使用当前镜像和配置重建 |
| 检查是否空闲 | `docker compose --env-file deploy/.env.production exec -T app npm run maintenance -- check-idle` | 空闲退出 0；活动任务退出 2 |
| 校验数据 | `docker compose --env-file deploy/.env.production exec -T app npm run maintenance -- validate-data` | 数据正常退出 0；异常退出 3 |

应用收到 SIGTERM 后会立即变为 unready，拒绝新写操作，停止接收新连接，并最多等待 30 秒排空规划、渲染和微调任务。Compose 提供 45 秒停止宽限期。启动时会把被强制中断的任务标记为失败，用户可以重试。

## 14. 数据、备份与恢复

### 手动完整备份

工作目录：`/srv/science-video-workbench/app`。建议使用 root 执行，以确保读取数据目录并操作 Docker。

```bash
sudo ./deploy/backup.sh
```

脚本会：

1. 验证路径不是空值、`/`、用户家目录或仓库根目录，并核对数据哨兵、UID/GID、数据库布局和运行容器的真实 bind source；
2. 获取 `flock`，防止备份和恢复重叠；
3. 检查是否有活动任务；
4. 仅停止应用容器；
5. 归档整个 `DATA_DIR`；
6. 生成 SHA-256 和 JSON 清单；
7. 原子发布最终文件；
8. 重启应用并等待 ready；
9. 按保留天数清理旧的正式备份；
10. 可选镜像到第二存储。

预期结果：标准输出最后一行是类似：

```text
/srv/science-video-workbench/backups/science-video-20260818T030000Z.tar.gz
```

同目录还应存在 `.sha256` 和 `.manifest.json`。

如果提示 `active jobs exist`，不要强制备份。等待所有任务进入完成、失败或等待确认状态后重试。

### 手动验证备份

工作目录：`/srv/science-video-workbench/backups`。

```bash
cd /srv/science-video-workbench/backups
sha256sum -c science-video-<时间戳>.tar.gz.sha256
tar -tzf science-video-<时间戳>.tar.gz | head
cat science-video-<时间戳>.tar.gz.manifest.json
```

预期结果：校验显示 `OK`，归档至少包含 `studio.sqlite`、`outputs/` 和 `materials/`。

### 配置 NAS 或第二磁盘

先把 NAS 或第二磁盘稳定挂载到固定绝对路径，例如 `/mnt/science-video-backup`，再把 `BACKUP_MIRROR_DIR` 设置为该路径。宿主机需要安装 `rsync`：

```bash
sudo apt-get update
sudo apt-get install -y rsync
```

执行一次手动备份，并确认归档、校验和、清单三个文件都出现在镜像目录。镜像挂载不可用时，脚本会以失败退出，但应用仍会通过退出陷阱重启。

### systemd 每日备份

使用 `sudoedit /etc/systemd/system/science-video-backup.service` 写入：

```ini
[Unit]
Description=Science Video Workbench backup
Requires=docker.service
After=docker.service

[Service]
Type=oneshot
WorkingDirectory=/srv/science-video-workbench/app
ExecStart=/srv/science-video-workbench/app/deploy/backup.sh
```

使用 `sudoedit /etc/systemd/system/science-video-backup.timer` 写入：

```ini
[Unit]
Description=Daily Science Video Workbench backup

[Timer]
OnCalendar=*-*-* 03:15:00
Persistent=true
RandomizedDelaySec=15m

[Install]
WantedBy=timers.target
```

加载并测试。工作目录：任意目录。

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now science-video-backup.timer
sudo systemctl start science-video-backup.service
sudo systemctl status science-video-backup.service
systemctl list-timers science-video-backup.timer
```

预期结果：服务最近一次退出码为 0，计时器显示下一次运行时间。

失败处理：

```bash
journalctl -u science-video-backup.service -n 200 --no-pager
```

不要把自动备份安排在常用渲染时段。活动任务会让备份安全退出，不会停止任务；应由监控发现连续失败。

### 恢复前检查

恢复会短暂停机并替换当前数据。先确认：

- 选择了正确归档；
- 校验和通过；
- 没有活动任务；
- `BACKUP_DIR` 有足够空间保存当前数据的安全副本；
- 数据盘有足够空间同时容纳当前数据、候选数据和回滚目录；
- 使用 root 执行。

### 执行恢复

工作目录：`/srv/science-video-workbench/app`。

```bash
sudo ./deploy/restore.sh \
  /srv/science-video-workbench/backups/science-video-<时间戳>.tar.gz \
  --confirm-restore
```

恢复脚本会验证相邻校验和、创建当前数据安全归档、解压到同一文件系统的候选目录、确认哨兵/目录/SQLite/预期表均存在、用只读挂载的一次性应用容器执行 `validate-data`、交换目录、修复 `10001:10001` 所有权并等待 readiness。验证过程不会创建数据库或表；空归档会被拒绝。如果交换后启动失败，脚本会自动换回原目录并重启应用。

预期结果：显示 `restore completed` 和安全归档路径，`docker compose ... ps` 中应用恢复 healthy。

恢复后必须在浏览器检查：

- 能登录；
- 任务列表存在；
- 一个历史视频可播放；
- 素材可读取；
- 新建一个不调用付费 API 的本地任务可以进入等待确认。

### 恢复演练

至少每季度在非生产主机执行一次完整恢复演练。只有成功恢复并验证过的备份才算可用备份。演练记录应包含归档名、SHA-256、耗时、应用版本、验证人和结果。

## 15. 升级与回滚

### 升级前

工作目录：`/srv/science-video-workbench/app`。

```bash
docker compose --env-file deploy/.env.production exec -T app npm run maintenance -- check-idle
sudo ./deploy/backup.sh
git rev-parse HEAD
docker image inspect "$(docker compose --env-file deploy/.env.production images -q app)" --format '{{.Id}}'
git status --short --branch
```

预期结果：空闲检查退出 0、备份通过、提交号和镜像 ID 被记录、工作树干净。

当前项目使用幂等建表而不是版本化迁移，因此每次升级都必须先备份。

### 执行升级

```bash
git fetch --tags --prune
git checkout <目标发布标签或提交号>
docker compose --env-file deploy/.env.production config --quiet
docker compose --env-file deploy/.env.production build --pull
docker compose --env-file deploy/.env.production up -d
docker compose --env-file deploy/.env.production ps
curl -k --resolve '<LAN_HOST>:443:<LAN_BIND_ADDRESS>' --fail https://<LAN_HOST>/api/ready
```

预期结果：应用 healthy，readiness 为 `ok: true`。随后执行[第 12 章](#12-首次上线验收)的登录和功能冒烟。

### 代码/镜像回滚

如果新版本未改变存储格式，先回到记录的提交：

```bash
git checkout <升级前提交号>
docker compose --env-file deploy/.env.production build
docker compose --env-file deploy/.env.production up -d
docker compose --env-file deploy/.env.production ps
```

如果新版本已经写入不兼容数据，代码回滚后还必须用升级前备份执行[第 14 章](#14-数据备份与恢复)的恢复流程。不要把新代码配旧数据或旧代码配新数据反复试错。

保留旧镜像和升级前备份，直到业务验收完成。

## 16. 故障排查

### 快速采集

工作目录：`/srv/science-video-workbench/app`。

```bash
docker compose --env-file deploy/.env.production ps
docker compose --env-file deploy/.env.production logs --tail=200 app
docker compose --env-file deploy/.env.production logs --tail=200 caddy
curl -k --resolve '<LAN_HOST>:443:<LAN_BIND_ADDRESS>' -i https://<LAN_HOST>/api/health
curl -k --resolve '<LAN_HOST>:443:<LAN_BIND_ADDRESS>' -i https://<LAN_HOST>/api/ready
df -h /srv/science-video-workbench
stat -c '%u:%g %a %n' /srv/science-video-workbench/data
```

分享日志前先检查并删除 URL 查询参数、Cookie、访问口令和第三方密钥。

### readiness 失败含义

| `failed` 值 | 含义 | 检查与恢复 |
| --- | --- | --- |
| `database` | SQLite 无法执行查询 | 检查磁盘、权限和日志；运行 `maintenance -- validate-data`；不要删除 WAL 文件 |
| `dataDirectory` | 数据目录无法写入 | 检查挂载、只读状态、空间、inode 和 `10001:10001` 所有权 |
| `ffmpeg` | `/usr/bin/ffmpeg -version` 失败 | 在容器内运行 `ffmpeg -version`；必要时重建镜像 |
| `tts` | Python 无法导入 `edge_tts` | 在容器内运行 `python -c 'import edge_tts'`；必要时重建镜像 |
| `shutdown` | 进程正在正常停止 | 等待容器重启，不要立即强制杀死 |

### 症状对照表

| 症状 | 首选命令 | 常见原因 | 处理 |
| --- | --- | --- | --- |
| 浏览器证书警告 | `openssl s_client -connect <LAN_HOST>:443 -servername <LAN_HOST>` | 根证书未信任、访问名不一致、CA 已重建 | 核对 `LAN_HOST` 和指纹，重新安装正确根证书 |
| 访问超时 | `ss -lntp` 和防火墙状态 | DNS、路由、防火墙或 Caddy 未运行 | 从服务器本机、同网段客户端逐级测试 |
| 登录总失败 | `docker compose ... logs app` | 口令错误、旧 Cookie、配置未重建 | 无痕窗口重试；核对环境文件后 `up -d --force-recreate app` |
| 登录后仍回到登录页 | 浏览器开发者工具检查 Cookie | 未使用 HTTPS、代理信任错误、客户端时间错误 | 保持 `TRUST_PROXY=1`，使用 `https://LAN_HOST`，同步时间 |
| app unhealthy | `curl http://127.0.0.1:8787/api/ready` 在容器内执行 | readiness 某组件失败 | 按 `failed` 字段处理 |
| ffmpeg 失败 | `docker compose ... exec app ffmpeg -version` | 镜像损坏或路径配置被覆盖 | 保持 `/usr/bin/ffmpeg`，重新构建镜像 |
| TTS 失败 | `docker compose ... exec app python -c 'import edge_tts'` | venv/依赖安装失败或网络问题 | 重建镜像；检查构建日志和出站网络 |
| SQLite locked | `docker compose ... ps` | 启动了多个应用实例或外部程序直接打开数据库 | 保证单实例；停止外部数据库浏览器；等待重试 |
| SQLite integrity invalid | `npm run maintenance -- validate-data` | 文件系统或数据库损坏 | 停止写入，保留现场，从已验证备份恢复 |
| Permission denied | `stat` 和 `docker inspect` | 数据目录所有权错误 | `sudo chown -R 10001:10001 DATA_DIR` 后重启 |
| No space left | `df -h`、`df -i`、`du -sh data/*` | 输出和修订增长 | 先扩容；按业务确认后归档旧项目，不要直接删 SQLite/WAL |
| 外部 API 超时 | 容器内 `curl -I <供应商地址>` | DNS、代理、出口防火墙或供应商故障 | 验证容器出站网络和供应商状态 |
| AI reference 不可用 | 从公网环境访问素材 URL | 配置的是局域网地址或证书不受供应商信任 | 使用供应商可访问的公开 HTTPS 对象存储 |
| ARM64 构建成功但运行失败 | `uname -m`、容器内 ffmpeg/TTS 检查 | 某个供应商 SDK 或媒体能力不兼容 | 停止上线，保留日志，在 AMD64 主机回退 |

常用容器内检查：

```bash
docker compose --env-file deploy/.env.production exec -T app id
docker compose --env-file deploy/.env.production exec -T app ffmpeg -version
docker compose --env-file deploy/.env.production exec -T app python -c 'import edge_tts; print(edge_tts.__version__)'
docker compose --env-file deploy/.env.production exec -T app npm run maintenance -- validate-data
```

预期 UID 为 10001。不要在容器里临时 `apt install` 修复；容器重建后会丢失，应修改镜像并走发布流程。

## 17. 安全边界、发布检查与卸载

- `deploy/.env.production` 权限为 0600；
- `LAN_ACCESS_TOKEN` 至少 16 字符，实际使用随机 32 字节值；
- 用户只通过 HTTPS 访问；
- `TRUST_PROXY=1`，应用前只有一个 Caddy；
- 8787 未发布；
- 80/443 只允许可信局域网；
- 不做公网端口转发；
- Caddy 根私钥只留在服务器；
- API 密钥不写入代码、Git、日志或工单；
- 容器以 UID/GID 10001 运行；
- 根文件系统只读；
- 定期安装宿主机安全更新并计划重启；
- 每次升级前有校验通过的备份；
- 至少一份备份位于另一物理介质；
- 定期执行恢复演练；
- 医疗或健康内容发布前由具备资质的人复核来源和表述。

### 仅停止服务并保留全部数据

工作目录：`/srv/science-video-workbench/app`。

```bash
docker compose --env-file deploy/.env.production down
```

该命令保留：

- `/srv/science-video-workbench/data`；
- `/srv/science-video-workbench/backups`；
- Caddy 命名卷和内部 CA。

不要添加 `--volumes`。

### 移走代码但保留数据

先执行最终备份并记录 SHA-256，然后把 `app` 目录移动到明确的归档位置：

```bash
sudo mv /srv/science-video-workbench/app \
  /srv/science-video-workbench/app-retired-$(date -u +%Y%m%d)
```

这是可恢复操作，不会删除数据。

### 完全销毁

完全销毁会永久删除应用数据、备份和 Caddy CA。必须先经过组织的数据销毁审批，并再次核对路径。建议先移动到隔离目录，等待保留期结束后再由管理员使用受控删除工具处理。

删除 Caddy 卷会让所有已安装根证书失效：

```bash
docker volume ls | grep science-video-workbench
docker volume rm science-video-workbench_caddy_data science-video-workbench_caddy_config
```

只有在确认不再恢复服务、且已完成必要审计和备份后才能执行。

## 18. 本地开发与发布维护

### 18.1 开发环境

推荐在 Node.js `22.12.0` 或更新版本、Python `3.10` 或更新版本上开发。生产容器使用 Node 22 Bookworm、系统 ffmpeg、Python 虚拟环境和 `tini`。本地依赖安装：

```powershell
npm install
npm run setup:tts
```

`npm install` 用于开发工作区；生产镜像使用锁文件和 `npm ci`。不要手工修改 `node_modules` 或把构建产物当作源码提交。

### 18.2 代码结构

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

### 18.3 常用开发命令

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

### 18.4 测试布局

- `src/server/*.test.ts`：认证、配置、数据库、任务、材料、供应商、就绪和停机行为。
- `src/client/*.test.ts`：表单和素材绑定的纯逻辑。
- `deploy/deployment-scripts.test.ts`：部署脚本的安全拒绝条件和静态契约。
- `scripts/check-docs.mjs`：文档结构、标题、代码围栏、本地链接和正式占位内容。

修改共享行为时应运行全量测试。数据库并发初始化测试会启动多个进程，不能用只跑一个函数的结果替代。

### 18.5 新增配置时必须同步的位置

新增或修改环境变量时至少检查：

1. `src/server/runtime-config.ts` 的解析、默认值和安全校验。
2. `.env.example` 的本地开发说明。
3. `deploy/.env.production.example` 的生产示例。
4. `compose.yaml` 是否需要传入容器。
5. 本手册第 9 章和第 19 章。
6. 对应的运行时配置测试。

新增或修改接口时至少检查服务端路由、`src/client/api.ts`、共享类型、认证/写请求保护、接口测试和本手册速查表。

### 18.6 正式发布验证顺序

开发机：

```powershell
npm run docs:check
npm test
npm run build
npm audit --omit=dev
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

### 18.7 提交范围

文档、测试和业务代码应按职责提交。不要把个人 `.env`、`deploy/.env.production`、数据目录、输出、日志、证书私钥或真实 API 密钥加入 Git。提交前使用 `git status --short` 和 `git diff --check` 检查范围。

## 19. 配置、端口、路径、命令与接口速查

### 19.1 应用运行变量

| 变量 | 默认/示例 | 用途与约束 |
| --- | --- | --- |
| `HOST` | 本地 `127.0.0.1`；容器 `0.0.0.0` | 非回环监听必须配置合格的 `LAN_ACCESS_TOKEN` |
| `PORT` | `8787` | 1-65535；生产中仅在 Compose 私网暴露 |
| `TRUST_PROXY` | 本地 `0`；Compose `1` | 只信任前方一个 Caddy；不要随意增大 |
| `LAN_ACCESS_TOKEN` | 无默认值 | 正式环境必填，至少 16 字符，拒绝已知占位值 |
| `MAX_CONCURRENT_RENDERS` | `1` | 整数 1-8；控制供应商、TTS、ffmpeg 和返修并发 |
| `FFMPEG_PATH` | 容器 `/usr/bin/ffmpeg` | 可选绝对路径；相对路径会被拒绝 |

### 19.2 服务器默认 API 变量

| 变量 | 默认/示例 | 说明 |
| --- | --- | --- |
| `OPENAI_API_KEY` | 空 | OpenAI 兼容脚本 API 密钥 |
| `OPENAI_BASE_URL` | `https://api.openai.com/v1` | OpenAI 兼容根地址 |
| `OPENAI_MODEL` | 空 | 配置 OpenAI 脚本服务时必须提供有效模型 |
| `DEEPSEEK_API_KEY` | 空 | DeepSeek 脚本 API 密钥 |
| `DEEPSEEK_BASE_URL` | `https://api.deepseek.com/v1` | DeepSeek 根地址 |
| `DEEPSEEK_MODEL` | `deepseek-chat` | DeepSeek 模型 |
| `VIDEO_PROVIDER_URL` | 空 | 管理员控制的通用视频供应商适配地址 |
| `VIDEO_PROVIDER_API_KEY` | 空 | 通用视频适配器密钥 |
| `ARK_API_KEY` | 空 | Ark 文本/视频服务密钥 |
| `ARK_VIDEO_MODEL` | `doubao-seedance-2-0-mini-260615` | 默认视频模型 |
| `ARK_TEXT_MODEL` | `doubao-seed-2-1-pro-260628` | Ark 文本模型 |
| `ARK_MAX_GENERATED_SHOTS` | `3` | 整数 1-6，混合生成的 AI 镜头上限 |
| `MATERIAL_PUBLIC_BASE_URL` | 空 | 公开 HTTPS 来源，暴露对应 `/materials/...` |
| `OUTPUT_PUBLIC_BASE_URL` | 空 | 公开 HTTPS 来源，暴露对应 `/outputs/...` |
| `PERSONAL_API_ALLOWED_HOSTS` | 空 | 额外允许的精确公网 DNS 主机名，逗号分隔 |

脚本规划优先顺序按当前配置解析：个人会话设置优先；服务器端直接 DeepSeek 在相应条件下优先于 Ark 文本；没有可用外部规划时使用本地模板。不要仅根据环境文件中“存在变量名”判断已连接，应以 `/api/provider` 和实际测试任务为准。

### 19.3 Compose 和备份变量

| 变量 | 示例/默认 | 说明 |
| --- | --- | --- |
| `APP_IMAGE` | `science-video-workbench` | 本地/私有镜像名称 |
| `APP_VERSION` | `local` | 镜像标签和备份清单版本 |
| `LAN_HOST` | `science-video.lan` | Caddy 证书中的稳定局域网 DNS 名或 IP |
| `LAN_BIND_ADDRESS` | `192.168.10.20` | 宿主机实际局域网地址；不要用 `0.0.0.0` 代替现场核对 |
| `HTTP_PORT` | `80` | Caddy HTTP 入口 |
| `HTTPS_PORT` | `443` | Caddy HTTPS 入口 |
| `DATA_DIR` | `/srv/science-video-workbench/data` | 绝对路径、专用目录、UID/GID 10001、包含项目数据哨兵 |
| `BACKUP_DIR` | `/srv/science-video-workbench/backups` | 本机备份目录，不能位于 `DATA_DIR` 内 |
| `BACKUP_MIRROR_DIR` | 空 | 可选第二介质/NAS 镜像目录 |
| `BACKUP_RETENTION_DAYS` | `14` | 1-3650 天；仅轮换规范命名的备份归档 |

`deploy/.env.production` 包含访问口令和服务器默认 API 密钥，权限必须为 0600，且已被 `.gitignore` 排除。

### 19.4 端口和网络

| 端口 | 谁监听 | 允许来源 | 说明 |
| --- | --- | --- | --- |
| 80/TCP | Caddy | 可信局域网 | HTTP 到 HTTPS/证书处理，仍受防火墙限制 |
| 443/TCP | Caddy | 可信局域网 | 唯一正式用户入口 |
| 8787/TCP | app 容器 | Compose 私有网络 | 不发布到宿主机，不供局域网直连 |
| 5173/TCP | Vite 开发服务 | 本机回环 | 仅开发环境 |

容器需要出站访问 npm/Python 源（构建时）、脚本/视频供应商、TTS 服务及现场配置的公开素材来源。入站允许范围和出站策略应由组织防火墙明确管理。

### 19.5 路径

| 路径 | 所在位置 | 用途 |
| --- | --- | --- |
| `/srv/science-video-workbench/app` | 宿主机 | Git 工作树和 Compose |
| `/srv/science-video-workbench/data` | 宿主机 | 持久化数据 |
| `/srv/science-video-workbench/backups` | 宿主机 | 备份、哈希和清单 |
| `/app/data` | app 容器 | `DATA_DIR` 的 bind mount |
| `/tmp` | app 容器 tmpfs | 有容量限制的运行临时文件 |
| `/data`、`/config` | Caddy 容器命名卷 | 内部 CA、证书和 Caddy 状态 |
| `dist/server` | 构建目录 | 编译后的服务端 |
| `dist/client` | 构建目录 | Vite 前端产物 |

### 19.6 部署脚本

| 文件/命令 | 用途 | 关键保护 |
| --- | --- | --- |
| `deploy/entrypoint.sh` | 容器启动前检查数据目录和依赖 | 失败则拒绝启动 |
| `deploy/lib.sh` | 共享路径、Compose、空闲、readiness 辅助函数 | 校验专用目录、哨兵、所有权和真实挂载 |
| `sudo ./deploy/backup.sh` | 一致性备份 | 拒绝活动任务，停止 app，生成 SHA-256/清单，重启 |
| `sudo ./deploy/restore.sh <备份> --confirm-restore` | 恢复数据 | 必须 root；校验哈希、候选数据、镜像、回滚目录 |

备份和恢复脚本读取 `deploy/.env.production`，应从项目根目录使用文档中的完整命令执行。

### 19.7 主要 HTTP 接口

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

### 19.8 常见 HTTP 状态码

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

## 20. 运维、变更与故障记录模板

### 现有发布记录基线

每次发布、恢复或证书变更至少记录：

```text
时间：
操作人：
服务器：
CPU 架构：
发布前提交/镜像：
发布后提交/镜像：
备份归档：
备份 SHA-256：
Caddy 根证书 SHA-256 指纹：
readiness 结果：
功能冒烟结果：
备份恢复演练结果：
异常与处理：
验收人：
```

这份记录与已验证的备份、发布标签一起保存，才构成可审计的正式发布。

### 20.1 为什么必须记录

代码提交、镜像、数据备份和 Caddy CA 是不同对象。只记“已升级”无法支持回滚；每次发布、恢复、证书变化和严重故障都应留下时间、操作人、目标、前后状态和验证结果。

### 20.2 发布或升级记录

```text
时间（含时区）：
操作人：
验收人：
服务器主机名/IP：
CPU 架构：
发布前 Git 提交：
发布后 Git 提交：
发布前镜像 ID：
发布后镜像 ID：
升级前备份归档：
备份 SHA-256：
环境文件变更项（不得写密钥值）：
Compose config 检查：
应用 health/readiness：
真实客户端登录：
测试视频结果：
数据重启持久化：
备份恢复演练：
异常和处理：
回滚条件/截止时间：
```

### 20.3 备份或恢复记录

```text
时间（含时区）：
操作人：
服务器：
操作类型：备份 / 恢复演练 / 正式恢复
操作前活动任务数：
DATA_DIR 实际路径：
归档文件：
归档 SHA-256：
清单中的版本/提交/架构：
恢复前安全备份：
候选数据只读验证：
恢复后 readiness：
业务数据抽查：
回滚目录处理：
异常和处理：
验收人：
```

### 20.4 证书变更记录

```text
时间（含时区）：
操作人：
LAN_HOST：
变更原因：
旧根证书 SHA-256 指纹：
新根证书 SHA-256 指纹：
根私钥位置确认（不得复制内容）：
完成安装的客户端范围：
浏览器无警告验证：
旧证书撤销/移除安排：
异常和处理：
验收人：
```

### 20.5 故障记录

```text
首次发现时间：
报告人：
影响用户/任务：
现象和准确错误信息：
最近一次正常时间：
最近变更：
health/readiness：
Compose ps：
日志时间范围：
磁盘和 inode：
数据完整性检查：
外部供应商状态：
已执行的操作及结果：
根因：
恢复时间：
防止复发措施：
负责人和截止日期：
```

记录中不得包含访问口令、API 密钥、Cookie、Caddy 根私钥或未脱敏请求体。

## 21. 术语表与常见问题

### 21.1 术语表

| 术语 | 含义 |
| --- | --- |
| Caddy | 生产入口的 HTTPS 反向代理 |
| 内部 CA | Caddy 为局域网服务签发证书的私有证书颁发机构 |
| health | 进程是否能响应，不保证依赖可用 |
| readiness | 应用是否具备接收任务所需的数据库、目录、ffmpeg 和 TTS 条件 |
| SQLite WAL | SQLite 的预写日志模式；改善单实例并发，不支持多应用副本共享写入 |
| 会话级 API | 只与当前登录会话关联、保存在服务端内存的个人供应商配置 |
| 服务器默认 | 管理员通过环境变量提供的共享供应商配置 |
| 本地回退 | 没有外部供应商时使用模板、动画、图表和本地合成完成流程 |
| 原样叠加 | 不交给 AI 重画，由本地合成精确保留上传像素 |
| AI reference | 把素材交给视频模型作为参考，需要供应商可访问 URL |
| Recompose | 不重新生成 AI 镜头，只重新合成旁白、字幕、图表和叠加 |
| Regenerate | 不复用原供应商镜头，重新生成所选镜头 |
| 修订版本 | 返修前归档的 MP4、字幕、海报、计划和片段集合 |
| 数据哨兵 | 部署脚本用于确认目录确属本项目的标识，防止误操作系统目录 |

### 21.2 本地能否不配置 API 使用

可以。系统会使用本地脚本模板、动画信息卡、图表、旁白和字幕。没有 Ark 时不会生成对应的真实 AI 镜头，界面会显示当前来源。

### 21.3 能否直接开放到公网

不能。当前共享口令、SQLite、内部 CA 和单机拓扑只面向受信任局域网。公网服务需要外部身份系统、公开证书、速率限制、审计、集中密钥管理、对象存储和新的数据库架构。

### 21.4 能否启动两个应用副本

不能。Compose 正式拓扑只运行一个 app；多个副本共享 SQLite/data 会产生锁竞争和不受支持的数据风险。WAL 和 busy retry 不等于多副本支持。

### 21.5 为什么保存后 API 密钥框是空的

服务端故意不回显密钥。来源显示“个人会话”且字段显示“已保存”表示配置存在；留空保存会保留同一服务商的现有密钥。第一次配置或切换服务商必须重新输入。

### 21.6 为什么服务器重启后个人设置消失

个人设置只在服务端进程内存中，重启会清除，这是避免密钥落盘的安全设计。需要长期共享的默认配置由管理员放在权限为 0600 的生产环境文件中；个人密钥需要用户重新填写。

### 21.7 为什么外部供应商访问不到局域网素材

供应商运行在公网，无法访问 RFC1918 地址、`.local` 名称或 Caddy 内部 CA。原样叠加不需要外部访问；AI reference/首尾帧需要公开、供应商信任的 HTTPS 对象存储或代理，并正确配置 `MATERIAL_PUBLIC_BASE_URL`。

### 21.8 为什么编辑已有镜头要求公开输出地址

编辑模式需要供应商读取原视频。短期供应商结果 URL 可能只保留约 23 小时；长期编辑应配置能公开提供 `/outputs/...` 的 `OUTPUT_PUBLIC_BASE_URL`。否则使用重新生成镜头。

### 21.9 备份能否不停机

正式基线不支持。备份脚本先确认没有活动任务，再停止应用并归档数据，以保证 SQLite、WAL、素材和输出的一致性。不要只复制 `studio.sqlite` 或在写入中直接打包数据目录。

### 21.10 可以把 Caddy 根证书发给用户吗

可以分发根证书公钥文件，但必须先通过可信渠道核对 SHA-256 指纹。绝不能分发、复制或备份到客户端的是 Caddy 根私钥。删除 Caddy 数据卷会生成新的 CA，所有客户端必须重新信任。

### 21.11 用户之间能否看到对方任务和 API 设置

任务和生成记录属于共享工作台，登录用户可以协作查看。个人 API 设置按会话隔离，不返回真实密钥；另一个会话看不到或复用该密钥。当前版本不是细粒度多租户系统。

### 21.12 修改设置会影响正在运行的任务吗

不会。任务提交时捕获有效设置；修改/清除只影响之后提交的命令。重试由谁点击，就使用谁当前会话的设置。

### 21.13 磁盘快满时能否直接删除数据文件

不能直接删除 SQLite、WAL、任务目录或当前输出。先检查 `df -h`、`df -i` 和各目录占用，停止新增任务，扩容或按业务规则归档已确认可移出的旧项目；操作前创建并校验备份。

### 21.14 出现 `database is locked` 怎么办

先确认只有一个 app 容器，没有外部数据库浏览器或另一进程直接打开生产数据库。短暂初始化锁会有限重试；持续锁错误通常表示违反单实例边界或存储异常。保留日志，不要反复强杀进程。

### 21.15 如何确认真正可以发布

必须同时满足：文档检查、测试、构建和生产依赖审计通过；Linux 主机实际构建镜像；app healthy；非 root/只读根/no-new-privileges 已验证；真实客户端 HTTPS 无警告；登录、个人设置隔离、测试视频、重启持久化和备份恢复回环通过；防火墙只允许可信局域网；运维记录完整。
