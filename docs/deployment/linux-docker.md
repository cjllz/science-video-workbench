# Linux + Docker Compose 局域网部署与运维手册

本文档是 Science Video Workbench 的正式部署基线。目标读者是第一次接手本项目的服务器管理员。命令默认在 Ubuntu 或 Debian 上执行，并假设项目安装到 `/srv/science-video-workbench/app`。

本文档中的尖括号内容，例如 `<仓库地址>`、`<局域网网段>`，必须替换为现场值。不要原样执行包含尖括号的命令。

## 1. 支持范围

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

## 2. 上线前准备

### 2.1 推荐资源

最低起点：

- 4 个 CPU 核心；
- 8 GiB 内存；
- 100 GiB 可用磁盘；
- 千兆局域网；
- Ubuntu 24.04 LTS、Debian 12 或更新的受支持稳定版本。

建议配置：8 个 CPU 核心、16 GiB 内存和独立 SSD。视频、历史修订和上传素材会持续增长，100 GiB 不是容量上限。生产服务器应监控磁盘空间。

### 2.2 检查 CPU 架构

工作目录：任意目录。

```bash
uname -m
```

预期结果：

- `x86_64`：AMD64，可部署；
- `aarch64` 或 `arm64`：ARM64，可部署，但必须完成第 14 节中的实际视频验收；
- 其他值：当前不作为正式支持目标。

失败处理：如果命令不可用或架构不在列表中，先停止部署。不要用未知架构直接承载生产数据。

### 2.3 稳定局域网地址

为服务器配置固定 IP 或 DHCP 保留地址，并准备一个稳定的局域网 DNS 名称，例如 `science-video.lan`。如果没有内部 DNS，也可以把 `LAN_HOST` 设置为固定 IP，但 DNS 名称更便于后续迁移。

禁止在路由器上把 80、443 或 8787 转发到公网。

### 2.4 检查时间与磁盘

工作目录：任意目录。

```bash
timedatectl status
df -h /srv
```

预期结果：系统时间同步为 `yes`，并且 `/srv` 所在分区有足够空间。

失败处理：先修复 NTP；磁盘不足时先扩容或换盘。证书验证、任务时间和备份保留都依赖正确时间。

## 3. 安装与核对 Docker

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

## 4. 目录与账号

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

## 5. 生产环境配置

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

### 5.1 必填变量

| 变量 | 生产建议 | 说明 |
| --- | --- | --- |
| `APP_IMAGE` | `science-video-workbench` | 本地镜像名 |
| `APP_VERSION` | 发布标签或短提交号 | 镜像标签和备份清单版本 |
| `LAN_HOST` | `science-video.lan` | Caddy 证书中的局域网 DNS 名或固定 IP |
| `HTTP_PORT` | `80` | 仅用于 HTTP 到 HTTPS 跳转 |
| `HTTPS_PORT` | `443` | 用户访问端口 |
| `DATA_DIR` | `/srv/science-video-workbench/data` | 必须是绝对路径，容器内映射到 `/app/data` |
| `BACKUP_DIR` | `/srv/science-video-workbench/backups` | 必须是绝对路径，不能位于 `DATA_DIR` 内 |
| `BACKUP_RETENTION_DAYS` | `14` 或更长 | 本地完整备份保留天数，范围 1 到 3650 |
| `LAN_ACCESS_TOKEN` | 32 字节随机值 | 局域网共享访问口令，至少 16 个字符 |
| `TRUST_PROXY` | `1` | 只信任前方一个 Caddy 代理，不要改成其他值 |
| `MAX_CONCURRENT_RENDERS` | `1` | 支持 1 到 8；先从 1 开始，根据 CPU、内存和 API 配额调高 |

`LAN_ACCESS_TOKEN` 用于登录，不是第三方 API 密钥。登录成功后浏览器获得 12 小时有效的 HttpOnly Cookie。HTTPS 下 Cookie 带 `Secure` 属性。

