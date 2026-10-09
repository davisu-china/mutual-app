#!/usr/bin/env bash
#
# 相悦 Mutual 一键部署
#
#   sudo ./deploy/deploy.sh                 # 独立域名（需先加 DNS）
#   sudo SUBPATH=mutual ./deploy/deploy.sh  # 挂主站子路径（不需 DNS）
#
# 做完全套：构建 → 数据库 → systemd → nginx → 证书 → 验收。
# 数据库默认装一个专用实例（不碰机器上已有的那套）。
#
# 唯一需要人工的前置：独立域名模式下要先加一条 DNS 记录（脚本会提示）。
#
# 可覆盖变量：
#   DOMAIN=mutual.jianjiange.site   独立域名模式的域名
#   SUBPATH=mutual                  非空则挂到 https://<SITE>/<SUBPATH>/
#   SITE=jianjiange.site            子路径模式挂靠的主站
#   DB_MODE=local|external          local=自动装专用 PG；external=用 EXTERNAL_DSN
#   API_PORT=8099  PG_PORT=5433
set -euo pipefail

DOMAIN="${DOMAIN:-mutual.jianjiange.site}"
SUBPATH="${SUBPATH:-}"
SITE="${SITE:-jianjiange.site}"
API_PORT="${API_PORT:-8099}"
DB_MODE="${DB_MODE:-local}"
PG_PORT="${PG_PORT:-5433}"

API_DIR="${API_DIR:-/opt/mutual-api}"
PG_DIR="${PG_DIR:-/opt/mutual-pg}"
PG_DATA="${PG_DATA:-/opt/mutual-pgdata}"
WEB_DIR="${WEB_DIR:-/opt/mutual-web}"
NGINX_CONF="${NGINX_CONF:-/opt/jianjian/deploy/nginx/nginx.conf}"
NGINX_HTML="${NGINX_HTML:-/opt/jianjian/deploy/nginx/html}"
NGINX_CONTAINER="${NGINX_CONTAINER:-jianjian-nginx}"
CERTBOT_DIR="${CERTBOT_DIR:-/opt/jianjian/deploy/certbot}"
LE_EMAIL="${LE_EMAIL:-898168605@qq.com}"
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# 运行用户（构建、跑服务、拥有数据库文件的身份）。
#
# 不能简单用 SUDO_USER：**已经是 root 时再执行 sudo，SUDO_USER 会是 root**，
# 于是脚本去找 /root/.local/go（不存在）而失败。改成从仓库属主推断，
# 那才是真正拥有 node_modules 和 Go 工具链的人。
if [ -z "${RUN_USER:-}" ]; then
  RUN_USER="$(stat -c '%U' "$REPO" 2>/dev/null || echo metabot)"
  if [ "$RUN_USER" = "root" ] || ! id "$RUN_USER" >/dev/null 2>&1; then
    RUN_USER="${SUDO_USER:-metabot}"
  fi
  [ "$RUN_USER" = "root" ] && RUN_USER=metabot
fi

# 网页在 nginx 容器里的固定落点。容器的 /usr/share/nginx/html 是
# 宿主 $NGINX_HTML 的只读挂载，所以网站文件必须放在这里容器才看得见。
WEB_IN_CONTAINER="/usr/share/nginx/html/mutual"
WEB_STAGE="$NGINX_HTML/mutual"

# 两种模式的差异收敛成两个变量
if [ -n "$SUBPATH" ]; then
  MODE="subpath"
  VITE_BASE="/$SUBPATH/"
  WEB_URL_PATH="/$SUBPATH/"
  API_URL_PATH="/$SUBPATH/api/"
  ACCESS_URL="https://$SITE/$SUBPATH/"
else
  MODE="domain"
  VITE_BASE="/"
  WEB_URL_PATH="/"
  API_URL_PATH="/api/"
  ACCESS_URL="https://$DOMAIN/"
fi

log(){ printf '\n\033[36m==> %s\033[0m\n' "$*"; }
warn(){ printf '\033[33m! %s\033[0m\n' "$*" >&2; }
die(){ printf '\033[31m✗ %s\033[0m\n' "$*" >&2; exit 1; }
[ "$(id -u)" = 0 ] || die "需要 root：sudo $0"
[ -d "$REPO/server" ] || die "找不到 server/ 目录，请在仓库根目录执行"

# ================================================================ 1. 前置检查
log "前置检查"

