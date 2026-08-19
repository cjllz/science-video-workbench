# 公开 Release 与一键服务器安装包设计

## 1. 目标

把科普视频工作台从“可以用源码构建的项目”提升为“可以下载、安装、升级和追溯的服务器程序”。正式交付物包括公开版本号、Docker 镜像、GitHub Release 安装包、校验文件和配套文档；普通用户仍通过局域网浏览器使用，不安装桌面客户端。

主发布位置为 GitHub 账号 `cjllz` 下的新公开仓库 `science-video-workbench`。现有 Gitee 企业仓库 `novlead/smart-video` 同步相同的 `main` 分支和版本标签，作为国内及企业内部代码入口，不维护第二套版本历史。

## 2. 交付模型

### 2.1 三层交付物

| 层级 | 面向对象 | 交付物 | 作用 |
| --- | --- | --- | --- |
| 源码 | 开发维护者 | GitHub/Gitee Git 仓库 | 审查、修改、测试和构建 |
| 程序 | 服务器管理员 | `ghcr.io/cjllz/science-video-workbench:<版本>` | 实际运行的应用镜像 |
| 安装入口 | 服务器管理员 | GitHub Release 在线安装包 | 配置、拉取镜像、启动和验收 |

领导或交付对象所说的“程序”对应第二、三层，而不是开发仓库中的 `src/`。服务器不需要安装 Node.js、Python 包或手工执行前端构建；这些依赖和构建产物位于固定版本的 Docker 镜像内。

### 2.2 用户访问方式

```text
GitHub Release 安装包
        |
        v
Linux 服务器拉取固定版本 Docker 镜像
        |
        v
app + Caddy + 持久化数据目录
        |
        v
局域网用户访问 https://<LAN_HOST>
```

普通用户不接触 Git、Docker、安装脚本或服务器密钥，只需要管理员提供的 HTTPS 地址、根证书和访问口令。

## 3. 发布版本和命名

采用语义化版本标签 `vMAJOR.MINOR.PATCH`。首个正式发布标签与当前 `package.json` 版本一致，为 `v0.1.0`。

- `PATCH`：兼容性修复、文档或部署改进。
- `MINOR`：向后兼容的新功能。
- `MAJOR`：可能需要数据迁移或改变部署契约的不兼容版本。

每个 Git 标签必须指向已通过完整验证的提交。工作流校验标签中的版本与 `package.json` 完全一致，防止错误标记。镜像标签至少包含完整版本 `0.1.0` 和 `latest`；只有正式版本更新 `latest`。

## 4. GitHub Release 内容

每个正式 Release 包含：

```text
science-video-workbench-v0.1.0-online-linux-amd64.tar.gz
science-video-workbench-v0.1.0-online-linux-amd64.tar.gz.sha256
SHA256SUMS
```

GitHub 自动提供的 Source code 归档仅供开发阅读，不作为服务器安装包。在线安装包只包含部署所需文件，不包含 `src/`、测试、`node_modules/`、`dist/`、运行数据、日志、真实环境文件、证书或密钥。

安装包内部固定为：

```text
science-video-workbench-v0.1.0/
├── VERSION
├── README.txt
├── compose.release.yaml
├── configure.sh
├── install.sh
├── update.sh
├── uninstall.sh
└── deploy/
    ├── Caddyfile
    └── .env.production.example
```

首版正式支持 Linux x86-64（`amd64`）。安装脚本发现其他架构时必须停止并显示明确原因，不能尝试运行错误镜像。ARM64 只有在镜像构建、实际视频、ffmpeg/TTS 和备份恢复验收完成后才能加入正式发布矩阵。

## 5. 发布镜像

GitHub Container Registry 地址固定为：

```text
ghcr.io/cjllz/science-video-workbench:0.1.0
ghcr.io/cjllz/science-video-workbench:latest
```

镜像为公开可拉取，安装服务器不需要 GitHub Token。镜像继续使用现有多阶段 Dockerfile：构建阶段编译前后端，运行阶段只保留生产依赖、ffmpeg、字体、Python TTS 环境、入口脚本和 `dist/`。

运行约束保持不变：非 root UID/GID 10001、只读根文件系统、`/tmp` tmpfs、一个应用实例、SQLite 单写、数据目录 bind mount、应用端口只在 Compose 私网暴露。

## 6. 一键安装行为

### 6.1 配置

`configure.sh` 提供中文交互式配置，询问并验证：

- 稳定局域网主机名或 IP；
- 宿主机局域网绑定地址；
- HTTPS/HTTP 端口；
- 数据目录和备份目录；
- 至少 16 字符的局域网访问口令；
- 最大并发渲染数；
- 可选的服务器默认 API 和公开素材/输出地址。

脚本从模板生成 `deploy/.env.production`，权限设为 0600。终端不回显访问口令和 API 密钥；Release 和日志不得包含真实值。重新运行时先备份现有配置，不能静默覆盖。

### 6.2 安装

`install.sh` 仅执行可预测、可审计的操作：

1. 要求 Linux、root 权限、x86-64、`docker`、Compose v2、`curl`、`tar` 和 `sha256sum`。
2. 不使用来源不明的 `curl | sh` 自动安装 Docker；缺少依赖时停止并指向部署手册。
3. 检查固定地址、端口、路径和生产环境文件。
4. 创建专用数据/备份目录、哨兵文件、子目录和 UID/GID 10001 所有权。
5. 将安装包内容安装到 `/srv/science-video-workbench/app`，保留现有生产配置。
6. 拉取 `VERSION` 指定的公开镜像，校验 Compose 配置并启动服务。
7. 等待 readiness，通过后输出访问地址、证书导出命令、日志和状态命令。