### 5.2 备份镜像变量

| 变量 | 说明 |
| --- | --- |
| `BACKUP_MIRROR_DIR` | 可选的 NAS、第二块磁盘或移动介质挂载点；留空表示不镜像 |

同一磁盘上的 `BACKUP_DIR` 只能防误删和应用损坏，不能防硬盘损坏。正式使用应配置第二份物理独立副本。

### 5.3 管理员级 API 回退配置

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

没有外部规划或视频配置时，系统使用本地规划和动画信息卡，并仍可生成本地视频。

### 5.4 对外素材地址

| 变量 | 用途 |
| --- | --- |
| `MATERIAL_PUBLIC_BASE_URL` | 外部视频供应商拉取 `/materials/...` 的公开 HTTPS 根地址 |
| `OUTPUT_PUBLIC_BASE_URL` | 外部供应商编辑旧镜头时拉取 `/outputs/...` 的公开 HTTPS 根地址 |

局域网地址、`localhost`、`192.168.x.x`、`10.x.x.x` 和 `172.16/12` 通常无法被外部供应商访问。只有“AI reference / 首帧 / 尾帧 / 编辑既有供应商镜头”需要公开地址。本地精确叠加和 CSV/XLSX 图表不需要公开地址。

不要为了这两个变量把整个工作台直接暴露到公网。应使用受控对象存储或只暴露必要素材路径的独立 HTTPS 服务。

### 5.5 检查配置文件

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

## 6. 第一次构建与启动

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

失败处理：先看第 12 节。不要反复删除 `data` 目录来尝试修复。

### 6.1 本机健康检查

在证书尚未受信任前，`-k` 只用于服务器本机诊断：

```bash
curl -k --resolve '<LAN_HOST>:443:127.0.0.1' --fail --silent https://<LAN_HOST>/api/health
curl -k --resolve '<LAN_HOST>:443:127.0.0.1' --fail --silent https://<LAN_HOST>/api/ready
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

## 7. Caddy 内部 CA 与客户端信任

Caddy 会在首次启动时创建内部 CA。客户端只有信任根证书后，浏览器才会无警告访问 HTTPS。

### 7.1 导出根证书

工作目录：`/srv/science-video-workbench/app`。

```bash
docker compose --env-file deploy/.env.production cp \
  caddy:/data/caddy/pki/authorities/local/root.crt \
  ./caddy-root.crt
openssl x509 -in caddy-root.crt -noout -subject -issuer -dates -fingerprint -sha256
```

预期结果：显示主题、签发者、有效期和 SHA-256 指纹。通过组织已有的可信渠道把指纹发送给客户端管理员，并在安装证书前逐字符核对。

只分发 `root.crt`。绝对不要分发 `/data/caddy/pki/authorities/local/root.key`。任何获得根私钥的人都能签发被这些客户端信任的证书。

### 7.2 Windows 客户端

方法一：以管理员身份运行 `certlm.msc`，导入到“受信任的根证书颁发机构/证书”。

方法二：管理员 PowerShell：

```powershell
certutil -addstore -f Root .\caddy-root.crt
```

预期结果：显示证书已添加。关闭并重新打开浏览器，访问 `https://science-video.lan`。

失败处理：确认访问名称与 `LAN_HOST` 完全一致，并核对证书指纹。

### 7.3 macOS 客户端

使用“钥匙串访问”把证书导入“系统”钥匙串，将信任设置改为“始终信任”。也可由管理员执行：

```bash
sudo security add-trusted-cert -d -r trustRoot \
  -k /Library/Keychains/System.keychain caddy-root.crt
```

预期结果：重新打开浏览器后不再显示证书警告。

### 7.4 Debian/Ubuntu 客户端

```bash
sudo cp caddy-root.crt /usr/local/share/ca-certificates/science-video-caddy.crt
sudo update-ca-certificates
```

预期结果：输出包含新增 1 个证书。

