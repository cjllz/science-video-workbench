# 科普视频工作台

## 项目简介

科普视频工作台是一个可在局域网内多人使用的视频生成工作台。它可以从主题、关键词或现有脚本开始，生成带旁白、字幕、图表和镜头的短视频，并支持对已完成镜头进行局部返修和版本恢复。

正式部署面向受信任的局域网，使用一台 Linux 主机、一个应用容器、一个 Caddy HTTPS 反向代理和一份 SQLite 数据目录。它不是公网 SaaS，也不是多副本高可用服务。

## 核心能力

- 输入主题或导入 TXT、Markdown、DOCX 脚本。
- 自动生成或手工编辑分镜、旁白、标题、时长和视觉方向。
- 上传图片、视频、音频、CSV、XLSX，并用 `@变量名` 绑定到镜头。
- 使用 Seedance 等外部服务，或在没有外部服务时使用本地脚本与动画回退。
- 对完成视频执行本地重组、已有镜头编辑或单镜头重新生成。
- 保存生成记录、反馈、镜头修订和可恢复的历史版本。
- 登录用户可为当前会话填写独立的脚本 API 和视频 API；密钥不会写入浏览器或数据库。

## 正式支持范围

- Linux + Docker Compose v2，单台主机。
- 一个 Node.js 应用容器和一个 Caddy 容器。
- SQLite 单写实例，数据通过宿主机 bind mount 持久化。
- 局域网客户端通过 Caddy 内部 HTTPS 访问。

不支持公网直连、路由器端口转发、多应用副本、多个主机共享 SQLite、Kubernetes 或无停机备份。完整边界、前置检查和回滚要求见 [完整项目手册](docs/PROJECT-MANUAL.md)。

## 快速本地体验

要求 Node.js `22.12.0` 或更新版本、Python `3.10` 或更新版本：

```powershell
npm install
npm run setup:tts
npm run dev
```

打开 <http://127.0.0.1:5173>。这是本机开发地址；不要把它当作局域网生产入口，也不要在裸 HTTP 页面中填写个人 API 密钥。

生产构建可用：

```powershell
npm run build
npm start
```

## 正式部署

请先阅读 [完整项目手册中的管理员路线](docs/PROJECT-MANUAL.md#服务器管理员路线)，再按其中的 Linux、Docker、HTTPS、备份和验收步骤执行。不要从历史设计稿或实施计划复制部署命令。

## 文档入口

- [普通用户路线](docs/PROJECT-MANUAL.md#普通用户路线)：从登录到生成、返修、版本恢复和个人 API。
- [服务器管理员路线](docs/PROJECT-MANUAL.md#服务器管理员路线)：从服务器准备到上线、运维、备份恢复和升级。
- [开发维护者路线](docs/PROJECT-MANUAL.md#开发维护者路线)：本地开发、代码结构、测试、构建和发布检查。
- [内部历史资料](docs/internal/README.md)：设计规格和历史实施计划，不是当前部署说明。

## 开发验证

```powershell
npm run docs:check
npm test
npm run build
npm run verify
```

`npm run verify` 会依次执行文档检查、测试和生产构建。Docker 镜像构建、Caddy 证书和真实局域网功能必须在目标 Linux 主机上额外验收。

## 发布前提醒

医疗、健康和生命科学内容必须使用权威来源，并在发布前由具备相应知识或资质的人员复核事实、引用、图表和表述。工具生成结果不能替代专业审核。
