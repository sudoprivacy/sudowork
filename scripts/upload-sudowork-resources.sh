#!/bin/bash
set -e

DOWNLOAD_DIR="./download_cache"
OSS_SCRIPT="/Users/bgd/repo/oss/cos_client.py"
OSS_PREFIX="sudoclaw"
MAX_RETRIES=3

mkdir -p "$DOWNLOAD_DIR"

# Sudowork resource_0.0.5 下载配置
SUDOWORK_FILES=(
  "https://github.com/sudoprivacy/sudowork/releases/download/resouece_0.0.5/claude-code-macos-arm64.tgz|claude-code-macos-arm64.tgz"
  "https://github.com/sudoprivacy/sudowork/releases/download/resouece_0.0.5/claude-code-macos-x64.tgz|claude-code-macos-x64.tgz"
  "https://github.com/sudoprivacy/sudowork/releases/download/resouece_0.0.5/claude-code-windows-arm64.tgz|claude-code-windows-arm64.tgz"
  "https://github.com/sudoprivacy/sudowork/releases/download/resouece_0.0.5/claude-code-windows-x64.tgz|claude-code-windows-x64.tgz"
  "https://github.com/sudoprivacy/sudowork/releases/download/resouece_0.0.5/gemini-cli-macos-arm64.tgz|gemini-cli-macos-arm64.tgz"
  "https://github.com/sudoprivacy/sudowork/releases/download/resouece_0.0.5/gemini-cli-macos-x64.tgz|gemini-cli-macos-x64.tgz"
  "https://github.com/sudoprivacy/sudowork/releases/download/resouece_0.0.5/gemini-cli-windows-arm64.tgz|gemini-cli-windows-arm64.tgz"
  "https://github.com/sudoprivacy/sudowork/releases/download/resouece_0.0.5/gemini-cli-windows-x64.tgz|gemini-cli-windows-x64.tgz"
  "https://github.com/sudoprivacy/sudowork/releases/download/resouece_0.0.5/openclaw-macos-arm64.tgz|openclaw-macos-arm64.tgz"
  "https://github.com/sudoprivacy/sudowork/releases/download/resouece_0.0.5/openclaw-macos-x64.tgz|openclaw-macos-x64.tgz"
  "https://github.com/sudoprivacy/sudowork/releases/download/resouece_0.0.5/openclaw-windows-arm64.tgz|openclaw-windows-arm64.tgz"
  "https://github.com/sudoprivacy/sudowork/releases/download/resouece_0.0.5/openclaw-windows-x64.tgz|openclaw-windows-x64.tgz"
)

download_with_retry() {
  local url=$1
  local filepath=$2
  local retry=0

  while [ $retry -lt $MAX_RETRIES ]; do
    echo "下载尝试 $((retry + 1))/$MAX_RETRIES: $url"

    # 使用 -C - 支持断点续传
    if curl -L -C - -o "$filepath" "$url"; then
      # 验证文件是否完整 (检查文件大小 > 1MB)
      local filesize=$(stat -f%z "$filepath" 2>/dev/null || stat -c%s "$filepath" 2>/dev/null)
      if [ "$filesize" -gt 1048576 ]; then
        echo "下载完成: $filepath ($(numfmt --to=iec $filesize 2>/dev/null || echo $filesize bytes))"
        return 0
      fi
    fi

    retry=$((retry + 1))
    if [ $retry -lt $MAX_RETRIES ]; then
      echo "下载失败，等待 5 秒后重试..."
      sleep 5
    fi
  done

  echo "下载失败: $url"
  return 1
}

process_file() {
  local url=$1
  local filename=$2
  local filepath="$DOWNLOAD_DIR/$filename"
  local remote_path="$OSS_PREFIX/$filename"

  echo ""
  echo "========== $filename =========="

  # 下载 (支持断点续传)
  download_with_retry "$url" "$filepath" || return 1

  # 上传
  echo "上传: $remote_path"
  python "$OSS_SCRIPT" upload "$filepath" -r "$remote_path"

  # 删除本地文件
  rm -f "$filepath"
  echo "已删除: $filepath"
}

echo "========== 处理 Sudowork resource_0.0.5 =========="
for item in "${SUDOWORK_FILES[@]}"; do
  url="${item%%|*}"
  filename="${item##*|}"
  process_file "$url" "$filename"
done

# 清理空目录
rmdir "$DOWNLOAD_DIR" 2>/dev/null || true

echo ""
echo "========== 全部完成 =========="
echo "OSS 地址前缀: https://sudoclaw-1309794936.cos.ap-beijing.myqcloud.com/sudoclaw/"