### 7.5 iOS/iPadOS 与 Android

- iOS/iPadOS：安装描述文件后，还需在“设置/通用/关于本机/证书信任设置”中为该根证书启用完全信任；
- Android：从安全设置安装 CA 证书。不同厂商路径不同，部分应用不信任用户安装的 CA，但主流浏览器通常可用；
- 移动设备同样必须先核对 SHA-256 指纹；
- 不要通过公开网盘分发根证书。

### 7.6 CA 数据保护

Caddy CA 保存在命名卷 `science-video-workbench_caddy_data`。普通 `docker compose down` 不会删除它。删除该卷会生成新 CA，所有客户端都要重新安装证书。

应用的 `backup.sh` 只备份应用数据，不包含 Caddy 根私钥。若组织要求灾难恢复后继续使用原 CA，应按组织密钥备份规范单独加密备份 Caddy 数据卷，并限制访问。无法安全保管私钥时，宁可灾后重新分发新根证书。

## 8. 防火墙与网络限制

先确认局域网网段，例如 `192.168.10.0/24`。不要照抄示例网段。

### 8.1 UFW

工作目录：任意目录。

```bash
sudo ufw allow from <局域网网段> to any port 80 proto tcp
sudo ufw allow from <局域网网段> to any port 443 proto tcp
sudo ufw status numbered
```

预期结果：80/443 只允许指定局域网网段。不要开放 8787。

### 8.2 firewalld

```bash
sudo firewall-cmd --permanent --add-rich-rule='rule family="ipv4" source address="<局域网网段>" port protocol="tcp" port="80" accept'
sudo firewall-cmd --permanent --add-rich-rule='rule family="ipv4" source address="<局域网网段>" port protocol="tcp" port="443" accept'
sudo firewall-cmd --reload
sudo firewall-cmd --list-all
```

失败处理：如果服务器有多网卡、VPN 或多个 VLAN，逐个明确允许来源，不要临时改成全网开放。

### 8.3 验证没有发布应用端口

工作目录：`/srv/science-video-workbench/app`。

```bash
docker compose --env-file deploy/.env.production ps
sudo ss -lntp | grep -E ':(80|443|8787)\b'
```

预期结果：宿主机监听 80/443，不监听 8787。

## 9. 用户登录与个人 API 设置

用户打开 `https://<LAN_HOST>`，输入 `LAN_ACCESS_TOKEN`。同一局域网内的任务和素材是共享的，但每个浏览器会话的个人 API 设置彼此隔离。

个人 API 设置规则：

- 密钥提交后不会返回浏览器；重新打开设置时密钥输入框为空是正常行为；
- 密钥只保存在服务端内存；
- 退出登录、会话过期或应用重启会清除密钥；
- 每个任务在提交时抓取当时的有效配置；之后清除密钥不会改变已经排队或运行的任务；
- 重试任务使用发起重试的当前会话配置；
- 服务器级变量是可选回退，不会自动显示给用户；
- 通用 `VIDEO_PROVIDER_URL` 只能由管理员配置。

建议每位用户使用自己的供应商账号和配额，不要在群聊中共享第三方 API 密钥。

## 10. 日常运维命令

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

## 11. 备份、计划任务与恢复

### 11.1 手动完整备份

工作目录：`/srv/science-video-workbench/app`。建议使用 root 执行，以确保读取数据目录并操作 Docker。

```bash
sudo ./deploy/backup.sh
```

脚本会：

1. 验证路径不是空值、`/`、用户家目录或仓库根目录；
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

### 11.2 手动验证备份

工作目录：`/srv/science-video-workbench/backups`。

```bash
cd /srv/science-video-workbench/backups
sha256sum -c science-video-<时间戳>.tar.gz.sha256
tar -tzf science-video-<时间戳>.tar.gz | head
cat science-video-<时间戳>.tar.gz.manifest.json
```

