#!/usr/bin/env bash
#
# 相悦 Mutual 部署脚本（后端 API + 前端静态站）
#
# 部署形态：
#   https://<域名>/            → nginx 提供前端静态文件
#   https://<域名>/api/v1/*    → nginx 反代到本机的 Go API
#   https://<域名>/api/v1/ws   → 同上，但需要 WebSocket 升级头
#
# 用法：
#   sudo ./deploy/deploy.sh
#
# 可覆盖的环境变量见下方。
set -euo pipefail

# ---------------------------------------------------------------- 配置
DOMAIN="${DOMAIN:-mutual.jianjiange.site}"
API_PORT="${API_PORT:-8099}"
API_DIR="${API_DIR:-/opt/mutual-api}"
WEB_DIR="${WEB_DIR:-/opt/mutual-web}"
NGINX_CONF="${NGINX_CONF:-/opt/jianjian/deploy/nginx/nginx.conf}"
NGINX_HTML="${NGINX_HTML:-/opt/jianjian/deploy/nginx/html}"
NGINX_CONTAINER="${NGINX_CONTAINER:-jianjian-nginx}"
CERTBOT_DIR="${CERTBOT_DIR:-/opt/jianjian/deploy/certbot}"
LE_EMAIL="${LE_EMAIL:-898168605@qq.com}"
SUBPATH="${SUBPATH:-mutual}"        # 前端挂在子路径下，复用主站证书
RUN_USER="${RUN_USER:-${SUDO_USER:-metabot}}"
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

log(){ printf '\n\033[36m==> %s\033[0m\n' "$*"; }
warn(){ printf '\033[33m! %s\033[0m\n' "$*" >&2; }
die(){ printf '\033[31m✗ %s\033[0m\n' "$*" >&2; exit 1; }
[ "$(id -u)" = 0 ] || die "需要 root：sudo $0"

# ---------------------------------------------------------------- 1. 构建
log "构建后端与前端"

if ! command -v go >/dev/null 2>&1 && [ ! -x "$RUN_USER/.local/go/bin/go" ]; then
  die "找不到 go，请先安装（可参考 README 的免 root 安装方式）"
fi
GO_BIN="$(command -v go 2>/dev/null || echo "$RUN_USER/.local/go/bin/go")"

sudo -u "$RUN_USER" -H bash -lc "
  set -e
  cd '$REPO/server'
  PATH=\"\$(dirname '$GO_BIN'):\$PATH\" GOPATH=\"\$HOME/.local/gopath\" GOCACHE=\"\$HOME/.local/gocache\" \
    go build -o /tmp/mutual-api ./cmd/api
" || die "后端构建失败"

sudo -u "$RUN_USER" -H bash -lc "
  set -e
  cd '$REPO/web'
  NODE_ENV=development npm install --include=dev --no-audit --no-fund >/dev/null
  NODE_ENV=production VITE_BASE='/$SUBPATH/' npx vite build --outDir dist-deploy --logLevel warn
" || die "前端构建失败"
echo "  ✓ 构建完成"