# 独立域名模式：没证书就意味着 DNS 还没指过来，早点发现比装到一半失败好
if [ "$MODE" = "domain" ] && [ ! -d "$CERTBOT_DIR/conf/live/$DOMAIN" ]; then
  if ! getent hosts "$DOMAIN" >/dev/null 2>&1; then
    die "DNS 未解析 $DOMAIN。

  请先在 Cloudflare 加一条记录：$DOMAIN → 111.228.14.136
  加好后重跑本脚本。

  或者用子路径模式免去这步（复用主站证书）：
      sudo SUBPATH=mutual $0"
  fi
fi

GO_BIN=""
for cand in "$(command -v go 2>/dev/null)" "$RUN_USER/.local/go/bin/go" \
            "/home/$RUN_USER/.local/go/bin/go" /usr/local/go/bin/go /usr/lib/go/bin/go; do
  if [ -n "$cand" ] && [ -x "$cand" ]; then GO_BIN="$cand"; break; fi
done
if [ -z "$GO_BIN" ]; then
  die "找不到 go。查找过：
    $(command -v go 2>/dev/null || echo 'PATH 里没有')
    /home/$RUN_USER/.local/go/bin/go
    /usr/local/go/bin/go
  可以显式指定：sudo RUN_USER=$RUN_USER GO_BIN=/path/to/go $0"
fi
command -v docker >/dev/null || die "找不到 docker"
echo "  ✓ 环境检查通过（模式：$MODE）"

# ================================================================ 2. 构建
log "构建后端与前端"

sudo -u "$RUN_USER" -H bash -lc "
  set -e
  cd '$REPO/server'
  PATH=\"\$(dirname '$GO_BIN'):\$PATH\" GOPATH=\"\$HOME/.local/gopath\" GOCACHE=\"\$HOME/.local/gocache\" \
    go build -o /tmp/mutual-api ./cmd/api
" || die "后端构建失败"

sudo -u "$RUN_USER" -H bash -lc "
  set -e
  cd '$REPO/web'
  NODE_ENV=development npm install --include=dev --no-audit --no-fund >/dev/null 2>&1
  NODE_ENV=production VITE_BASE='$VITE_BASE' npx vite build --outDir dist-deploy --logLevel warn
" || die "前端构建失败"
[ -f "$REPO/web/dist-deploy/index.html" ] || die "前端构建产物缺失"
echo "  ✓ 构建完成（前端 base=$VITE_BASE）"

# ================================================================ 3. 落盘
log "同步产物"
# 前端放到 nginx 容器看得见的位置——两种模式都一样，
# 差别只在 vhost 里怎么引用它
mkdir -p "$WEB_STAGE" "$WEB_DIR" "$API_DIR"
install -m 0755 /tmp/mutual-api "$API_DIR/mutual-api"
# 日志文件必须在这里就建好并交给运行用户。
#
# $API_DIR 是 root 用 mkdir 建的（755），而服务以 $RUN_USER 身份跑，
# 第 6 步里 sh 的重定向 `>> $API_DIR/api.log` 打不开文件 —— sh 直接退出码 1，
# **二进制根本没被执行**，于是 systemd 无限重启，日志里连一行报错都没有
# （因为报错本身就要写进那个建不出来的文件）。
# 症状极具迷惑性：进程在跑、端口没人听、journal 里只有 exit-code。
touch "$API_DIR/api.log"
chown "$RUN_USER" "$API_DIR/api.log"
chmod 0640 "$API_DIR/api.log"
rm -rf "${WEB_STAGE:?}/"*
cp -r "$REPO/web/dist-deploy/." "$WEB_STAGE/"
cp -r "$REPO/web/dist-deploy/." "$WEB_DIR/"
chmod -R a+rX "$WEB_STAGE" "$WEB_DIR"
echo "  ✓ 后端 $(du -h "$API_DIR/mutual-api" | cut -f1)，前端 $(find "$WEB_STAGE" -type f | wc -l) 个文件"

# ================================================================ 4. 数据库
log "准备数据库"