预期结果：校验显示 `OK`，归档至少包含 `studio.sqlite`、`outputs/` 和 `materials/`。

### 11.3 配置 NAS 或第二磁盘

先把 NAS 或第二磁盘稳定挂载到固定绝对路径，例如 `/mnt/science-video-backup`，再把 `BACKUP_MIRROR_DIR` 设置为该路径。宿主机需要安装 `rsync`：

```bash
sudo apt-get update
sudo apt-get install -y rsync
```

执行一次手动备份，并确认归档、校验和、清单三个文件都出现在镜像目录。镜像挂载不可用时，脚本会以失败退出，但应用仍会通过退出陷阱重启。

### 11.4 systemd 每日备份

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

### 11.5 恢复前检查

恢复会短暂停机并替换当前数据。先确认：

- 选择了正确归档；
- 校验和通过；
- 没有活动任务；
- `BACKUP_DIR` 有足够空间保存当前数据的安全副本；
- 数据盘有足够空间同时容纳当前数据、候选数据和回滚目录；
- 使用 root 执行。

### 11.6 执行恢复

工作目录：`/srv/science-video-workbench/app`。

```bash
sudo ./deploy/restore.sh \
  /srv/science-video-workbench/backups/science-video-<时间戳>.tar.gz \
  --confirm-restore
```

恢复脚本会验证相邻校验和、创建当前数据安全归档、解压到同一文件系统的候选目录、用一次性应用容器执行 `validate-data`、交换目录、修复 `10001:10001` 所有权并等待 readiness。如果交换后启动失败，脚本会自动换回原目录并重启应用。

预期结果：显示 `restore completed` 和安全归档路径，`docker compose ... ps` 中应用恢复 healthy。

恢复后必须在浏览器检查：

- 能登录；
- 任务列表存在；
- 一个历史视频可播放；
- 素材可读取；
- 新建一个不调用付费 API 的本地任务可以进入等待确认。

### 11.7 恢复演练

至少每季度在非生产主机执行一次完整恢复演练。只有成功恢复并验证过的备份才算可用备份。演练记录应包含归档名、SHA-256、耗时、应用版本、验证人和结果。

## 12. 故障排查

### 12.1 快速采集

工作目录：`/srv/science-video-workbench/app`。

```bash
docker compose --env-file deploy/.env.production ps
docker compose --env-file deploy/.env.production logs --tail=200 app
docker compose --env-file deploy/.env.production logs --tail=200 caddy
curl -k --resolve '<LAN_HOST>:443:127.0.0.1' -i https://<LAN_HOST>/api/health
curl -k --resolve '<LAN_HOST>:443:127.0.0.1' -i https://<LAN_HOST>/api/ready
df -h /srv/science-video-workbench
stat -c '%u:%g %a %n' /srv/science-video-workbench/data
```

分享日志前先检查并删除 URL 查询参数、Cookie、访问口令和第三方密钥。

### 12.2 readiness 失败含义

| `failed` 值 | 含义 | 检查与恢复 |
| --- | --- | --- |
| `database` | SQLite 无法执行查询 | 检查磁盘、权限和日志；运行 `maintenance -- validate-data`；不要删除 WAL 文件 |
| `dataDirectory` | 数据目录无法写入 | 检查挂载、只读状态、空间、inode 和 `10001:10001` 所有权 |
| `ffmpeg` | `/usr/bin/ffmpeg -version` 失败 | 在容器内运行 `ffmpeg -version`；必要时重建镜像 |
| `tts` | Python 无法导入 `edge_tts` | 在容器内运行 `python -c 'import edge_tts'`；必要时重建镜像 |
| `shutdown` | 进程正在正常停止 | 等待容器重启，不要立即强制杀死 |

### 12.3 症状对照表

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

## 13. 升级与回滚

### 13.1 升级前

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

### 13.2 执行升级