# ---------------------------------------------------------------- 2. 落盘
log "同步到 $API_DIR 与 $WEB_DIR"
mkdir -p "$API_DIR" "$WEB_DIR"
install -m 0755 /tmp/mutual-api "$API_DIR/mutual-api"
rm -rf "${WEB_DIR:?}/"*
cp -r "$REPO/web/dist-deploy/." "$WEB_DIR/"
# 同时放一份到 nginx 容器可见的目录（它是只读挂载进容器的）
mkdir -p "$NGINX_HTML/$SUBPATH"
rm -rf "${NGINX_HTML:?}/$SUBPATH"/*
cp -r "$REPO/web/dist-deploy/." "$NGINX_HTML/$SUBPATH/"
chmod -R a+rX "$WEB_DIR" "$NGINX_HTML/$SUBPATH"
echo "  ✓ 后端二进制 $(du -h "$API_DIR/mutual-api" | cut -f1)，前端 $(find "$WEB_DIR" -type f | wc -l) 个文件"

# ---------------------------------------------------------------- 3. 环境变量
log "准备环境变量"
ENV_FILE="$API_DIR/api.env"
if [ ! -f "$ENV_FILE" ]; then
  cat > "$ENV_FILE" <<ENV
APP_ENV=prod
PORT=$API_PORT
TZ_NAME=Asia/Shanghai

# 必填：数据库连接串
DATABASE_DSN=host=127.0.0.1 port=5432 user=mutual password=CHANGE_ME dbname=mutual sslmode=disable

# 必填：JWT 密钥（至少 32 位随机串）
JWT_SECRET=$(head -c 48 /dev/urandom | base64 | tr -d '\n/+=' | head -c 48)

# Redis（可选，不可用时自动降级为无缓存）
REDIS_ADDR=127.0.0.1:6379

# MinIO（必填，照片与头像存在这里）
MINIO_ENDPOINT=127.0.0.1:9000
MINIO_ACCESS_KEY=CHANGE_ME
MINIO_SECRET_KEY=CHANGE_ME
MINIO_USE_SSL=false

# 允许的前端来源
ALLOW_ORIGINS=https://$DOMAIN,https://jianjiange.site

DAILY_LIKE_LIMIT=10
MAX_PHOTOS=9
ENV
  chmod 600 "$ENV_FILE"
  warn "已生成 $ENV_FILE，请把 CHANGE_ME 换成真实值后重启服务"
else
  echo "  ✓ 保留已有 $ENV_FILE"
fi

# ---------------------------------------------------------------- 4. 数据库
log "检查数据库表"
grep -q "CHANGE_ME" "$ENV_FILE" && warn "数据库未配置，跳过建表（配好后重跑本脚本）" || {
  DSN=$(grep '^DATABASE_DSN=' "$ENV_FILE" | cut -d= -f2-)
  if command -v psql >/dev/null 2>&1; then
    psql "$DSN" -v ON_ERROR_STOP=1 -f "$REPO/schema.sql" >/dev/null 2>&1 \
      && echo "  ✓ schema 已应用" || warn "schema 应用失败（表可能已存在，可忽略）"
  else
    warn "找不到 psql，请手动执行 schema.sql 建表"
  fi
}

# ---------------------------------------------------------------- 5. systemd
log "安装 systemd 服务"
cat > /etc/systemd/system/mutual-api.service <<UNIT
[Unit]
Description=相悦 Mutual API
After=network-online.target

[Service]
Type=simple
User=$RUN_USER
WorkingDirectory=$API_DIR
EnvironmentFile=$API_DIR/api.env
# 本机 systemd 是 219，不支持 StandardOutput=append:（240+ 才有）。
# 用 sh -c 包裹做重定向，否则日志会静默丢失。
ExecStart=/bin/sh -c 'exec $API_DIR/mutual-api >> $API_DIR/api.log 2>&1'
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
UNIT

systemctl daemon-reload
systemctl enable mutual-api >/dev/null
# 每次部署都重启：代码已经换了，不重启跑的还是旧二进制
if ss -ltn 2>/dev/null | grep -q ":$API_PORT "; then
  for p in $(ss -ltnp 2>/dev/null | grep ":$API_PORT " | grep -oE 'pid=[0-9]+' | cut -d= -f2 | sort -u); do
    kill "$p" 2>/dev/null || true
  done
  sleep 2
fi
systemctl restart mutual-api

printf '  等待服务就绪'
for _ in $(seq 1 20); do
  if curl -fsS -o /dev/null "http://127.0.0.1:$API_PORT/health" 2>/dev/null; then break; fi
  printf '.'; sleep 1
done
echo
systemctl is-active --quiet mutual-api || { journalctl -u mutual-api -n 30 --no-pager; die "服务没起来"; }
curl -fsS "http://127.0.0.1:$API_PORT/health" >/dev/null || die "健康检查失败"
echo "  ✓ API 在跑（:$API_PORT）"

# ---------------------------------------------------------------- 6. nginx
log "合并 nginx 配置"

cat > /tmp/mutual.loc <<'LOC'

    # ===== 相悦 Mutual =====
    location /__SUBPATH__/api/ {
        proxy_pass http://172.17.0.1:__API_PORT__/api/;
        proxy_http_version 1.1;
        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        # WebSocket 必须带升级头，否则聊天连不上（任务照跑但前端收不到消息）
        proxy_set_header Upgrade    $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_buffering off;
        proxy_read_timeout 600s;
    }

    location /__SUBPATH__/ {
        alias /usr/share/nginx/html/__SUBPATH__/;
        try_files $uri $uri/ /__SUBPATH__/index.html;
    }
LOC
sed -i "s#__SUBPATH__#$SUBPATH#g; s#__API_PORT__#$API_PORT#g" /tmp/mutual.loc

MARK="# ===== 相悦 Mutual ====="
if grep -q "$MARK" "$NGINX_CONF"; then
  echo "  ✓ 配置已存在"
  if grep -q "172.17.0.1:$API_PORT" "$NGINX_CONF"; then
    echo "  ✓ 端口一致，无需改动"
  else
    warn "端口变了，请手动更新 $NGINX_CONF 里的 Mutual 段"
  fi
else
  cp "$NGINX_CONF" "$NGINX_CONF.bak.mutual.$(date +%Y%m%d-%H%M%S)"
  # 必须插在 http{} 的收尾大括号之前——直接追加会落到 http 块外，
  # nginx -t 报 "server directive is not allowed here"
  awk -v ins=/tmp/mutual.loc '
    { line[NR] = $0 }
    END {
      last = 0
      for (i = NR; i >= 1; i--) if (line[i] == "}") { last = i; break }
      for (i = 1; i <= NR; i++) {
        if (i == last) { while ((getline l < ins) > 0) print l; close(ins) }
        print line[i]
      }
    }' "$NGINX_CONF" > /tmp/mutual.nginx.new
  cat /tmp/mutual.nginx.new > "$NGINX_CONF"   # 原地覆盖，不能 sed -i
  echo "  ✓ 已插入配置"
fi

if ! docker exec "$NGINX_CONTAINER" nginx -t; then
  cat "$(ls -t "$NGINX_CONF".bak.mutual.* 2>/dev/null | head -1)" > "$NGINX_CONF" 2>/dev/null || true
  docker exec "$NGINX_CONTAINER" nginx -t && docker exec "$NGINX_CONTAINER" nginx -s reload
  die "nginx -t 失败，已回滚"
fi
docker exec "$NGINX_CONTAINER" nginx -s reload
echo "  ✓ nginx 已 reload"

# ---------------------------------------------------------------- 7. 验收
log "验收"
sleep 1
CODE=$(curl -s -o /dev/null -w '%{http_code}' "https://jianjiange.site/$SUBPATH/" || true)
API_CODE=$(curl -s -o /dev/null -w '%{http_code}' "https://jianjiange.site/$SUBPATH/api/" || true)
echo "  API   https://jianjiange.site/$SUBPATH/api/  -> $API_CODE（404 也正常，说明已反代到后端）"
echo "  前端  https://jianjiange.site/$SUBPATH/  -> $CODE"
[ "$CODE" = "200" ] || warn "前端返回 $CODE，检查 nginx 配置与文件权限"

echo
echo "访问地址： https://jianjiange.site/$SUBPATH/"
echo "API 日志： journalctl -u mutual-api -f   或  $API_DIR/api.log"
echo "环境变量： $API_DIR/api.env"