postgres_unit=""
if [ "$DB_MODE" = "local" ]; then
  if [ ! -x "$PG_DIR/bin/postgres" ]; then
    # $RUN_USER 是用户名（metabot），不是家目录路径，要拼上 /home/
    SRC_PG="/home/$RUN_USER/.local/pg/usr/pgsql-14"
    [ -x "$SRC_PG/bin/postgres" ] || die "找不到 PostgreSQL 二进制（$SRC_PG）"
    mkdir -p "$PG_DIR"
    cp -r "$SRC_PG/bin" "$SRC_PG/lib" "$SRC_PG/share" "$PG_DIR/"
    mkdir -p "$PG_DIR/syslib"
    cp -a "/home/$RUN_USER/.local/pg/usr/lib64/"*.so* "$PG_DIR/syslib/" 2>/dev/null || true
    echo "  ✓ PostgreSQL 二进制已就位"
  fi

  # 端口被占时**不盲目 kill** —— 那可能是别人的数据库。
  # 只提示，由人决定。
  if ss -ltn 2>/dev/null | grep -q ":$PG_PORT " && [ ! -s "$PG_DATA/PG_VERSION" ]; then
    die "端口 $PG_PORT 已被占用，但它不是本项目的数据库实例。

  查看占用者：  ss -ltnp | grep :$PG_PORT
  换个端口：    sudo PG_PORT=5434 $0
  或先停掉占用者再重跑。"
  fi

  if [ ! -s "$PG_DATA/PG_VERSION" ]; then
    # 注意顺序：initdb 要求目标目录**必须是空的**，
    # 所以 socket 子目录必须在 initdb 之后再建，不能先 mkdir。
    mkdir -p "$(dirname "$PG_DATA")"
    chown "$RUN_USER" "$(dirname "$PG_DATA")"
    sudo -u "$RUN_USER" -H env LD_LIBRARY_PATH="$PG_DIR/lib:$PG_DIR/syslib" \
      "$PG_DIR/bin/initdb" -D "$PG_DATA" -U mutual --encoding=UTF8 --locale=C >/dev/null
    # socket 目录必须显式指定：这份 PG 编译时把 /run/postgresql 写死了，
    # 普通用户建不了那个目录，照默认走启动会失败
    mkdir -p "$PG_DATA/sock"
    chown -R "$RUN_USER" "$PG_DATA"
    echo "  ✓ 数据库已初始化"
  fi

  # 已存在的实例也要保证 socket 目录在（老版本脚本可能没建）
  mkdir -p "$PG_DATA/sock"
  chown -R "$RUN_USER" "$PG_DATA"

  cat > /etc/systemd/system/mutual-postgres.service <<UNIT
[Unit]
Description=相悦 Mutual PostgreSQL
After=network-online.target

[Service]
Type=simple
User=$RUN_USER
Environment=LD_LIBRARY_PATH=$PG_DIR/lib:$PG_DIR/syslib
ExecStart=$PG_DIR/bin/postgres -D $PG_DATA -p $PG_PORT -c listen_addresses=127.0.0.1 -c unix_socket_directories=$PG_DATA/sock
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
UNIT
  systemctl daemon-reload
  systemctl enable mutual-postgres >/dev/null
  systemctl restart mutual-postgres

  printf '  等待数据库就绪'
  for _ in $(seq 1 25); do
    if sudo -u "$RUN_USER" -H env LD_LIBRARY_PATH="$PG_DIR/lib:$PG_DIR/syslib" \
        "$PG_DIR/bin/pg_isready" -h 127.0.0.1 -p "$PG_PORT" >/dev/null 2>&1; then break; fi
    printf '.'; sleep 1
  done
  echo
  systemctl is-active --quiet mutual-postgres || die "数据库没起来"

  psql_run() {
    sudo -u "$RUN_USER" -H env LD_LIBRARY_PATH="$PG_DIR/lib:$PG_DIR/syslib" \
      "$PG_DIR/bin/psql" -h 127.0.0.1 -p "$PG_PORT" "$@"
  }

  psql_run -U mutual -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname='mutual'" \
    | grep -q 1 || psql_run -U mutual -d postgres -c "CREATE DATABASE mutual" >/dev/null
  echo "  ✓ 库 mutual 就绪"

  HAS_TABLES=$(psql_run -U mutual -d mutual -tAc \
    "SELECT count(*) FROM information_schema.tables WHERE table_schema='public'" || echo 0)
  if [ "$HAS_TABLES" -lt 5 ]; then
    psql_run -U mutual -d mutual -v ON_ERROR_STOP=1 -f "$REPO/schema.sql" >/dev/null
    echo "  ✓ 表结构已导入"
  else
    echo "  ✓ 表结构已存在（跳过）"
  fi

  DSN="host=127.0.0.1 port=$PG_PORT user=mutual dbname=mutual sslmode=disable TimeZone=UTC"
  postgres_unit="mutual-postgres.service"
