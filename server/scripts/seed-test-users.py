#!/usr/bin/env python3
"""给相悦造一批能划卡的测试用户（**只在测试环境用**，走真实 API，不直接写库）。

用法（在 server/ 目录下）：
    python3 scripts/seed-test-users.py                          # 第一批：14 个候选（13900000101~114）
    python3 scripts/seed-test-users.py --offset 115 --count 30   # 再补 30 个（13900000115~144）
    python3 scripts/seed-test-users.py --offset 115 --count 30 --likers 1,2,3
    python3 scripts/seed-test-users.py --clean                   # 打印删除用的 SQL

约定：手机号 = 13900000 + 三位序号，密码都是 test1234——
想从"对方"那侧看效果，可以直接用这些号登录。
默认 5 个会先喜欢 TARGET_UID（--likers 可改）——右划就立刻配对。

**为什么要能指定 offset**：一张卡被操作过（喜欢/跳过/**看过**）就再也不会出现，
所以测试账号划完一批就得补一批。offset 同时决定名字/职业/学校等取自哪个池位，
所以第二批不会和第一批重名。重跑同一段 offset 是幂等的（已建好的会跳过）。

每个候选走完整流程：注册 → 填资料 → 传 3 张照片 + 1 张头像 → 兴趣/自述/伴侣偏好
→ 完成 onboarding（全程走 API，所以顺带验证了这些接口是通的）。

只依赖标准库；占位照片由内嵌的 Go 程序生成（需要 golang.org/x/image）。
"""
import base64
import hashlib
import hmac
import json
import os
import sys
import time
import urllib.request
import urllib.error

BASE = "http://127.0.0.1:8099/api/v1"

# 生成占位照片：竖向渐变 + 左上角编号，够区分就行。
# 索引从命令行取，这样"再补一批"时只生成缺的那几张，不用全量重画。
GENPHOTOS_GO = r'''
package main

import (
	"fmt"
	"image"
	"image/color"
	"image/draw"
	"image/jpeg"
	"os"
	"strconv"

	"golang.org/x/image/font"
	"golang.org/x/image/font/basicfont"
	"golang.org/x/image/math/fixed"
	xdraw "golang.org/x/image/draw"
)

func main() {
	// 参数：start end（闭开区间，序号从 0 起）
	start, _ := strconv.Atoi(os.Args[1])
	end, _ := strconv.Atoi(os.Args[2])

	palettes := [][2]color.RGBA{
		{{0xF2, 0x8B, 0x9C, 0}, {0x8E, 0x44, 0xAD, 0}}, {{0x74, 0xB9, 0xFF, 0}, {0x2A, 0x4C, 0x8F, 0}},
		{{0xFF, 0xC3, 0x71, 0}, {0xE0, 0x6C, 0x37, 0}}, {{0x8F, 0xE3, 0xC0, 0}, {0x2C, 0x7A, 0x5E, 0}},
		{{0xFF, 0x9A, 0x9A, 0}, {0xA6, 0x2E, 0x2E, 0}}, {{0xB5, 0xA6, 0xFF, 0}, {0x4A, 0x3F, 0x8F, 0}},
		{{0xFF, 0xE0, 0x8A, 0}, {0xB8, 0x86, 0x0B, 0}}, {{0x9B, 0xDE, 0xFF, 0}, {0x1B, 0x5E, 0x7A, 0}},
		{{0xF7, 0xA8, 0xD8, 0}, {0x8E, 0x2C, 0x6E, 0}}, {{0xC5, 0xE1, 0xA5, 0}, {0x4B, 0x6E, 0x1F, 0}},
		{{0xFF, 0xB4, 0x8A, 0}, {0x9C, 0x4A, 0x22, 0}}, {{0xA8, 0xD8, 0xEA, 0}, {0x2F, 0x5B, 0x6E, 0}},
	}
	const W, H = 900, 1200
	for i := start; i < end; i++ {
		for j := 1; j <= 3; j++ {
			img := image.NewRGBA(image.Rect(0, 0, W, H))
			top, bot := palettes[i%len(palettes)][0], palettes[i%len(palettes)][1]
			for y := 0; y < H; y++ {
				t := float64(y) / float64(H-1)
				c := color.RGBA{
					uint8(float64(top.R)*(1-t) + float64(bot.R)*t),
					uint8(float64(top.G)*(1-t) + float64(bot.G)*t),
					uint8(float64(top.B)*(1-t) + float64(bot.B)*t), 255,
				}
				draw.Draw(img, image.Rect(0, y, W, y+1), &image.Uniform{c}, image.Point{}, draw.Src)
			}
			// 编号放在视觉重心偏上，缩略图里也看得见。用三位数，
			// 和手机号后三位对齐——出问题时能一眼对上是谁。
			label := fmt.Sprintf("%03d-%d", i+1, j)
			small := image.NewRGBA(image.Rect(0, 0, 320, 120))
			d2 := &font.Drawer{Dst: small, Src: &image.Uniform{color.RGBA{255, 255, 255, 255}},
				Face: basicfont.Face7x13, Dot: fixed.P(10, 60)}
			d2.DrawString(label)
			xdraw.NearestNeighbor.Scale(img, image.Rect(60, 80, 60+640, 80+240), small, small.Bounds(), xdraw.Over, nil)
			f, err := os.Create(fmt.Sprintf("/tmp/seedimg/%03d-%d.jpg", i+1, j))
			if err != nil {
				panic(err)
			}
			if err := jpeg.Encode(f, img, &jpeg.Options{Quality: 88}); err != nil {
				panic(err)
			}
			f.Close()
		}
	}
	fmt.Println("生成完毕", start, end)
}
'''


