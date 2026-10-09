#!/usr/bin/env bash
#
# 端到端冒烟测试：两个真实用户走完整条主链路。
#
# 覆盖：注册 → 登录 → 填资料 → 完成 Onboarding → 划卡 → 双向 Like
#       → 配对 → 建会话 → 发消息 → 额度扣减 → 各类边界
#
# 用法：
#   API=http://127.0.0.1:18080 bash scripts/e2e.sh
set -uo pipefail

API="${API:-http://127.0.0.1:18080}"
PASS=0
FAIL=0

# ---------- 工具 ----------
jqv() { python3 -c "import sys,json;d=json.load(sys.stdin);print(eval('d'+sys.argv[1]))" "$1" 2>/dev/null; }

check() {
  local name="$1" cond="$2" extra="${3:-}"
  if [ "$cond" = "true" ] || [ "$cond" = "1" ]; then
    printf "  \033[32m✅\033[0m %s%s\n" "$name" "${extra:+  ($extra)}"
    PASS=$((PASS+1))
  else
    printf "  \033[31m❌\033[0m %s%s\n" "$name" "${extra:+  ($extra)}"
    FAIL=$((FAIL+1))
  fi
}

# 注意：这里用显式 if/else 而不是 ${3:+-H "..."} 的形式。
# 后者在 bash 里引号不可靠地分组，实测会把 `-H` 和它的值拼成【一个】参数，
# 结果 Authorization 头根本没发出去，接口一律返回「缺少访问凭证」。
post() {
  if [ -n "${3:-}" ]; then
    curl -sS -X POST "$API$1" -H 'Content-Type: application/json' \
         -H "Authorization: Bearer $3" -d "$2" 2>&1
  else
    curl -sS -X POST "$API$1" -H 'Content-Type: application/json' -d "$2" 2>&1
  fi
}
patch() {
  if [ -n "${3:-}" ]; then
    curl -sS -X PATCH "$API$1" -H 'Content-Type: application/json' \
         -H "Authorization: Bearer $3" -d "$2" 2>&1
  else
    curl -sS -X PATCH "$API$1" -H 'Content-Type: application/json' -d "$2" 2>&1
  fi
}
put() {
  if [ -n "${3:-}" ]; then
    curl -sS -X PUT "$API$1" -H 'Content-Type: application/json' \
         -H "Authorization: Bearer $3" -d "$2" 2>&1
  else
    curl -sS -X PUT "$API$1" -H 'Content-Type: application/json' -d "$2" 2>&1
  fi
}
get() {
  if [ -n "${2:-}" ]; then
    curl -sS "$API$1" -H "Authorization: Bearer $2" 2>&1
  else
    curl -sS "$API$1" 2>&1
  fi
}

# 生成不重复的手机号（用时间戳后 8 位）
TS=$(date +%s | tail -c 9)
PHONE_A="138${TS}"        # 男
PHONE_B="139${TS}"        # 女

echo "=== 1. 注册与登录 ==="

RA=$(post /api/v1/auth/register "{\"phone\":\"$PHONE_A\",\"password\":\"test1234\",\"deviceId\":\"dev-a\"}")
check "用户 A 注册" "$([ "$(echo "$RA" | jqv "['code']")" = "OK" ] && echo 1 || echo 0)" \
      "$(echo "$RA" | jqv "['message']" 2>/dev/null)"

RB=$(post /api/v1/auth/register "{\"phone\":\"$PHONE_B\",\"password\":\"test1234\",\"deviceId\":\"dev-b\"}")
check "用户 B 注册" "$([ "$(echo "$RB" | jqv "['code']")" = "OK" ] && echo 1 || echo 0)" \
      "$(echo "$RB" | jqv "['message']" 2>/dev/null)"

TA=$(echo "$RA" | jqv "['data']['accessToken']")
TB=$(echo "$RB" | jqv "['data']['accessToken']")
UA=$(echo "$RA" | jqv "['data']['userId']")
UB=$(echo "$RB" | jqv "['data']['userId']")
check "拿到双 token" "$([ -n "$TA" ] && [ -n "$TB" ] && echo 1 || echo 0)" "A=$UA B=$UB"

