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

不支持公网直连、路由器端口转发、多应用副本、多个主机共享 SQLite、Kubernetes 或无停机备份。完整边界、前置检查和回滚要求见 [部署运维手册](docs/DEPLOYMENT.md)。

## 正式部署

正式程序发布在 [GitHub Releases](https://github.com/cjllz/science-video-workbench/releases)，服务器管理员下载 `online-linux-amd64.tar.gz` 安装包和 `SHA256SUMS`，校验后运行包内的 `configure.sh` 与 `install.sh`。安装脚本会拉取同版本的公开容器镜像；最终用户只需在浏览器访问局域网 HTTPS 地址，不需要 Git、Node.js 或源码。

从 [部署运维手册](docs/DEPLOYMENT.md) 第 1 章开始，依次完成 Linux 主机、Release 下载、生产配置、HTTPS、上线验收和备份恢复。源码构建只用于开发和没有 Release 时的应急维护，不是推荐交付方式。

## 快速本地体验

以下命令只供开发者使用，要求 Node.js `22.12.0` 或更新版本、Python `3.10` 或更新版本：

```powershell
npm install
npm run setup:tts
npm run dev
```

打开 <http://127.0.0.1:5173>。这是本机开发地址；不要把它当作局域网生产入口，也不要在裸 HTTP 页面中填写个人 API 密钥。

本地生产构建可用：

```powershell
npm run build
npm start
```

## 文档入口

- [详细使用说明](docs/USER-GUIDE.md)：登录、创建视频、剧本和素材融合、个人 API、生成、返修与常见问题。
- [开发技术文档](docs/DEVELOPMENT.md)：架构、代码模块、配置、数据、接口、测试、构建和提交规范。
- [部署运维手册](docs/DEPLOYMENT.md)：Linux、Docker Compose、HTTPS、生产配置、备份恢复、升级回滚和故障处理。
- [版本记录](CHANGELOG.md)：正式发布版本及面向管理员和用户的变化。
- [内部历史资料](docs/internal/README.md)：历史设计规格和实施计划，不是当前操作依据。

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