任何一步失败都返回非零状态。已创建的数据目录不因启动失败自动删除，便于排障和重试。

### 6.3 升级与卸载

`update.sh` 要求任务空闲和现有一致性备份，记录旧镜像 ID，拉取新版本并重建容器；readiness 失败时显示回滚命令，不自动改写业务数据。

`uninstall.sh` 默认只停止和删除容器，保留 `DATA_DIR`、`BACKUP_DIR`、生产配置和 Caddy CA。完全删除数据必须提供独立的显式确认参数，并继续使用现有安全路径和哨兵规则。

## 7. Release 自动化

新增 GitHub Actions 工作流，触发条件为推送 `v*.*.*` 标签：

1. 检出标签提交并安装锁定依赖。
2. 校验标签版本与 `package.json`。
3. 运行 `npm run verify` 和生产依赖审计。
4. 登录 GHCR，构建并推送 `linux/amd64` 固定版本镜像。
5. 组装在线安装包，检查包内白名单和 shell 语法。
6. 计算独立 SHA-256 和汇总 `SHA256SUMS`。
7. 使用提交历史/变更日志创建 GitHub Release 并上传制品。

工作流权限最小化为读取源码、写入 Packages 和写入 Release。常规分支提交不发布镜像；没有版本标签时不会产生正式制品。

## 8. 离线发布

离线包不阻塞首个在线版本。后续复用同一固定镜像，通过 `docker save` 生成：

```text
science-video-workbench-v0.1.0-offline-linux-amd64.tar.gz
```

离线安装包必须包含镜像归档校验值，安装时先验证 SHA-256，再执行 `docker load`。在线和离线包使用同一 `VERSION`、Compose 和脚本，避免维护两套部署逻辑。

## 9. GitHub 与 Gitee 同步

GitHub 是版本和 Release 的唯一发布源。Gitee 企业仓库同步 `main` 和 `v*` 标签，不在 Gitee 单独改版本号或重新生成不同制品。

同步方式优先使用本地两个 Git remote：

```text
origin -> GitHub cjllz/science-video-workbench
gitee  -> Gitee novlead/smart-video
```

首次推送前分别读取远端分支，禁止强制覆盖现有 Gitee 历史。若两个仓库已有不相关历史，先以明确的合并/导入提交处理；不得用 `--force` 隐藏冲突。自动镜像需要凭据时，凭据只放 GitHub Actions Secrets，不写入仓库。

## 10. 测试与验收

### 自动测试

- 安装脚本通过 `bash -n`。
- 静态契约测试检查 root、架构、依赖、路径、哨兵、配置权限、固定镜像和非破坏性卸载保护。
- 打包脚本在临时目录生成制品，并验证白名单、版本、可执行权限和不存在源码/密钥/生成物。
- Compose 使用虚构安全值执行 `docker compose config --quiet`。
- `npm run verify` 覆盖文档、应用测试和生产构建。

### Linux 发布验收

GitHub Actions 成功不替代真实服务器验收。首个 Release 发布前，在干净的 Linux x86-64 主机完成：安装、HTTPS 登录、本地回退视频、外部 API 视频、重启持久化、备份恢复、升级和默认保留数据的卸载测试。

## 11. 文档变更

- README 增加稳定版下载、服务器一键安装和源码构建的区别。
- 部署手册以 Release 安装为首选路径，保留源码构建作为开发或故障回退。
- 开发文档增加版本、标签、镜像、打包和发布工作流维护说明。
- GitHub Release 内的 `README.txt` 只保留安装前提、校验和入口命令，并链接正式部署手册。
- 新增 `CHANGELOG.md`，记录面向用户和管理员的版本变化，不复制 Git 提交列表。

## 12. 安全和仓库整洁

- 不提交 `deploy/.env.production`、真实域名口令、API 密钥、Cookie、证书私钥、数据、数据库、媒体或日志。
- Release 安装包由白名单组装，不直接压缩整个工作区。
- 所有镜像和包使用不可变版本号；部署不依赖浮动 `main`。
- 安装包提供 SHA-256；服务器安装前必须验证。
- 生成的压缩包、镜像归档和临时目录放在忽略目录中，验证结束后清理，不进入 Git。
- GitHub/Gitee 远端操作禁止强制推送，创建公开仓库前确认本地历史不含密钥或运行数据。

## 13. 非目标

- 不制作 Windows 桌面客户端或每个用户独立安装的应用。
- 不把当前单机 SQLite 架构扩展为多主机或多副本。
- 不在首版自动安装 Docker、配置公网入口或自动分发根证书。
- 不承诺首版 ARM64、离线镜像包或 Gitee 独立 Release。
- 不改变视频生成、素材融合、认证或业务数据模型。

## 14. 验收标准

1. 公开 GitHub 仓库存在并与本地 `main` 一致。
2. 推送合格版本标签后自动生成公开 GHCR 镜像和 GitHub Release。
3. Release 在线安装包不包含源码、秘密、运行数据或中间生成物。
4. 干净 Linux x86-64 服务器可以通过安装包完成配置、拉取、启动和 readiness 验收。
5. 普通用户只需浏览器、根证书和访问口令即可使用。
6. 更新和卸载不会静默删除生产数据、配置或 Caddy CA。
7. GitHub 与 Gitee 的 `main` 和版本标签指向相同提交，或明确记录因远端既有历史而尚未同步。
8. 完整文档、测试、构建、依赖审计和仓库整洁检查通过。