else
  DSN="${EXTERNAL_DSN:-}"
  [ -n "$DSN" ] || die "DB_MODE=external 时必须提供 EXTERNAL_DSN
  建议用 URL 形式（无空格）：
      postgres://user:pass@host:5432/dbname?sslmode=disable"
  case "$DSN" in
    *'"'*) die "EXTERNAL_DSN 不能包含双引号（会破坏 env 文件的引号包裹）" ;;
  esac
  echo "  ✓ 使用外部数据库"
fi

# ================================================================ 5. 环境变量
log "写入环境变量"
ENV_FILE="$API_DIR/api.env"
if [ ! -f "$ENV_FILE" ]; then
  cat > "$ENV_FILE" <<ENV
APP_ENV=prod
PORT=$API_PORT
TZ_NAME=Asia/Shanghai

# 这个值必须用双引号包起来。
#
# DSN 含空格，而 systemd 的 EnvironmentFile 与 shell 的 source 解析规则不同：
#   systemd：整行取值，但**默认会剥掉首尾空白**，不加引号会丢字符；
#            man systemd.exec 明确写了「unless you use double quotes」
#   shell：  不加引号会按空格拆分，DATABASE_DSN 只拿到第一段
# 加双引号后两边行为一致。排查问题时 source 这个文件是常规操作，不能让它坏。
DATABASE_DSN="$DSN"

JWT_SECRET=$(head -c 64 /dev/urandom | base64 | tr -d '\n/+=' | head -c 48)

# 用独立的 DB 号，避免和机器上其他项目串键
REDIS_ADDR=127.0.0.1:6379
REDIS_DB=1

# 机器上已有的 MinIO
MINIO_ENDPOINT=127.0.0.1:9000
MINIO_ACCESS_KEY=minioadmin
MINIO_SECRET_KEY=minioadmin
MINIO_USE_SSL=false
MINIO_BUCKET_PHOTOS=mutual-photos
MINIO_BUCKET_AVATARS=mutual-avatars

ALLOW_ORIGINS=https://$SITE,https://$DOMAIN

DAILY_LIKE_LIMIT=10
MAX_PHOTOS=9

# ⚠️ 照片自动过审。
#
# 打开它：照片上传后立即可见，**这是目前唯一能让卡池有内容的办法**。
# 关掉它：照片全部停在 pending，而卡池要求「有已过审照片」，
#          结果是站能打开但没有任何人能刷到人。
#
# 真正该做的是接入内容安全服务，由它来改 audit_status。
# 在那之前先开着，但你必须知道线上存在未审核的图片。
AUDIT_AUTO_APPROVE=true
ENV
  chmod 600 "$ENV_FILE"
  echo "  ✓ 已生成 $ENV_FILE"
else
  echo "  ✓ 保留已有 $ENV_FILE"
fi

# ================================================================ 6. API 服务
log "安装 API systemd 服务"
cat > /etc/systemd/system/mutual-api.service <<UNIT
[Unit]
Description=相悦 Mutual API
After=network-online.target ${postgres_unit}
${postgres_unit:+Requires=$postgres_unit}

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
# 端口若被手工起的实例占着，服务会 bind 失败，先清掉
if ss -ltn 2>/dev/null | grep -q ":$API_PORT "; then
  for p in $(ss -ltnp 2>/dev/null | grep ":$API_PORT " | grep -oE 'pid=[0-9]+' | cut -d= -f2 | sort -u); do
    kill "$p" 2>/dev/null || true
  done
  sleep 2
fi
systemctl restart mutual-api

printf '  等待 API 就绪'
API_OK=0
for _ in $(seq 1 25); do
  if curl -fsS -o /dev/null "http://127.0.0.1:$API_PORT/health" 2>/dev/null; then API_OK=1; break; fi
  printf '.'; sleep 1
