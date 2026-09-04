#!/bin/bash
set -e

# 腾讯云 COS 上传脚本
# 用于手动上传 Sudowork 安装包到 COS
#
# 使用方法:
#   ./upload-to-cos.sh <secret_id> <secret_key> <file1> [file2] ...
#
# 示例:
#   ./upload-to-cos.sh AKIDxxxx xxxx1234 ./out/Sudowork-0.1.4-win32-x64.exe ./out/Sudowork-0.1.4-darwin-arm64.dmg

# 配置信息
COS_BUCKET="sudowork-release-1309794936"
COS_REGION="ap-beijing"
COS_PATH="sudowork/release/latest"

# 显示帮助信息
show_help() {
    echo "腾讯云 COS 上传脚本"
    echo ""
    echo "使用方法:"
    echo "  $0 <secret_id> <secret_key> <file1> [file2] ..."
    echo ""
    echo "参数:"
    echo "  secret_id    腾讯云 SecretId"
    echo "  secret_key   腾讯云 SecretKey"
    echo "  file         要上传的文件路径（支持多个文件）"
    echo ""
    echo "示例:"
    echo "  $0 AKIDxxxx xxxx1234 ./Sudowork-0.1.4-win32-x64.exe ./Sudowork-0.1.4-darwin-arm64.dmg"
    echo ""
    echo "上传后文件会被重命名为 latest 格式，例如:"
    echo "  Sudowork-0.1.4-darwin-arm64.dmg -> Sudowork-latest-darwin-arm64.dmg"
    exit 0
}

# 检查参数
if [ "$1" = "-h" ] || [ "$1" = "--help" ]; then
    show_help
fi

if [ $# -lt 3 ]; then
    echo "❌ 参数不足"
    echo ""
    show_help
fi

SECRET_ID="$1"
SECRET_KEY="$2"

# 剩余参数为文件列表
shift 2
FILES=("$@")

# 验证文件存在
for file in "${FILES[@]}"; do
    if [ ! -f "$file" ]; then
        echo "❌ 文件不存在: $file"
        exit 1
    fi
done

# 安装 coscmd（如果未安装）
if ! command -v coscmd &> /dev/null; then
    echo "📦 安装 coscmd..."
    pip install coscmd
fi

# 配置 coscmd
echo "🔐 配置 coscmd..."
coscmd config -a "$SECRET_ID" -s "$SECRET_KEY" -b "$COS_BUCKET" -r "$COS_REGION"

echo "📤 上传文件到 COS..."
echo "目标路径: $COS_PATH"
echo ""

for file in "${FILES[@]}"; do
    filename=$(basename "$file")

    # 转换版本号文件名为 latest 格式 (兼容 macOS/BSD 和 Linux/GNU sed)
    # e.g., Sudowork-0.1.4-darwin-arm64.dmg -> Sudowork-latest-darwin-arm64.dmg
    latest_name=$(echo "$filename" | sed -E 's/[0-9]+\.[0-9]+\.[0-9]+/latest/')

    echo "  上传: $file -> $COS_PATH/$latest_name"
    coscmd upload "$file" "$COS_PATH/$latest_name"
done

echo ""
echo "✅ 上传完成"
echo "📂 文件访问地址:"
for file in "${FILES[@]}"; do
    filename=$(basename "$file")
    latest_name=$(echo "$filename" | sed -E 's/[0-9]+\.[0-9]+\.[0-9]+/latest/')
    echo "   https://$COS_BUCKET.cos.$COS_REGION.myqcloud.com/$COS_PATH/$latest_name"
done