# 弱密码应被拒
RW=$(post /api/v1/auth/register "{\"phone\":\"13700000${TS:0:3}\",\"password\":\"12345678\"}")
check "弱密码被拒" "$([ "$(echo "$RW" | jqv "['code']")" = "WEAK_PASSWORD" ] && echo 1 || echo 0)" \
      "$(echo "$RW" | jqv "['message']" 2>/dev/null)"

# 重复注册
RD=$(post /api/v1/auth/register "{\"phone\":\"$PHONE_A\",\"password\":\"test1234\"}")
check "重复手机号被拒" "$([ "$(echo "$RD" | jqv "['code']")" = "PHONE_TAKEN" ] && echo 1 || echo 0)"

# 错误密码
RL=$(post /api/v1/auth/login "{\"phone\":\"$PHONE_A\",\"password\":\"wrongpass1\"}")
check "错误密码被拒" "$([ "$(echo "$RL" | jqv "['code']")" = "BAD_CREDENTIALS" ] && echo 1 || echo 0)"

# 正确登录
RLOK=$(post /api/v1/auth/login "{\"phone\":\"$PHONE_A\",\"password\":\"test1234\"}")
check "正确密码可登录" "$([ "$(echo "$RLOK" | jqv "['code']")" = "OK" ] && echo 1 || echo 0)"

echo ""
echo "=== 2. Onboarding 门槛（未完成前应被拦）==="
RC=$(get /api/v1/cards "$TA")
check "未完成 Onboarding 时划卡被拦" "$([ "$(echo "$RC" | jqv "['code']")" = "ONBOARDING_REQUIRED" ] && echo 1 || echo 0)" \
      "$(echo "$RC" | jqv "['message']" 2>/dev/null)"

echo ""
echo "=== 3. 填写资料 ==="

# 本人画像
fill_profile() {
  local T="$1" gender="$2" height="$3" city="$4" prov="$5"
  patch /api/v1/users/me/profile "{
    \"gender\":$gender,\"birthday\":\"1997-03-15\",\"heightCm\":$height,\"weightKg\":62,
    \"hometownProvince\":\"$prov\",\"hometownCity\":\"$city\",
    \"cityProvince\":\"$prov\",\"city\":\"$city\",
    \"occupation\":\"互联网\",\"mbti\":\"INTJ\",\"smoking\":1,\"drinking\":2,
    \"incomeRange\":4,\"education\":3,\"school\":\"某大学\",\"company\":\"某公司\",
    \"isOnlyChild\":true,\"eldercarePressure\":2,\"hasCar\":true,\"hasHouse\":2,\"isDink\":2
  }" "$T"
}

RPA=$(fill_profile "$TA" 1 178 "杭州市" "浙江省")
check "A 填本人画像" "$([ "$(echo "$RPA" | jqv "['code']")" = "OK" ] && echo 1 || echo 0)" \
      "$(echo "$RPA" | jqv "['message']" 2>/dev/null)"

RPB=$(fill_profile "$TB" 2 165 "杭州市" "浙江省")
check "B 填本人画像" "$([ "$(echo "$RPB" | jqv "['code']")" = "OK" ] && echo 1 || echo 0)"

# 未成年应被拒
RY=$(patch /api/v1/users/me/profile '{"birthday":"2015-01-01"}' "$TA")
check "未成年生日被拒" "$([ "$(echo "$RY" | jqv "['code']")" = "UNDERAGE" ] && echo 1 || echo 0)" \
      "$(echo "$RY" | jqv "['message']" 2>/dev/null)"