def ensure_photos(start, end):
    """生成 [start, end) 这段序号的占位照片（已存在的跳过）。"""
    import subprocess, shutil
    need = [f"/tmp/seedimg/{i+1:03d}-{j}.jpg" for i in range(start, end) for j in (1, 2, 3)]
    if all(os.path.exists(p) for p in need):
        return
    os.makedirs("/tmp/seedimg", exist_ok=True)
    tmp = "/tmp/seedphotogen"
    os.makedirs(tmp, exist_ok=True)
    with open(tmp + "/main.go", "w") as f:
        f.write(GENPHOTOS_GO)

    go = shutil.which("go") or os.path.expanduser("~/.local/go/bin/go")
    gopath = os.path.expanduser("~/.local/gopath")
    env = dict(os.environ,
               GOPATH=gopath,
               GOCACHE=os.path.expanduser("~/.local/gocache"),
               GOFLAGS="-mod=mod",
               # 这台机器出网受限，把**本地模块缓存**当代理用：
               # golang.org/x/image 以前下过一次，就在 pkg/mod/cache/download 里。
               # 不这么设的话 `go run` 会先去 proxy.golang.org 拉取然后卡住。
               GOPROXY="file://" + gopath + "/pkg/mod/cache/download",
               GOSUMDB="off", GONOSUMDB="*", GONOSUMCHECK="1")
    # go run 需要一个 module；临时目录里只有 main.go，之前这里一直报
    # "go.mod file not found"。只在缺 go.mod 时初始化，别每次都去动它。
    if not os.path.exists(tmp + "/go.mod"):
        subprocess.run([go, "mod", "init", "seedphotogen"], cwd=tmp, check=True, env=env,
                       stdout=subprocess.DEVNULL)
        subprocess.run([go, "get", "golang.org/x/image@latest"], cwd=tmp, check=True, env=env,
                       stdout=subprocess.DEVNULL)
    subprocess.run([go, "run", ".", str(start), str(end)], cwd=tmp, check=True, env=env)


SECRET = b"0123456789012345678901234567890123456789abcdef"
# 默认：你的账号（库里 id=1 那个男号）
TARGET_UID = int(os.environ.get("TARGET_UID", "1"))

# 第一批的起始序号：手机号 13900000101
BASE_INDEX = 101
# 池子的起点。第二批（offset 115）从池位 14 开始，所以不会和第一批重名
POOL_ORIGIN = 101

NAMES = ["小晴", "安然", "橘子", "阿May", "林洛", "苏禾", "亦栀", "April",
         "柚子", "南栀", "小满", "禾禾", "可可", "星野",
         "温言", "白露", "青禾", "沈知", "阮清", "叶檀", "柳絮", "简宁",
         "孟夏", "钟灵", "顾晚", "陆离", "江雪", "程澄", "许棠", "宋辞",
         "云舒", "祝安", "闻笛", "裴然", "倪好", "祁月", "应梓", "岳溪",
         "石蕊", "崔颖", "傅晴", "樊星", "卫蓝", "蒋禾", "邓秋", "毛豆",
         "尹夏", "严冬", "华筝", "金禾", "魏然", "陶子", "姜饼", "戚薇",
         "谢桥", "邹雨", "柏舟", "水杉", "兰舟", "燕西"]