done
echo
if [ "$API_OK" != "1" ]; then
  # 日志文件不存在是最难查的一种：服务日志里什么都看不到。
  # 根因几乎总是目录属主不对（服务用户建不出文件 ⇒ sh 的重定向直接失败）。
  if [ ! -f "$API_DIR/api.log" ]; then
    echo "⚠️  $API_DIR/api.log 不存在。"
    echo "    服务以 $RUN_USER 运行，但 $API_DIR 属主是 $(stat -c '%U:%G %a' "$API_DIR" 2>/dev/null)。"
    echo "    若属主不是 $RUN_USER，sh 无法创建日志文件、退出码 1，二进制从未被执行。"
    echo "    修：chown $RUN_USER $API_DIR  然后 systemctl restart mutual-api"
  fi
  echo "--- journalctl ---"; journalctl -u mutual-api -n 30 --no-pager 2>/dev/null || true
  echo "--- $API_DIR/api.log ---"; tail -30 "$API_DIR/api.log" 2>/dev/null || true
  die "API 没起来，日志见上"
fi
echo "  ✓ API 在跑（:$API_PORT）"

# ================================================================ 7. 证书
if [ "$MODE" = "domain" ] && [ ! -d "$CERTBOT_DIR/conf/live/$DOMAIN" ]; then
  log "申请证书 $DOMAIN"
  docker run --rm \
    -v "$CERTBOT_DIR/conf:/etc/letsencrypt" \
    -v "$CERTBOT_DIR/www:/var/www/certbot" \
    certbot/certbot certonly --webroot -w /var/www/certbot \
    -d "$DOMAIN" --email "$LE_EMAIL" --agree-tos --non-interactive \
    || die "证书申请失败（DNS 可能还没生效，等几分钟重跑）"
  echo "  ✓ 证书已签发"
fi

# ================================================================ 8. nginx
log "配置 nginx"

# 子路径模式下 location 是插进**主站那个 server 块**里的，而里面有一条按静态
# 资源后缀匹配的正则 location。nginx 里正则优先于普通前缀，/mutual/assets/x.png
# 会被它抢走转发给主站前端。`^~` 让前缀匹配直接终止正则评估，把 /mutual/ 下的
# 请求锁在自己这里。（独立域名模式是全新的 server 块，没有这个问题，保持原样。）
LOC_MOD=""
[ "$MODE" = "subpath" ] && LOC_MOD="^~ "

PROXY_LOC="location ${LOC_MOD}${API_URL_PATH} {
    proxy_pass http://172.17.0.1:${API_PORT}/api/;
    proxy_http_version 1.1;
    # 图片是预签名直传 MinIO 的，走 API 的只有小 JSON；但主站 server 的 10m
    # 会在子路径模式下被继承，这里显式对齐 domain 模式的 12m，免得以后
    # 往 API 加任何带 body 的接口时莫名 413。
    client_max_body_size 12m;
    proxy_set_header Host              \$host;
    proxy_set_header X-Real-IP         \$remote_addr;
    proxy_set_header X-Forwarded-For   \$proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto \$scheme;
    # WebSocket 必须带升级头，否则任务照跑但前端收不到消息
    proxy_set_header Upgrade    \$http_upgrade;
    proxy_set_header Connection \"upgrade\";
    proxy_buffering off;
    proxy_read_timeout 600s;
}"

WEB_LOC="location ${LOC_MOD}${WEB_URL_PATH} {
    alias ${WEB_IN_CONTAINER}/;
    try_files \$uri \$uri/ ${WEB_URL_PATH}index.html;
}"

MARK="# ===== 相悦 Mutual ====="

if grep -q "$MARK" "$NGINX_CONF"; then
  echo "  ✓ 配置已存在（改端口请手动更新后 reload）"