```bash
git fetch --tags --prune
git checkout <目标发布标签或提交号>
docker compose --env-file deploy/.env.production config --quiet
docker compose --env-file deploy/.env.production build --pull
docker compose --env-file deploy/.env.production up -d
docker compose --env-file deploy/.env.production ps
curl -k --resolve '<LAN_HOST>:443:127.0.0.1' --fail https://<LAN_HOST>/api/ready
```

预期结果：应用 healthy，readiness 为 `ok: true`。随后执行第 14 节的登录和功能冒烟。

### 13.3 代码/镜像回滚

如果新版本未改变存储格式，先回到记录的提交：

```bash
git checkout <升级前提交号>
docker compose --env-file deploy/.env.production build
docker compose --env-file deploy/.env.production up -d
docker compose --env-file deploy/.env.production ps
```

如果新版本已经写入不兼容数据，代码回滚后还必须用升级前备份执行第 11.6 节恢复。不要把新代码配旧数据或旧代码配新数据反复试错。

保留旧镜像和升级前备份，直到业务验收完成。

## 14. 正式发布验收

以下检查必须在实际 Linux/Docker 主机完成。本 Windows 开发机上的单元测试不能替代这些检查。

### 14.1 静态与构建

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

### 14.2 容器安全与架构

```bash
docker compose --env-file deploy/.env.production exec -T app id
docker inspect "$(docker compose --env-file deploy/.env.production ps -q app)" \
  --format 'user={{.Config.User}} readonly={{.HostConfig.ReadonlyRootfs}} security={{json .HostConfig.SecurityOpt}}'
docker compose --env-file deploy/.env.production exec -T app uname -m
docker compose --env-file deploy/.env.production ps
```

预期结果：用户为 `10001:10001`，`readonly=true`，包含 `no-new-privileges:true`，架构与宿主机目标一致，应用 healthy。

### 14.3 数据持久化

```bash
sudo -u '#10001' touch /srv/science-video-workbench/data/release-persistence-marker
docker compose --env-file deploy/.env.production restart app
test -f /srv/science-video-workbench/data/release-persistence-marker
sudo rm /srv/science-video-workbench/data/release-persistence-marker
```

预期结果：重启后标记仍存在。

### 14.4 功能冒烟

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

### 14.5 备份恢复回环

在可丢弃测试数据或非生产主机上：

1. 创建唯一测试任务；
2. 执行 `sudo ./deploy/backup.sh`；
3. 修改或新增测试数据；
4. 执行 `sudo ./deploy/restore.sh <归档> --confirm-restore`；
5. 确认唯一测试任务恢复、备份后的修改消失；
6. 确认应用重新 healthy；
7. 保存演练记录。

### 14.6 发布通过标准

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

## 15. 安全检查清单

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

## 16. 卸载

### 16.1 仅停止服务并保留全部数据

工作目录：`/srv/science-video-workbench/app`。

```bash
docker compose --env-file deploy/.env.production down
```

该命令保留：

- `/srv/science-video-workbench/data`；
- `/srv/science-video-workbench/backups`；
- Caddy 命名卷和内部 CA。

不要添加 `--volumes`。

### 16.2 移走代码但保留数据

先执行最终备份并记录 SHA-256，然后把 `app` 目录移动到明确的归档位置：

```bash
sudo mv /srv/science-video-workbench/app \
  /srv/science-video-workbench/app-retired-$(date -u +%Y%m%d)
```

这是可恢复操作，不会删除数据。

### 16.3 完全销毁

完全销毁会永久删除应用数据、备份和 Caddy CA。必须先经过组织的数据销毁审批，并再次核对路径。建议先移动到隔离目录，等待保留期结束后再由管理员使用受控删除工具处理。

删除 Caddy 卷会让所有已安装根证书失效：

```bash
docker volume ls | grep science-video-workbench
docker volume rm science-video-workbench_caddy_data science-video-workbench_caddy_config
```

只有在确认不再恢复服务、且已完成必要审计和备份后才能执行。

## 17. 运维记录模板

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
