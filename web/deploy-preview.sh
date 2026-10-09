#!/usr/bin/env bash
#
# 把前端构建产物部署成预览站，方便在手机/浏览器上看效果。
#
# 部署位置：https://jianjiange.site/mutual/
#   复用主站已有的证书与域名，**不需要新签 DNS、不需要 certbot**。
#
# 原理：共享 nginx 容器把 /opt/jianjian/deploy/nginx/html 以只读方式挂到了
# 容器的 /usr/share/nginx/html。所以把产物放进那个目录，nginx 就能直接serve，
# 不用改挂载、不用重启容器。
#
# 用法（在 web/ 目录下）：
#   sudo ./deploy-preview.sh
set -euo pipefail

SUBPATH="${SUBPATH:-mutual}"
NGINX_CONF="${NGINX_CONF:-/opt/jianjian/deploy/nginx/nginx.conf}"
NGINX_HTML="${NGINX_HTML:-/opt/jianjian/deploy/nginx/html}"
NGINX_CONTAINER="${NGINX_CONTAINER:-jianjian-nginx}"
REPO_WEB="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

log(){ printf '\n\033[36m==> %s\033[0m\n' "$*"; }
die(){ printf '\033[31m✗ %s\033[0m\n' "$*" >&2; exit 1; }
[ "$(id -u)" = 0 ] || die "需要 root：sudo $0"

log "构建（base=/$SUBPATH/）"
# 切到源码属主身份构建（避免产物被 root 拥有），并用登录 shell 保证 PATH 正确
BUILD_USER="${SUDO_USER:-metabot}"
sudo -u "$BUILD_USER" -H bash -lc "
  cd '$REPO_WEB' &&
  NODE_ENV=development VITE_BASE='/$SUBPATH/' npx vite build --outDir dist-preview --logLevel warn
"
[ -f dist-preview/index.html ] || die "构建产物缺失"

log "同步到 nginx 可读目录"
mkdir -p "$NGINX_HTML/$SUBPATH"
rm -rf "${NGINX_HTML:?}/$SUBPATH"/*
cp -r dist-preview/. "$NGINX_HTML/$SUBPATH/"
chmod -R a+rX "$NGINX_HTML/$SUBPATH"
echo "  ✓ $(find "$NGINX_HTML/$SUBPATH" -type f | wc -l) 个文件"

log "写入 nginx location"
MARK="# ===== 相悦预览站 ====="
if grep -q "$MARK" "$NGINX_CONF"; then
  echo "  ✓ location 已存在，跳过"
else
  cp "$NGINX_CONF" "$NGINX_CONF.bak.mutual.$(date +%Y%m%d-%H%M%S)"
  # 必须插在 http{} 的收尾大括号之前——直接追加到文件末尾会落到 http 块外
  cat > /tmp/mutual.loc <<LOC

    $MARK
    location /$SUBPATH/ {
        alias /usr/share/nginx/html/$SUBPATH/;
        try_files \$uri \$uri/ /$SUBPATH/index.html;
    }
LOC
  awk -v ins=/tmp/mutual.loc '
    { line[NR] = \$0 }
    END {
      last = 0
      for (i = NR; i >= 1; i--) if (line[i] == "}") { last = i; break }
      for (i = 1; i <= NR; i++) {
        if (i == last) { while ((getline l < ins) > 0) print l; close(ins) }
        print line[i]
      }
    }' "$NGINX_CONF" > /tmp/mutual.nginx.new
  cat /tmp/mutual.nginx.new > "$NGINX_CONF"   # 原地覆盖，不能 sed -i
  echo "  ✓ 已插入 location"
fi

log "校验并 reload"
if ! docker exec "$NGINX_CONTAINER" nginx -t; then
  cat "$(ls -t "$NGINX_CONF".bak.mutual.* 2>/dev/null | head -1)" > "$NGINX_CONF" 2>/dev/null || true
  docker exec "$NGINX_CONTAINER" nginx -t && docker exec "$NGINX_CONTAINER" nginx -s reload
  die "nginx -t 失败，已回滚"
fi
docker exec "$NGINX_CONTAINER" nginx -s reload
echo "  ✓ nginx 已 reload"

log "验收"
sleep 1
curl -s -o /dev/null -w "  https://jianjiange.site/$SUBPATH/ -> %{http_code}\n" \
  "https://jianjiange.site/$SUBPATH/"
echo
echo "预览地址： https://jianjiange.site/$SUBPATH/"
