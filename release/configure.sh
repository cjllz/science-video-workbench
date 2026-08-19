#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
# shellcheck source=lib.sh
source "$SCRIPT_DIR/lib.sh"

require_root
require_linux
require_command realpath
require_command install

version="${APP_VERSION:-}"
if [[ -z "$version" && -f "$SCRIPT_DIR/VERSION" ]]; then
  version="$(tr -d '\r\n' <"$SCRIPT_DIR/VERSION")"
fi
version="${version:-0.1.0}"

prompt_value() {
  local variable="$1" label="$2" fallback="$3" current input
  current="${!variable:-$fallback}"
  if [[ "${NONINTERACTIVE:-0}" == "1" ]]; then
    printf -v "$variable" '%s' "$current"
    return
  fi
  read -r -p "$label [$current]: " input
  printf -v "$variable" '%s' "${input:-$current}"
}

prompt_secret() {
  local variable="$1" label="$2" current input
  current="${!variable:-}"
  if [[ "${NONINTERACTIVE:-0}" == "1" ]]; then
    return
  fi
  read -r -s -p "$label（留空表示不配置）: " input
  printf '\n'
  printf -v "$variable" '%s' "${input:-$current}"
}

prompt_value LAN_HOST "局域网主机名或 IP" "science-video.lan"
prompt_value LAN_BIND_ADDRESS "服务器局域网绑定地址" "192.168.10.20"
prompt_value HTTP_PORT "HTTP 端口" "80"
prompt_value HTTPS_PORT "HTTPS 端口" "443"
prompt_value DATA_DIR "数据目录" "/srv/science-video-workbench/data"
prompt_value BACKUP_DIR "备份目录" "/srv/science-video-workbench/backups"
prompt_value BACKUP_MIRROR_DIR "第二备份目录" ""
prompt_value BACKUP_RETENTION_DAYS "备份保留天数" "14"
prompt_value MAX_CONCURRENT_RENDERS "最大并发渲染数" "1"

if [[ "${NONINTERACTIVE:-0}" == "1" ]]; then
  [[ -n "${LAN_ACCESS_TOKEN:-}" ]] || die "LAN_ACCESS_TOKEN is required in non-interactive mode"
else
  read -r -s -p "局域网访问口令（至少 16 字符）: " LAN_ACCESS_TOKEN
  printf '\n'
fi
[[ ${#LAN_ACCESS_TOKEN} -ge 16 ]] || die "LAN_ACCESS_TOKEN must contain at least 16 characters"

prompt_secret OPENAI_API_KEY "OpenAI API Key"
prompt_value OPENAI_BASE_URL "OpenAI Base URL" "https://api.openai.com/v1"
prompt_value OPENAI_MODEL "OpenAI 模型" ""
prompt_secret DEEPSEEK_API_KEY "DeepSeek API Key"
prompt_value DEEPSEEK_BASE_URL "DeepSeek Base URL" "https://api.deepseek.com/v1"
prompt_value DEEPSEEK_MODEL "DeepSeek 模型" "deepseek-chat"
prompt_value VIDEO_PROVIDER_URL "通用视频服务地址" ""
prompt_secret VIDEO_PROVIDER_API_KEY "通用视频服务 API Key"
prompt_secret ARK_API_KEY "火山方舟 API Key"
prompt_value ARK_VIDEO_MODEL "Ark 视频模型" "doubao-seedance-2-0-mini-260615"
prompt_value ARK_TEXT_MODEL "Ark 文本模型" "doubao-seed-2-1-pro-260628"
prompt_value ARK_MAX_GENERATED_SHOTS "混合生成 AI 镜头数" "3"
prompt_value PERSONAL_API_ALLOWED_HOSTS "额外允许的个人 API 域名" ""
prompt_value MATERIAL_PUBLIC_BASE_URL "公开素材地址" ""
prompt_value OUTPUT_PUBLIC_BASE_URL "公开输出地址" ""

for variable in LAN_HOST LAN_BIND_ADDRESS HTTP_PORT HTTPS_PORT DATA_DIR BACKUP_DIR BACKUP_MIRROR_DIR \
  BACKUP_RETENTION_DAYS LAN_ACCESS_TOKEN MAX_CONCURRENT_RENDERS OPENAI_API_KEY OPENAI_BASE_URL OPENAI_MODEL \
  DEEPSEEK_API_KEY DEEPSEEK_BASE_URL DEEPSEEK_MODEL VIDEO_PROVIDER_URL VIDEO_PROVIDER_API_KEY ARK_API_KEY \
  ARK_VIDEO_MODEL ARK_TEXT_MODEL ARK_MAX_GENERATED_SHOTS PERSONAL_API_ALLOWED_HOSTS MATERIAL_PUBLIC_BASE_URL \
  OUTPUT_PUBLIC_BASE_URL; do
  validate_scalar "$variable" "${!variable:-}"
done

[[ "$HTTP_PORT" =~ ^[0-9]+$ && "$HTTPS_PORT" =~ ^[0-9]+$ ]] || die "ports must be integers"
[[ "$MAX_CONCURRENT_RENDERS" =~ ^[1-8]$ ]] || die "MAX_CONCURRENT_RENDERS must be between 1 and 8"
[[ "$BACKUP_RETENTION_DAYS" =~ ^[0-9]+$ && "$BACKUP_RETENTION_DAYS" -ge 1 ]] || die "BACKUP_RETENTION_DAYS must be positive"
[[ "$LAN_HOST" != *' '* && "$LAN_BIND_ADDRESS" != *' '* ]] || die "LAN host values cannot contain spaces"
[[ "$LAN_ACCESS_TOKEN" != *' '* && "$LAN_ACCESS_TOKEN" != *'#'* ]] || die "LAN_ACCESS_TOKEN cannot contain spaces or #"

install -d -m 0755 "$(dirname -- "$ENV_FILE")"
temporary="$ENV_FILE.tmp.$$"
trap 'rm -f -- "$temporary"' EXIT

write_variable() {
  printf '%s=%s\n' "$1" "${!1:-}" >>"$temporary"
}

: >"$temporary"
APP_IMAGE="ghcr.io/cjllz/science-video-workbench"
APP_VERSION="$version"
TRUST_PROXY=1
for variable in APP_IMAGE APP_VERSION LAN_HOST LAN_BIND_ADDRESS HTTP_PORT HTTPS_PORT DATA_DIR BACKUP_DIR \
  BACKUP_MIRROR_DIR BACKUP_RETENTION_DAYS LAN_ACCESS_TOKEN TRUST_PROXY MAX_CONCURRENT_RENDERS OPENAI_API_KEY \
  OPENAI_BASE_URL OPENAI_MODEL DEEPSEEK_API_KEY DEEPSEEK_BASE_URL DEEPSEEK_MODEL VIDEO_PROVIDER_URL \
  VIDEO_PROVIDER_API_KEY ARK_API_KEY ARK_VIDEO_MODEL ARK_TEXT_MODEL ARK_MAX_GENERATED_SHOTS \
  PERSONAL_API_ALLOWED_HOSTS MATERIAL_PUBLIC_BASE_URL OUTPUT_PUBLIC_BASE_URL; do
  write_variable "$variable"
done
chmod 0600 "$temporary"
if [[ -f "$ENV_FILE" ]]; then
  cp -p -- "$ENV_FILE" "$ENV_FILE.$(date -u +%Y%m%dT%H%M%SZ).bak"
fi
mv -f -- "$temporary" "$ENV_FILE"
trap - EXIT
printf 'production configuration written: %s\n' "$ENV_FILE"