else
  # 先备份：下面 nginx -t 失败要靠它回滚
  cp "$NGINX_CONF" "$NGINX_CONF.bak.mutual.$(date +%Y%m%d-%H%M%S)"

  # ---------------- 插入位置必须算出来，不能取「文件里最后一个 }」----------------
  #
  # 最后那个 } 是 http{} 的收尾大括号。domain 模式往它前面插的是**完整 server 块**，
  # 放在 http 里合法；subpath 模式插的是**裸的 location**，放在 http 里直接非法，
  # nginx -t 报 `"location" directive is not allowed here`。这个错**只在子路径模式
  # 暴露**，所以沙箱验证没照到；而本机 nginx.conf 的最后一个 server 是 aiwritex 的、
  # 主站 server 夹在文件中间 —— 位置只能算，不能猜。
  #
  #   domain ：http{} 的收尾大括号
  #   subpath：主站 server 块（listen 443 且 server_name 含 $SITE）的收尾大括号
  INSERT_AT="$(awk -v site="$SITE" -v mode="$MODE" '
    function delta(s,   i, c, n) {
      n = 0
      for (i = 1; i <= length(s); i++) {
        c = substr(s, i, 1)
        if (c == "{") n++
        else if (c == "}") n--
      }
      return n
    }
    function iscomment(s) { return s ~ /^[[:space:]]*#/ }
    { line[NR] = $0 }
    END {
      if (mode == "domain") {
        started = 0; d = 0
        for (i = 1; i <= NR; i++) {
          if (!started) {
            if (!iscomment(line[i]) && line[i] ~ /^[[:space:]]*http[[:space:]]*\{/) {
              started = 1; d = delta(line[i])
            }
            continue
          }
          d += delta(line[i])
          if (d <= 0) { print i; exit 0 }
        }
        print "ERR"; exit 1
      }
      for (i = 1; i <= NR; i++) {
        if (iscomment(line[i])) continue
        if (line[i] !~ /^[[:space:]]*server[[:space:]]*\{/) continue
        d = 0; has443 = 0; named = 0; end = 0
        for (j = i; j <= NR; j++) {
          d += delta(line[j])
          if (line[j] ~ /^[[:space:]]*listen[[:space:]]+443([[:space:]]|;)/) has443 = 1
          if (line[j] ~ /^[[:space:]]*server_name[[:space:]]/) {
            s = line[j]
            sub(/^[[:space:]]*server_name[[:space:]]+/, "", s)
            sub(/;.*$/, "", s)
            cnt = split(s, tok, /[[:space:]]+/)
            for (k = 1; k <= cnt; k++) if (tok[k] == site || tok[k] == "www." site) named = 1
          }
          if (d <= 0) { end = j; break }
        }
        if (end && has443 && named) { print end; exit 0 }
      }
      print "ERR"; exit 1
    }' "$NGINX_CONF")" || INSERT_AT="ERR"

  case "$INSERT_AT" in
    ""|ERR) die "找不到可插入的位置：
    domain  模式需要 http{} 的收尾大括号
    subpath 模式需要一条 listen 443 且 server_name 含 $SITE 的 server 块
  请确认 SITE=$SITE 与 $NGINX_CONF 里的 server_name 一致，或手工把 location 加进主站 server。" ;;
    *[!0-9]*) die "插入位置解析失败：[$INSERT_AT]" ;;
  esac
  echo "  ✓ 插入点：第 $INSERT_AT 行前（$MODE 模式）"

  # ---------------- 生成片段（location 统一 8 空格缩进：都落在 server 块内）----------------
  if [ "$MODE" = "domain" ]; then
    cat > /tmp/mutual.loc <<LOC

    $MARK
    server {
        listen 443 ssl;
        http2 on;
        server_name $DOMAIN;
        client_max_body_size 12m;
        ssl_certificate     /etc/letsencrypt/live/$DOMAIN/fullchain.pem;
        ssl_certificate_key /etc/letsencrypt/live/$DOMAIN/privkey.pem;
        ssl_protocols TLSv1.2 TLSv1.3;
        ssl_ciphers HIGH:!aNULL:!MD5;
        ssl_prefer_server_ciphers on;
        ssl_session_cache shared:SSL:10m;
        ssl_session_timeout 1d;
        ssl_session_tickets off;
        add_header X-Content-Type-Options "nosniff" always;
        add_header Referrer-Policy "strict-origin-when-cross-origin" always;
        add_header Strict-Transport-Security "max-age=31536000" always;
        add_header X-Robots-Tag "noindex, nofollow" always;
$(printf '%s\n' "$PROXY_LOC" | sed 's/^/        /')
$(printf '%s\n' "$WEB_LOC" | sed 's/^/        /')
    }
    server {
        listen 80;
        server_name $DOMAIN;
        return 301 https://\$host\$request_uri;
    }
LOC
  else
    cat > /tmp/mutual.loc <<LOC

        $MARK
        # /xxx 不带尾斜杠时不会命中前缀 location /xxx/（alias 型 location 又不像
        # proxy_pass 那样会自动 301），它会落到主站的 location / 上返回主站的 404。
        location = ${WEB_URL_PATH%/} {
            return 301 ${WEB_URL_PATH}\$is_args\$args;
        }
$(printf '%s\n' "$PROXY_LOC" | sed 's/^/        /')
$(printf '%s\n' "$WEB_LOC" | sed 's/^/        /')
LOC
  fi

  awk -v ins=/tmp/mutual.loc -v at="$INSERT_AT" '
    { line[NR] = $0 }
    END {
      for (i = 1; i <= NR; i++) {
        if (i == at + 0) { while ((getline l < ins) > 0) print l; close(ins) }
        print line[i]
      }
    }' "$NGINX_CONF" > /tmp/mutual.nginx.new
  cat /tmp/mutual.nginx.new > "$NGINX_CONF"   # 原地覆盖，不能 sed -i（换 inode 容器读不到）
  echo "  ✓ 已插入配置"
fi

# 已经部署过的机器重跑本脚本时，上面那段会直接跳过（配置里有 MARK）。
# 所以「不带尾斜杠的跳转」要单独补一次，否则老机器只能手工改配置。
# 放在 nginx -t 之前，失败仍会走回滚。
if [ "$MODE" = "subpath" ] && ! grep -qF "location = ${WEB_URL_PATH%/} {" "$NGINX_CONF"; then
  cp "$NGINX_CONF" "$NGINX_CONF.bak.mutual.$(date +%Y%m%d-%H%M%S)"
  printf '        location = %s {\n            return 301 %s$is_args$args;\n        }\n' \
    "${WEB_URL_PATH%/}" "$WEB_URL_PATH" > /tmp/mutual.fix.loc
  awk -v ins=/tmp/mutual.fix.loc -v mark="$MARK" '
    BEGIN { done = 0 }
    {
      if (!done && index($0, mark) > 0) {
        print            # 先打 MARK 那行，跳转插在它后面，读起来是这段的头部
        while ((getline l < ins) > 0) print l
        close(ins)
        done = 1
        next
      }
      print
    }' "$NGINX_CONF" > /tmp/mutual.nginx.new
  cat /tmp/mutual.nginx.new > "$NGINX_CONF"
  echo "  ✓ 已补上 /${SUBPATH}（不带尾斜杠）的跳转"
fi

if ! docker exec "$NGINX_CONTAINER" nginx -t; then
  cat "$(ls -t "$NGINX_CONF".bak.mutual.* 2>/dev/null | head -1)" > "$NGINX_CONF" 2>/dev/null || true
  docker exec "$NGINX_CONTAINER" nginx -t && docker exec "$NGINX_CONTAINER" nginx -s reload
  die "nginx -t 失败，已回滚"
fi
docker exec "$NGINX_CONTAINER" nginx -s reload
echo "  ✓ nginx 已 reload"

# ================================================================ 9. 验收
log "验收"
sleep 1
CODE=$(curl -s -o /dev/null -w '%{http_code}' "$ACCESS_URL" || true)
API_CODE=$(curl -s -o /dev/null -w '%{http_code}' "${ACCESS_URL}api/v1/quota" || true)
echo "  网站首页  $ACCESS_URL        -> $CODE"
echo "  API 探测  ${ACCESS_URL}api/v1/quota -> $API_CODE（401 属正常，说明已反代到后端）"

echo
echo "════════════════════════════════════════════"
echo " 访问地址： $ACCESS_URL"
echo " 数据库：   $([ "$DB_MODE" = local ] && echo "本机专用实例 :$PG_PORT（数据 $PG_DATA）" || echo "外部")"
echo " 环境变量： $ENV_FILE"
echo " 日志：     journalctl -u mutual-api -f   或   $API_DIR/api.log"
echo "════════════════════════════════════════════"
echo
echo "⚠️  上线前必须处理（否则站是空的）："
echo "  1. AUDIT_AUTO_APPROVE=true —— 照片上传后立刻可见，没有经过任何审核。"
echo "     关掉它（改成 false）照片会全部停在 pending，而卡池要求已过审照片，"
echo "     结果是**没人能刷到任何人**。所以接入内容安全服务之前只能先开着。"
echo "  2. 若 MinIO 凭据不是 minioadmin，改 $ENV_FILE 后 systemctl restart mutual-api"
echo ""
echo "  接入审核服务后：把 AUDIT_AUTO_APPROVE 改成 false，并在 upload.go 的"
echo "  ConfirmPhoto / ConfirmAvatar 里调用审核服务，用回调改 audit_status。"