HOMETOWNS = ["浙江省", "江苏省", "四川省", "广东省", "湖北省", "山东省", "福建省",
             "湖南省", "安徽省", "河南省", "江西省", "陕西省", "辽宁省", "云南省",
             "河北省", "山西省", "吉林省", "黑龙江省", "广西壮族自治区", "贵州省"]
OCCUPATIONS = ["互联网/IT · 产品经理", "金融 · 银行", "教育/科研 · 中小学教师",
               "医疗健康 · 护士", "文化传媒/广告 · 平面设计", "商贸/零售 · 电商运营",
               "金融 · 会计/审计", "互联网/IT · 设计师", "政府/公共事业 · 事业单位",
               "教育/科研 · 高校教师", "文化传媒/广告 · 记者/编辑", "制造/工业 · 质量管理",
               "生活服务 · 健身教练", "互联网/IT · 运营", "医疗健康 · 药师",
               "金融 · 证券/基金", "教育/科研 · 培训讲师", "文化传媒/广告 · 新媒体运营",
               "专业服务 · 律师", "专业服务 · 咨询顾问", "房地产/建筑 · 室内设计",
               "互联网/IT · 测试工程师", "交通/物流 · 供应链", "旅游/酒店 · 门店管理",
               "能源/环保 · 工程师", "农业 · 技术推广", "艺术 · 插画师",
               "金融 · 保险", "医疗健康 · 心理咨询师", "政府/公共事业 · 公务员"]
SCHOOLS = ["复旦大学", "上海交通大学", "同济大学", "华东师范大学", "上海大学",
           "东华大学", "上海财经大学", "华东理工大学", "浙江大学", "南京大学",
           "上海外国语大学", "上海师范大学", "苏州大学", "江南大学", "上海理工大学",
           "上海海事大学", "上海中医药大学", "上海音乐学院", "武汉大学", "厦门大学",
           "中山大学", "四川大学", "山东大学", "吉林大学", "南开大学", "天津大学",
           "东南大学", "湖南大学", "郑州大学", "兰州大学"]
COMPANIES = ["某互联网公司", "某银行上海分行", "某中学", "某三甲医院", "某广告公司",
             "某电商平台", "某会计师事务所", "某设计工作室", "某事业单位", "某高校",
             "某报社", "某制造企业", "某健身连锁", "某创业公司", "某连锁药店",
             "某证券公司", "某培训机构", "某文化公司", "某律所", "某咨询公司",
             "某建筑设计院", "某软件公司", "某物流公司", "某酒店集团",
             "某能源公司", "某农业科技公司", "某画室", "某保险公司",
             "某心理咨询中心", "某政府机关"]
MBTIS = ["ENFP", "INFJ", "ISFJ", "ENTP", "INFP", "ESTJ", "ESFP", "INTJ", "ENFJ",
         "ISTP", "ISFP", "ENTJ", "ESFJ", "INTP", "ENFJ", "ISTJ", "ESTP", "ENTJ",
         "INFP", "ISFJ", "ENTP", "ESFP", "INTJ", "INFJ", "ESTJ", "ISFP", "ENFP",
         "ISTP", "ESFJ", "INTP"]