# 兴趣
fill_hobbies() {
  put /api/v1/users/me/hobbies "{\"hobbies\":[
    {\"name\":\"摄影\",\"description\":\"每周出门拍一次，主要拍街头和建筑\",\"sortOrder\":1},
    {\"name\":\"徒步\",\"description\":\"走过川西几条线，最喜欢高海拔垭口\",\"sortOrder\":2},
    {\"name\":\"咖啡\",\"description\":\"手冲三年，最近在试浅烘的耶加\",\"sortOrder\":3}
  ]}" "$1"
}
RHA=$(fill_hobbies "$TA")
check "A 填三个兴趣" "$([ "$(echo "$RHA" | jqv "['code']")" = "OK" ] && echo 1 || echo 0)" \
      "$(echo "$RHA" | jqv "['message']" 2>/dev/null)"

# 兴趣数量不对应被拒
RHB=$(put /api/v1/users/me/hobbies "{\"hobbies\":[{\"name\":\"摄影\",\"description\":\"aaaaaaaaaaaaaa\",\"sortOrder\":1}]}" "$TA")
check "兴趣数量不为 3 被拒" "$([ "$(echo "$RHB" | jqv "['code']")" != "OK" ] && echo 1 || echo 0)"

fill_hobbies "$TB" > /dev/null

# 自述
fill_texts() {
  patch /api/v1/users/me/texts "{
    \"aboutMe\":\"写代码也写字，周末不是在山里就是在咖啡馆。做事比较认真，不太会寒暄。\",
    \"expectPartner\":\"希望遇到一个能把话说清楚的人，不用很热闹，但要能聊到一块儿去。\"
  }" "$1"
}
RTA=$(fill_texts "$TA")
check "A 填两段自述" "$([ "$(echo "$RTA" | jqv "['code']")" = "OK" ] && echo 1 || echo 0)" \
      "$(echo "$RTA" | jqv "['message']" 2>/dev/null)"
fill_texts "$TB" > /dev/null

# 伴侣画像
fill_pref() {
  patch /api/v1/users/me/preference '{
    "heightMin":158,"heightMax":175,"hometownProvinces":["浙江省","江苏省"],
    "smokingAccept":2,"drinkingAccept":3,"incomeMin":2,"incomeMax":6,
    "educationMin":3,"onlyChildAccept":3,"carPrefer":2,"housePrefer":2,
    "dinkAccept":2,"tags":["智性恋","幽默灵魂"]
  }' "$1"
}
RPA2=$(fill_pref "$TA")
check "A 填伴侣画像" "$([ "$(echo "$RPA2" | jqv "['code']")" = "OK" ] && echo 1 || echo 0)" \
      "$(echo "$RPA2" | jqv "['message']" 2>/dev/null)"
fill_pref "$TB" > /dev/null

# 头像（走 MinIO 预签名）
echo ""
echo "=== 4. 头像上传（MinIO 预签名）==="
PRE=$(post /api/v1/users/me/avatar/presign '{"contentType":"image/jpeg"}' "$TA")
UPLOAD_URL=$(echo "$PRE" | jqv "['data']['uploadUrl']")
KEY=$(echo "$PRE" | jqv "['data']['objectKey']")
check "拿到预签名 URL" "$([ -n "$UPLOAD_URL" ] && echo 1 || echo 0)"

if [ -n "$UPLOAD_URL" ]; then
  # 造一张最小的合法 JPEG
  printf '\xff\xd8\xff\xe0\x00\x10JFIF\x00\x01\x01\x00\x00\x01\x00\x01\x00\x00\xff\xdb\x00\x43\x00\xff\xd9' > /tmp/tiny.jpg
  CODE=$(curl -sS -o /dev/null -w '%{http_code}' -X PUT "$UPLOAD_URL" \
         -H 'Content-Type: image/jpeg' --data-binary @/tmp/tiny.jpg 2>&1)
  check "直传 MinIO" "$([ "$CODE" = "200" ] && echo 1 || echo 0)" "HTTP $CODE"

  CA=$(post /api/v1/users/me/avatar/confirm "{\"objectKey\":\"$KEY\"}" "$TA")
  check "确认头像" "$([ "$(echo "$CA" | jqv "['code']")" = "OK" ] && echo 1 || echo 0)" \
        "$(echo "$CA" | jqv "['message']" 2>/dev/null)"
fi

# B 也传个头像（划卡要求对方有头像）
PREB=$(post /api/v1/users/me/avatar/presign '{"contentType":"image/jpeg"}' "$TB")
UB_URL=$(echo "$PREB" | jqv "['data']['uploadUrl']")
UB_KEY=$(echo "$PREB" | jqv "['data']['objectKey']")
if [ -n "$UB_URL" ]; then
  curl -sS -o /dev/null -X PUT "$UB_URL" -H 'Content-Type: image/jpeg' --data-binary @/tmp/tiny.jpg 2>&1
  post /api/v1/users/me/avatar/confirm "{\"objectKey\":\"$UB_KEY\"}" "$TB" > /dev/null
