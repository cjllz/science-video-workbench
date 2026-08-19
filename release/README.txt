科普视频工作台服务器安装包

支持环境：Linux x86-64（amd64）、Docker Engine、Docker Compose v2。
普通用户不需要安装本文件；管理员只在一台局域网服务器上安装一次。

安装前先在 Release 页面同时下载本压缩包和 SHA256SUMS，然后执行：

  sha256sum -c SHA256SUMS
  tar -xzf science-video-workbench-v<版本>-online-linux-amd64.tar.gz
  cd science-video-workbench-v<版本>
  sudo ./configure.sh
  sudo ./install.sh

安装完成后，脚本会显示 HTTPS 访问地址和 Caddy 根证书导出命令。

升级：使用新版本安装包执行 sudo ./update.sh。
停止并保留数据：执行 sudo ./uninstall.sh。

完整部署、证书、备份、恢复和故障处理说明：
https://github.com/cjllz/science-video-workbench/blob/main/docs/DEPLOYMENT.md

正式版本下载：
https://github.com/cjllz/science-video-workbench/releases