MESSAGES = [
    "周末一般泡在美术馆或者咖啡馆，最近在学做甜点，失败了三次。",
    "喜欢爬山和跑步，也喜欢窝在家里看老电影，看你像哪种？",
    "养了一只叫豆豆的猫，它比我上镜多了。",
    "在读一本讲城市变迁的书，看到好看的字句会抄下来。",
    "喜欢逛菜市场，看到新鲜的菜就想试试新菜谱。",
    "常去livehouse，也喜欢安静地听唱片。",
    "每年会一个人出去玩一次，去年去的青海湖。",
    "健身两年了，目标是能做一个标准的引体向上。",
    "喜欢拍照，主要是拍街上的光影和路过的人。",
    "最近迷上了手冲咖啡，磨豆子的声音很治愈。",
    "喜欢看话剧和展览，也愿意陪人逛一整天的书店。",
    "做饭还行，拿手菜是番茄牛腩。",
    "喜欢骑行，周末会沿江骑二三十公里。",
    "学的是设计，平时会画一点小插画。",
    "每天下班会去江边散步，天气好的时候能碰到很漂亮的晚霞。",
    "在学吉他，目前只会四个和弦，但很快乐。",
    "喜欢逛旧书店和跳蚤市场，家里攒了一堆没用的东西。",
    "养了两盆绿植，居然都还活着。",
    "喜欢看纪录片，最近在补自然类的那几部。",
    "会一点点陶艺，拉坯的时候特别解压。",
    "周末常去打羽毛球，水平一般但很上头。",
    "喜欢一个人去看早场电影，人少，很安静。",
    "在攒钱想去一次北欧，看极光。",
    "喜欢做手账，虽然写得不好看。",
    "爱看推理小说，猜凶手十次错九次。",
    "喜欢逛公园，看别人遛狗，自己还没敢养。",
    "学过三年钢琴，现在只会弹一首。",
    "喜欢做面包，最成功的一次是碱水结。",
    "常去游泳，一次能游一千米。",
    "喜欢听播客，通勤路上全靠它。",
]
EXPECTS = [
    "希望你是个愿意好好说话的人，有好奇心，也愿意一起做点没什么用的事。",
    "希望对方真诚、稳定，能一起把日子过得有意思一点，不急着下结论。",
    "喜欢有自己热爱之事的人，聊得来最重要，也希望你愿意分享你的那份热爱。",
    "希望你有分寸感，也有生活情趣，能一起把平常的日子过得像样一点。",
    "希望你情绪稳定，遇事能商量、不冷战，愿意把话说开而不是憋着。",
    "希望我们能一起吃很多顿饭，走很多段路，慢慢把彼此的生活过成一件事。",
    "希望你爱笑，也允许我偶尔不开心，在一起的时候不用一直端着。",
    "希望你有边界感，对生活还有一点期待，也愿意为了在意的人花时间。",
]
# 服务端要求 20–500 字（service.aboutMeMin/Max）。字数不够会整批卡在
# PATCH /users/me/texts 那一步，而那时照片已经传上去了——收拾起来很麻烦。
# 所以在这里先自己拦一道，别再靠跑一遍才发现。
assert all(20 <= len(e) <= 500 for e in EXPECTS), "EXPECTS 里有条目不满足 20–500 字"


def req(method, path, body=None, token=None, cookie=None, raw=None, ctype=None):
    # media 的 PUT 路径是 "/api/v1/media/..."（presign 返回的就是这个），
    # 不能再拼一次 BASE，否则会变成 /api/v1/api/v1/... 直接 404
    if path.startswith("/api/"):
        url = "http://127.0.0.1:8099" + path
    else:
        url = path if path.startswith("http") else BASE + path
    data = None
    headers = {}
    if raw is not None:
        data = raw
        headers["Content-Type"] = ctype or "image/jpeg"
    elif body is not None:
        data = json.dumps(body).encode()
        headers["Content-Type"] = "application/json"
    if token:
        headers["Authorization"] = "Bearer " + token
    if cookie:
        headers["Cookie"] = cookie
    r = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(r, timeout=30) as resp:
            return resp.status, json.loads(resp.read().decode() or "{}")
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.loads(e.read().decode() or "{}")
        except Exception:
            return e.code, {}


# /auth/* 按 IP 限流 30 次/分钟（router.go: RateLimitByIP(..., "auth", 30, time.Minute)）。
# 批量造号必然撞上——所以两个措施一起上：**每次 auth 调用之间拉开间隔**，
# 再加一层退避重试兜底。不然造到一半整批 429，得手工重跑才发现。
AUTH_PACE = 2.2
_auth_last = [0.0]


def auth_req(method, path, body=None, tries=8):
    gap = AUTH_PACE - (time.time() - _auth_last[0])
    if gap > 0:
        time.sleep(gap)
    st, r = None, None
    for k in range(tries):
        st, r = req(method, path, body=body)
        _auth_last[0] = time.time()
        if st != 429:
            return st, r
        print(f"    · 触发限流，等 25s 重试（{k + 1}/{tries}）")
        time.sleep(25)
    return st, r