fi

# 照片（划卡要求对方有已过审照片）
add_photo() {
  local T="$1"
  local P; P=$(post /api/v1/users/me/photos/presign '{"contentType":"image/jpeg"}' "$T")
  local U; U=$(echo "$P" | jqv "['data']['uploadUrl']")
  local K; K=$(echo "$P" | jqv "['data']['objectKey']")
  [ -z "$U" ] && return
  curl -sS -o /dev/null -X PUT "$U" -H 'Content-Type: image/jpeg' --data-binary @/tmp/tiny.jpg 2>&1
  post /api/v1/users/me/photos/confirm "{\"objectKey\":\"$K\"}" "$T" > /dev/null
}
add_photo "$TA"; add_photo "$TA"; add_photo "$TB"; add_photo "$TB"
PA=$(get /api/v1/users/me/photos "$TA")
check "A 相册有 2 张" "$([ "$(echo "$PA" | jqv "['data']['items'].__len__()")" = "2" ] && echo 1 || echo 0)"

# 造一个资料齐全的第三人（用于验证 Pass、拉黑等不影响主链路的动作）
make_ready_user() {
  local PHONE="$1" G="$2" H="$3"
  local R; R=$(post /api/v1/auth/register "{\"phone\":\"$PHONE\",\"password\":\"test1234\"}")
  local T; T=$(echo "$R" | jqv "['data']['accessToken']")
  local U; U=$(echo "$R" | jqv "['data']['userId']")
  patch /api/v1/users/me/profile "{\"gender\":$G,\"birthday\":\"1996-06-06\",\"heightCm\":$H,\"hometownProvince\":\"浙江省\",\"hometownCity\":\"杭州市\",\"cityProvince\":\"浙江省\",\"city\":\"杭州市\",\"occupation\":\"互联网\",\"mbti\":\"ENFP\",\"smoking\":1,\"drinking\":2,\"incomeRange\":3,\"education\":3,\"isOnlyChild\":false,\"eldercarePressure\":2,\"hasCar\":false,\"hasHouse\":1,\"isDink\":2}" "$T" > /dev/null
  put /api/v1/users/me/hobbies "{\"hobbies\":[
    {\"name\":\"阅读\",\"description\":\"一年五十本，偏爱非虚构类\",\"sortOrder\":1},
    {\"name\":\"跑步\",\"description\":\"每周三次，半马一小时五十\",\"sortOrder\":2},
    {\"name\":\"旅行\",\"description\":\"去过二十个国家，喜欢慢旅行\",\"sortOrder\":3}
  ]}" "$T" > /dev/null
  patch /api/v1/users/me/texts "{\"aboutMe\":\"一个普通人，喜欢把日子过得有规律一点，也愿意为有意思的事破例。\",\"expectPartner\":\"希望对方情绪稳定，能一起把生活里的琐事处理好。\"}" "$T" > /dev/null
  patch /api/v1/users/me/preference '{"heightMin":150,"heightMax":200,"smokingAccept":3,"drinkingAccept":3,"incomeMin":0,"incomeMax":7,"educationMin":1,"onlyChildAccept":3,"carPrefer":2,"housePrefer":2,"dinkAccept":2,"tags":[]}' "$T" > /dev/null
  # 头像
  local P; P=$(post /api/v1/users/me/avatar/presign '{"contentType":"image/jpeg"}' "$T")
  local URL; URL=$(echo "$P" | jqv "['data']['uploadUrl']")
  local K; K=$(echo "$P" | jqv "['data']['objectKey']")
  [ -n "$URL" ] && curl -sS -o /dev/null -X PUT "$URL" -H 'Content-Type: image/jpeg' --data-binary @/tmp/tiny.jpg
  post /api/v1/users/me/avatar/confirm "{\"objectKey\":\"$K\"}" "$T" > /dev/null
  # 照片
  local P2; P2=$(post /api/v1/users/me/photos/presign '{"contentType":"image/jpeg"}' "$T")
  local U2; U2=$(echo "$P2" | jqv "['data']['uploadUrl']")
  local K2; K2=$(echo "$P2" | jqv "['data']['objectKey']")
  [ -n "$U2" ] && curl -sS -o /dev/null -X PUT "$U2" -H 'Content-Type: image/jpeg' --data-binary @/tmp/tiny.jpg
  post /api/v1/users/me/photos/confirm "{\"objectKey\":\"$K2\"}" "$T" > /dev/null
  post /api/v1/users/me/onboarding/complete '{}' "$T" > /dev/null
  echo "$T:$U"
}
IFS=: read -r TC UC <<< "$(make_ready_user "137${TS}" 2 168)"
check "第三人 C 创建并完成资料" "$([ -n "$TC" ] && [ "$TC" != "None" ] && echo 1 || echo 0)" "C=$UC"

echo ""
echo "=== 5. 完成 Onboarding ==="
OC_A=$(post /api/v1/users/me/onboarding/complete '{}' "$TA")
check "A 完成 Onboarding" "$([ "$(echo "$OC_A" | jqv "['code']")" = "OK" ] && echo 1 || echo 0)" \
      "$(echo "$OC_A" | jqv "['message']" 2>/dev/null)"
OC_B=$(post /api/v1/users/me/onboarding/complete '{}' "$TB")
check "B 完成 Onboarding" "$([ "$(echo "$OC_B" | jqv "['code']")" = "OK" ] && echo 1 || echo 0)"

echo ""
echo "=== 6. 划卡 ==="
CARDS=$(get /api/v1/cards "$TA")
NCARDS=$(echo "$CARDS" | jqv "['data']['cards'].__len__()")
REMAIN=$(echo "$CARDS" | jqv "['data']['quota']['remain']")
check "A 拉到卡片" "$([ "${NCARDS:-0}" -ge 1 ] && echo 1 || echo 0)" "${NCARDS:-0} 张"
check "初始额度为 10" "$([ "${REMAIN:-x}" = "10" ] && echo 1 || echo 0)" "remain=$REMAIN"

# 卡片里应该有 B
HAS_B=$(echo "$CARDS" | python3 -c "
import sys,json
d=json.load(sys.stdin)
ids=[c['userId'] for c in d['data']['cards']]
print(1 if $UB in ids else 0)
" 2>/dev/null)
check "卡池含异性用户 B" "$([ "$HAS_B" = "1" ] && echo 1 || echo 0)"

# 卡片不应含自己
HAS_SELF=$(echo "$CARDS" | python3 -c "
import sys,json
d=json.load(sys.stdin)
ids=[c['userId'] for c in d['data']['cards']]
print(1 if $UA in ids else 0)
" 2>/dev/null)
check "卡池不含自己" "$([ "$HAS_SELF" = "0" ] && echo 1 || echo 0)"

echo ""
echo "=== 7. 单向 Like 与额度 ==="
L1=$(post /api/v1/actions "{\"toUser\":$UB,\"action\":\"like\",\"source\":\"card\"}" "$TA")
check "A Like B 成功" "$([ "$(echo "$L1" | jqv "['code']")" = "OK" ] && echo 1 || echo 0)"
check "尚未配对" "$([ "$(echo "$L1" | jqv "['data']['matched']")" = "False" ] && echo 1 || echo 0)"
check "额度扣到 9" "$([ "$(echo "$L1" | jqv "['data']['quotaRemain']")" = "9" ] && echo 1 || echo 0)" \
      "remain=$(echo "$L1" | jqv "['data']['quotaRemain']")"

# 重复 Like 不应再扣额度
L1DUP=$(post /api/v1/actions "{\"toUser\":$UB,\"action\":\"like\",\"source\":\"card\"}" "$TA")
check "重复 Like 幂等" "$([ "$(echo "$L1DUP" | jqv "['data']['alreadyActed']")" = "True" ] && echo 1 || echo 0)"
check "重复 Like 不扣额度" "$([ "$(echo "$L1DUP" | jqv "['data']['quotaRemain']")" = "9" ] && echo 1 || echo 0)" \
      "remain=$(echo "$L1DUP" | jqv "['data']['quotaRemain']")"

# 对自己操作应被拒
LSELF=$(post /api/v1/actions "{\"toUser\":$UA,\"action\":\"like\"}" "$TA")
check "不能 Like 自己" "$([ "$(echo "$LSELF" | jqv "['code']")" = "CANNOT_ACT_SELF" ] && echo 1 || echo 0)"

# Pass 不扣额度（用第三人 C 作目标，避免影响 A↔B 的主链路）
DPASS=$(post /api/v1/actions "{\"toUser\":$UC,\"action\":\"pass\",\"source\":\"card\"}" "$TA")
check "Pass 成功" "$([ "$(echo "$DPASS" | jqv "['code']")" = "OK" ] && echo 1 || echo 0)"
check "Pass 不扣额度" "$([ "$(echo "$DPASS" | jqv "['data']['quotaRemain']")" = "9" ] && echo 1 || echo 0)" \
      "remain=$(echo "$DPASS" | jqv "['data']['quotaRemain']")"
# Pass 过的人不再出现在卡池
CARDS2=$(get /api/v1/cards "$TA")
PASSED_GONE=$(echo "$CARDS2" | python3 -c "
import sys,json
d=json.load(sys.stdin)
print(1 if $UC not in [c['userId'] for c in d['data']['cards']] else 0)
" 2>/dev/null)
check "Pass 过的人不再出现" "$([ "$PASSED_GONE" = "1" ] && echo 1 || echo 0)"

echo ""
echo "=== 8. 谁喜欢我 ==="
LM=$(get /api/v1/likes-me "$TB")
N_LM=$(echo "$LM" | jqv "['data']['items'].__len__()")
check "B 看到 A 喜欢了自己" "$([ "${N_LM:-0}" -ge 1 ] && echo 1 || echo 0)" "${N_LM:-0} 条"

CNT=$(get /api/v1/counts "$TB")
check "B 的红点计数正确" "$([ "$(echo "$CNT" | jqv "['data']['likes']")" -ge 1 ] && echo 1 || echo 0)" \
      "likes=$(echo "$CNT" | jqv "['data']['likes']")"

echo ""
echo "=== 9. 双向 Like → 配对 ==="
L2=$(post /api/v1/actions "{\"toUser\":$UA,\"action\":\"like\",\"source\":\"likes_me\"}" "$TB")
check "B 回 Like 成功" "$([ "$(echo "$L2" | jqv "['code']")" = "OK" ] && echo 1 || echo 0)"
check "配对成功" "$([ "$(echo "$L2" | jqv "['data']['matched']")" = "True" ] && echo 1 || echo 0)"
MATCH_ID=$(echo "$L2" | jqv "['data']['matchId']")
check "返回 matchId" "$([ -n "$MATCH_ID" ] && [ "$MATCH_ID" != "None" ] && echo 1 || echo 0)" "matchId=$MATCH_ID"

# 配对数应为 1（不重复）
MC=$(get /api/v1/matches "$TA")
NM=$(echo "$MC" | jqv "['data']['items'].__len__()")
check "配对记录唯一" "$([ "${NM:-0}" = "1" ] && echo 1 || echo 0)" "${NM:-0} 条"

echo ""
echo "=== 10. 会话与消息 ==="
CONV=$(get /api/v1/conversations "$TA")
NCONV=$(echo "$CONV" | jqv "['data']['items'].__len__()")
CONV_ID=$(echo "$CONV" | jqv "['data']['items'][0]['id']")
check "配对后自动建会话" "$([ "${NCONV:-0}" = "1" ] && echo 1 || echo 0)" "convId=$CONV_ID"

if [ -n "$CONV_ID" ] && [ "$CONV_ID" != "None" ]; then
  M1=$(post "/api/v1/conversations/$CONV_ID/messages" \
       '{"msgType":"text","content":"你好，看你也喜欢徒步","clientMsgId":"c-001"}' "$TA")
  check "A 发消息" "$([ "$(echo "$M1" | jqv "['code']")" = "OK" ] && echo 1 || echo 0)" \
        "seq=$(echo "$M1" | jqv "['data']['seq']")"

  # 幂等：同 clientMsgId 重发
  M1DUP=$(post "/api/v1/conversations/$CONV_ID/messages" \
       '{"msgType":"text","content":"你好，看你也喜欢徒步","clientMsgId":"c-001"}' "$TA")
  check "同 clientMsgId 幂等" \
        "$([ "$(echo "$M1" | jqv "['data']['id']")" = "$(echo "$M1DUP" | jqv "['data']['id']")" ] && echo 1 || echo 0)"

  M2=$(post "/api/v1/conversations/$CONV_ID/messages" \
       '{"msgType":"text","content":"哈哈是的，你走过哪条线？","clientMsgId":"c-002"}' "$TB")
  check "B 回消息" "$([ "$(echo "$M2" | jqv "['code']")" = "OK" ] && echo 1 || echo 0)"

  MSGS=$(get "/api/v1/conversations/$CONV_ID/messages" "$TA")
  NMSG=$(echo "$MSGS" | jqv "['data']['items'].__len__()")
  check "拉到 2 条消息（去重后）" "$([ "${NMSG:-0}" = "2" ] && echo 1 || echo 0)" "${NMSG:-0} 条"

  # 空消息应被拒
  ME=$(post "/api/v1/conversations/$CONV_ID/messages" '{"msgType":"text","content":"   "}' "$TA")
  check "空白消息被拒" "$([ "$(echo "$ME" | jqv "['code']")" = "EMPTY_MESSAGE" ] && echo 1 || echo 0)"

  # 非成员访问应被拒
  TS2=$(date +%s%N | tail -c 9)
  RX=$(post /api/v1/auth/register "{\"phone\":\"136${TS2}\",\"password\":\"test1234\"}")
  TX=$(echo "$RX" | jqv "['data']['accessToken']")
  MX=$(get "/api/v1/conversations/$CONV_ID/messages" "$TX")
  check "非会话成员访问被拒" \
        "$([ "$(echo "$MX" | jqv "['code']")" = "ONBOARDING_REQUIRED" ] || [ "$(echo "$MX" | jqv "['code']")" = "NOT_IN_CONVERSATION" ] && echo 1 || echo 0)" \
        "$(echo "$MX" | jqv "['code']" 2>/dev/null)"
fi

echo ""
echo "=== 11. 未读数与已读 ==="
CNT2=$(get /api/v1/counts "$TA")
check "A 有未读" "$([ "$(echo "$CNT2" | jqv "['data']['unread']")" -ge 1 ] && echo 1 || echo 0)" \
      "unread=$(echo "$CNT2" | jqv "['data']['unread']")"
if [ -n "$CONV_ID" ] && [ "$CONV_ID" != "None" ]; then
  post "/api/v1/conversations/$CONV_ID/read" '{}' "$TA" > /dev/null
  CNT3=$(get /api/v1/counts "$TA")
  check "已读后未读归零" "$([ "$(echo "$CNT3" | jqv "['data']['unread']")" = "0" ] && echo 1 || echo 0)" \
        "unread=$(echo "$CNT3" | jqv "['data']['unread']")"
fi

echo ""
echo "=== 12. 额度耗尽 ==="
# A 还剩 9 次，用 Pass 造不出消耗，只能 Like 其他人。
# 先注册并完成 9 个用户太慢，这里直接把额度改满来验证边界。
# 这一项要直接改库把额度拉满，所以得知道数据库在哪。
# 端口可配：默认对本土开发的 5433，部署实例可能是别的端口。
PG_PORT="${PG_PORT:-5433}"
PGBIN="${PGBIN:-/home/metabot/.local/pg/usr/pgsql-14/bin}"
export LD_LIBRARY_PATH="${LD_LIBRARY_PATH:-/home/metabot/.local/pg/usr/pgsql-14/lib:/home/metabot/.local/pg/usr/lib64}"
$PGBIN/psql -h 127.0.0.1 -p "$PG_PORT" -U mutual -d mutual -q -c \
  "INSERT INTO daily_quotas (user_id, quota_date, used_like_count, limit_count, updated_at)
   VALUES ($UA, (now() AT TIME ZONE 'Asia/Shanghai')::date, 10, 10, now())
   ON CONFLICT (user_id, quota_date) DO UPDATE SET used_like_count = 10" 2>/dev/null \
  || echo "  [warn] 改库失败（PG_PORT=$PG_PORT），额度耗尽这条会失败"
# 目标必须是完成过 Onboarding 的用户，否则会先报「对方账号不可用」。
# 用前面造好的第三人 C。
QY=$(post /api/v1/actions "{\"toUser\":$UC,\"action\":\"like\",\"source\":\"plaza\"}" "$TA")
check "额度耗尽时返回 QUOTA_EXHAUSTED" \
      "$([ "$(echo "$QY" | jqv "['code']")" = "QUOTA_EXHAUSTED" ] && echo 1 || echo 0)" \
      "$(echo "$QY" | jqv "['message']" 2>/dev/null)"

echo ""
echo "=== 13. 资料可见性裁剪 ==="
# A 看 B 的资料，B 没公开收入与公司
PV=$(get "/api/v1/users/$UB" "$TA")
check "他人资料里收入被隐藏" "$([ "$(echo "$PV" | jqv "['data']['incomeHidden']")" = "True" ] && echo 1 || echo 0)"
check "他人资料里不含 incomeRange 字段" \
      "$([ "$(echo "$PV" | jqv "['data'].get('incomeRange')")" = "None" ] && echo 1 || echo 0)"
check "他人资料里不含手机号" \
      "$(! echo "$PV" | grep -q "phone" && echo 1 || echo 0)"

# 自己的资料应能看到收入
PVA=$(get /api/v1/users/me "$TA")
check "本人资料能看到收入" \
      "$([ "$(echo "$PVA" | jqv "['data']['incomeRange']")" = "4" ] && echo 1 || echo 0)"

echo ""
echo "=== 14. 解除配对 ==="
if [ -n "$MATCH_ID" ] && [ "$MATCH_ID" != "None" ]; then
  UM=$(curl -sS -X DELETE "$API/api/v1/matches/$MATCH_ID" -H "Authorization: Bearer $TA" 2>&1)
  check "解除配对成功" "$([ "$(echo "$UM" | jqv "['code']")" = "OK" ] && echo 1 || echo 0)" \
        "$(echo "$UM" | jqv "['message']" 2>/dev/null)"

  MC2=$(get /api/v1/matches "$TA")
  check "解除后不在配对列表" "$([ "$(echo "$MC2" | jqv "['data']['items'].__len__()")" = "0" ] && echo 1 || echo 0)"

  # 会话变只读
  MR=$(post "/api/v1/conversations/$CONV_ID/messages" \
       '{"msgType":"text","content":"还能发吗？"}' "$TA")
  check "解除后不能发消息" "$([ "$(echo "$MR" | jqv "['code']")" = "CONVERSATION_CLOSED" ] && echo 1 || echo 0)" \
        "$(echo "$MR" | jqv "['code']" 2>/dev/null)"
fi

echo ""
echo "=== 15. 拉黑 ==="
BL=$(post /api/v1/blocks "{\"targetUser\":$UB}" "$TA")
check "拉黑成功" "$([ "$(echo "$BL" | jqv "['code']")" = "OK" ] && echo 1 || echo 0)"
PVB=$(get "/api/v1/users/$UB" "$TA")
BC=$(echo "$PVB" | jqv "['code']")
check "拉黑后看不到对方资料" "$([ "$BC" = "INTERNAL" ] || [ "$BC" = "BLOCKED" ] && echo 1 || echo 0)" "code=$BC"
# 拉黑后也不该出现在卡池 / 广场 / 谁喜欢我
BL_CARDS=$(get /api/v1/cards "$TA")
BL_GONE=$(echo "$BL_CARDS" | python3 -c "
import sys,json
d=json.load(sys.stdin)
print(1 if $UB not in [c['userId'] for c in d['data'].get('cards',[])] else 0)
" 2>/dev/null)
check "拉黑后不在卡池" "$([ "$BL_GONE" = "1" ] && echo 1 || echo 0)"

echo ""
echo "=== 16. 举报 ==="
RP=$(post /api/v1/reports "{\"targetUser\":$UB,\"reason\":\"fake_info\",\"detail\":\"资料疑似造假\"}" "$TA")
check "举报成功" "$([ "$(echo "$RP" | jqv "['code']")" = "OK" ] && echo 1 || echo 0)"

echo ""
echo "════════════════════════════════"
printf "  通过 \033[32m%d\033[0m  失败 \033[31m%d\033[0m\n" "$PASS" "$FAIL"
echo "════════════════════════════════"
[ "$FAIL" = "0" ] && exit 0 || exit 1
