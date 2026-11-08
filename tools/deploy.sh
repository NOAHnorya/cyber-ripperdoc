#!/bin/sh
# 打包并发布到 GitHub Pages（gh-pages 分支）
# 用法：sh tools/deploy.sh        → https://noahnorya.github.io/cyber-ripperdoc/
set -e
cd "$(dirname "$0")/.."
REPO="https://github.com/NOAHnorya/cyber-ripperdoc.git"

npm run build
tmp=$(mktemp -d)
cp -R dist/. "$tmp"
cd "$tmp"
touch .nojekyll
git init -q
git checkout -q -b gh-pages
git add -A
git commit -q -m "deploy $(date '+%Y-%m-%d %H:%M')"
git push -f "$REPO" gh-pages
cd / && rm -rf "$tmp"
echo "deployed: https://noahnorya.github.io/cyber-ripperdoc/"