def media_cookie(token):
    """读图 cookie 由服务端自己签发：带 Bearer 请求一次，从 Set-Cookie 里取。

    不要自己签——生产的 JWT_SECRET 是部署时随机的，存在 root 只读的 api.env 里，
    外面拿不到（自己签出来的会被判 401）。
    """
    r = urllib.request.Request(BASE + "/users/me", headers={"Authorization": "Bearer " + token})
    with urllib.request.urlopen(r, timeout=20) as resp:
        raw = resp.headers.get("Set-Cookie", "")
    for part in raw.split(";"):
        if part.strip().startswith("mutual_media="):
            return part.strip()
    raise RuntimeError("服务端没有下发读图 cookie：" + raw[:120])


def upload_photo(uid, token, cookie, path):
    """presign → PUT → confirm，和 App 里走的是同一条链路"""
    st, r = req("POST", "/users/me/photos/presign", {"contentType": "image/jpeg"}, token=token)
    if st != 200:
        raise RuntimeError(f"presign 失败 {st} {r}")
    up = r["data"]["uploadUrl"]
    with open(path, "rb") as f:
        st, _ = req("PUT", up, raw=f.read(), cookie=cookie)
    if st != 200:
        raise RuntimeError(f"上传失败 {st}")
    st, r = req("POST", "/users/me/photos/confirm", {"objectKey": r["data"]["objectKey"]}, token=token)
    if st != 200:
        raise RuntimeError(f"confirm 失败 {st} {r}")
    return r["data"]["url"]


def upload_avatar(uid, token, cookie, path):
    st, r = req("POST", "/users/me/avatar/presign", {"contentType": "image/jpeg"}, token=token)
    if st != 200:
        raise RuntimeError(f"头像 presign 失败 {st} {r}")
    up = r["data"]["uploadUrl"]
    with open(path, "rb") as f:
        st, _ = req("PUT", up, raw=f.read(), cookie=cookie)
    if st != 200:
        raise RuntimeError(f"头像上传失败 {st}")
    st, r = req("POST", "/users/me/avatar/confirm", {"objectKey": r["data"]["objectKey"]}, token=token)
    if st != 200:
        raise RuntimeError(f"头像 confirm 失败 {st} {r}")


def parse_list(flag, argv):
    """--likers 1,2,3 → {1,2,3}（批内序号，1 起）"""
    if flag not in argv:
        return set()
    v = argv[argv.index(flag) + 1]
    return {int(x) for x in v.split(",") if x.strip()}


def parse_opt(flag, argv, default):
    return int(argv[argv.index(flag) + 1]) if flag in argv else default


if "--clean" in sys.argv:
    print("删掉测试用户（手机号 13900000101 起）并在库里执行：")
    print("  DELETE FROM users WHERE phone LIKE '139000001%';")
    sys.exit(0)

OFFSET = parse_opt("--offset", sys.argv, BASE_INDEX)
N = parse_opt("--count", sys.argv, 14)
LIKERS = parse_list("--likers", sys.argv) or {1, 3, 4, 7, 11}
VISITORS = parse_list("--visitors", sys.argv)

# 池位：第一批 offset=101 → 从 0 开始；第二批 offset=115 → 从 14 开始，不重名
POOL0 = OFFSET - POOL_ORIGIN
ensure_photos(POOL0, POOL0 + N)

created = []
for i in range(N):
    idx = POOL0 + i
    num = OFFSET + i
    phone = f"13900000{num:03d}"
    name = NAMES[idx % len(NAMES)]
    st, r = auth_req("POST", "/auth/register", {"phone": phone, "password": "test1234"})
    if st != 200:
        # 上次跑到一半留下的号：直接登录接着补
        st2, r2 = auth_req("POST", "/auth/login", {"phone": phone, "password": "test1234"})
        if st2 != 200:
            print(f"  ✗ {phone} 注册/登录都失败 {st} {r} / {st2} {r2}")
            continue
        r = r2
    uid = r["data"]["userId"]
    token = r["data"]["accessToken"]
    # **只有照片是"补"，不是"再做一遍"**：其余每一步都幂等（PATCH/PUT 是覆盖，
    # onboarding/complete 可以重复调）。所以中途失败的人重跑时能从断点续上，
    # 不会因为"已经有照片了"被整个跳过而永远停在半成品状态。
    st0, r0 = req("GET", "/users/me/photos", token=token)
    has_photos = st0 == 200 and len(r0.get("data", {}).get("items", []) or []) >= 3
    if has_photos:
        print(f"  · {name} 已有照片，只补后续步骤")

    age = 24 + (idx % 9)
    year = 2026 - age

    st, r = req("PATCH", "/users/me/profile", {
        # 昵称**必须显式设**：注册接口只给一个占位名（"用户"+手机号后四位），
        # 卡片上会显示成一串编号，看着完全不像真人。服务端要求 2–12 字。
        "nickname": name,
        "gender": 2,
        "birthday": f"{year}-{idx % 12 + 1:02d}-{idx % 28 + 1:02d}",
        "heightCm": 155 + (idx * 7) % 18,
        "weightKg": 45 + (idx * 3) % 18,
        "hometownProvince": HOMETOWNS[idx % len(HOMETOWNS)], "hometownCity": HOMETOWNS[idx % len(HOMETOWNS)],
        # 全部落在上海市：候选召回第一段是**同城**硬过滤，只有同城的才会出现在
        # 你的卡里；放到别的城市等于造了看不见的数据。
        "cityProvince": "上海市", "city": "上海市",
        "occupation": OCCUPATIONS[idx % len(OCCUPATIONS)],
        "mbti": MBTIS[idx % len(MBTIS)],
        "smoking": 1, "drinking": 1 + (idx % 2),
        "incomeRange": 2 + (idx % 4),
        "education": 2 + (idx % 3),
        "school": SCHOOLS[idx % len(SCHOOLS)], "company": COMPANIES[idx % len(COMPANIES)],
        "isOnlyChild": bool(idx % 2), "eldercarePressure": 1 + (idx % 2),
        "hasCar": bool(idx % 3), "hasHouse": 1 + (idx % 3), "isDink": 2,
        "weightPublic": True, "incomePublic": True, "companyPublic": True,
    }, token=token)
    if st != 200:
        print(f"  ✗ {name} 资料失败 {st} {r}")
        continue

    first_url = None
    if has_photos:
        # 续跑：头像和照片都已经在了，不再重传（重传会变成 6 张）
        first_url = (r0.get("data", {}).get("items") or [{}])[0].get("url", "")
    else:
        cookie = media_cookie(token)
        for j in (1, 2, 3):
            url = upload_photo(uid, token, cookie, f"/tmp/seedimg/{idx+1:03d}-{j}.jpg")
            if j == 1:
                first_url = url
        upload_avatar(uid, token, cookie, f"/tmp/seedimg/{idx+1:03d}-2.jpg")

    st, r = req("PUT", "/users/me/hobbies", {"hobbies": [
        {"name": "摄影", "description": MESSAGES[idx % len(MESSAGES)], "sortOrder": 1},
        {"name": "美食", "description": MESSAGES[(idx + 3) % len(MESSAGES)], "sortOrder": 2},
        {"name": "旅行", "description": MESSAGES[(idx + 7) % len(MESSAGES)], "sortOrder": 3},
    ]}, token=token)
    if st != 200:
        print(f"  ✗ {name} 兴趣失败 {st} {r}")
        continue
    st, r = req("PATCH", "/users/me/texts", {
        "aboutMe": f"我是{name}，在上海工作和生活。{MESSAGES[idx % len(MESSAGES)]}",
        "expectPartner": EXPECTS[idx % len(EXPECTS)],
    }, token=token)
    if st != 200:
        print(f"  ✗ {name} 自述失败 {st} {r}")
        continue
    st, r = req("PATCH", "/users/me/preference", {
        "heightMin": 165, "heightMax": 195, "hometownProvinces": [],
        "smokingAccept": 3, "drinkingAccept": 3, "incomeMin": 0, "incomeMax": 7,
        "educationMin": 0, "onlyChildAccept": 3, "carPrefer": 2, "housePrefer": 2,
        "dinkAccept": 1, "tags": [],
    }, token=token)
    if st != 200:
        print(f"  ✗ {name} 伴侣偏好失败 {st} {r}")
        continue

    st, r = req("POST", "/users/me/onboarding/complete", {}, token=token)
    if st != 200:
        print(f"  ✗ {name} 完成 onboarding 失败 {st} {r}")
        continue

    if i + 1 in LIKERS:
        req("POST", "/actions", {"toUser": TARGET_UID, "action": "like"}, token=token)
    elif i + 1 in VISITORS:
        req("POST", "/actions", {"toUser": TARGET_UID, "action": "visit"}, token=token)

    created.append((uid, phone, name, age, first_url))
    print(f"  ✓ {uid:>3} {name:<6} {age}岁  {phone}")

print(f"\n共建成 {len(created)} 个")
print("PHONES=" + ",".join(p for _, p, _, _, _ in created))
