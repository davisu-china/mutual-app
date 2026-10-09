#!/usr/bin/env python3
"""给相悦造一批能划卡的测试用户（**只在测试环境用**，走真实 API，不直接写库）。

用法（在 server/ 目录下）：
    python3 scripts/seed-test-users.py            # 造 14 个候选
    python3 scripts/seed-test-users.py --clean    # 删掉它们

约定：手机号固定在 13900000101~13900000114，密码都是 test1234——
想从"对方"那侧看效果，可以直接用这些号登录。
其中 5 个会先喜欢 TARGET_UID（默认 1）——右划就立刻配对，3 个只"看过你"。
每个候选走完整流程：注册 → 填资料 → 传 3 张照片 + 1 张头像 → 兴趣/自述/伴侣偏好
→ 完成 onboarding（全程走 API，所以顺带验证了这些接口是通的）。

只依赖标准库；图片由 /tmp/genphotos.go 生成。
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
GENPHOTOS_GO = r'''
package main

import (
	"fmt"
	"image"
	"image/color"
	"image/draw"
	"image/jpeg"
	"os"

	"golang.org/x/image/font"
	"golang.org/x/image/font/basicfont"
	"golang.org/x/image/math/fixed"
	xdraw "golang.org/x/image/draw"
)

func main() {
	// 12 个候选 × 3 张：竖向渐变 + 左上角编号，够区分就行
	palettes := [][2]color.RGBA{
		{{0xF2, 0x8B, 0x9C, 0}, {0x8E, 0x44, 0xAD, 0}}, {{0x74, 0xB9, 0xFF, 0}, {0x2A, 0x4C, 0x8F, 0}},
		{{0xFF, 0xC3, 0x71, 0}, {0xE0, 0x6C, 0x37, 0}}, {{0x8F, 0xE3, 0xC0, 0}, {0x2C, 0x7A, 0x5E, 0}},
		{{0xFF, 0x9A, 0x9A, 0}, {0xA6, 0x2E, 0x2E, 0}}, {{0xB5, 0xA6, 0xFF, 0}, {0x4A, 0x3F, 0x8F, 0}},
		{{0xFF, 0xE0, 0x8A, 0}, {0xB8, 0x86, 0x0B, 0}}, {{0x9B, 0xDE, 0xFF, 0}, {0x1B, 0x5E, 0x7A, 0}},
		{{0xF7, 0xA8, 0xD8, 0}, {0x8E, 0x2C, 0x6E, 0}}, {{0xC5, 0xE1, 0xA5, 0}, {0x4B, 0x6E, 0x1F, 0}},
		{{0xFF, 0xB4, 0x8A, 0}, {0x9C, 0x4A, 0x22, 0}}, {{0xA8, 0xD8, 0xEA, 0}, {0x2F, 0x5B, 0x6E, 0}},
	}
	const W, H = 900, 1200
	for i := 0; i < 14; i++ {
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
			// 编号放在视觉重心偏上，缩略图里也看得见
			label := fmt.Sprintf("%02d-%d", i+1, j)
			d := &font.Drawer{Dst: img, Src: &image.Uniform{color.RGBA{255, 255, 255, 255}},
				Face: basicfont.Face7x13, Dot: fixed.P(60, 120)}
			// 放大文字：先画到小图再放大
			small := image.NewRGBA(image.Rect(0, 0, 320, 120))
			d2 := &font.Drawer{Dst: small, Src: &image.Uniform{color.RGBA{255, 255, 255, 255}},
				Face: basicfont.Face7x13, Dot: fixed.P(10, 60)}
			d2.DrawString(label)
			xdraw.NearestNeighbor.Scale(img, image.Rect(60, 80, 60+640, 80+240), small, small.Bounds(), xdraw.Over, nil)
			_ = d
			f, err := os.Create(fmt.Sprintf("/tmp/seedimg/%02d-%d.jpg", i+1, j))
			if err != nil {
				panic(err)
			}
			if err := jpeg.Encode(f, img, &jpeg.Options{Quality: 88}); err != nil {
				panic(err)
			}
			f.Close()
		}
	}
	fmt.Println("生成完毕")
}
'''


def ensure_photos():
    """生成占位照片（渐变 + 编号；中文字体没有，就不画中文）。"""
    import os, subprocess, shutil
    if os.path.isdir("/tmp/seedimg") and len(os.listdir("/tmp/seedimg")) >= 42:
        return
    os.makedirs("/tmp/seedimg", exist_ok=True)
    tmp = "/tmp/seedphotogen"
    os.makedirs(tmp, exist_ok=True)
    with open(tmp + "/main.go", "w") as f:
        f.write(GENPHOTOS_GO)
    go = shutil.which("go") or os.path.expanduser("~/.local/go/bin/go")
    env = dict(os.environ, GOPATH=os.path.expanduser("~/.local/gopath"),
               GOCACHE=os.path.expanduser("~/.local/gocache"))
    subprocess.run([go, "run", "."], cwd=tmp, check=True, env=env)
SECRET = b"0123456789012345678901234567890123456789abcdef"
# 你的账号：库里第一个用户
TARGET_UID = 1
N = 14
LIKERS = {1, 3, 4, 7, 11}   # 这几位先喜欢了 TARGET_UID
VISITORS = {2, 5, 9}        # 这几位只是看过

NAMES = ["小晴", "安然", "橘子", "阿May", "林洛", "苏禾", "亦栀", "April",
         "柚子", "南栀", "小满", "禾禾", "可可", "星野"]
PROVINCES = ["上海市"] * 8 + ["浙江省", "江苏省", "上海市"] * 2
HOMETOWNS = ["浙江省", "江苏省", "四川省", "广东省", "湖北省", "山东省", "福建省",
             "湖南省", "安徽省", "河南省", "江西省", "陕西省", "辽宁省", "云南省"]
OCCUPATIONS = ["互联网/IT · 产品经理", "金融 · 银行", "教育/科研 · 中小学教师",
               "医疗健康 · 护士", "文化传媒/广告 · 平面设计", "商贸/零售 · 电商运营",
               "金融 · 会计/审计", "互联网/IT · 设计师", "政府/公共事业 · 事业单位",
               "教育/科研 · 高校教师", "文化传媒/广告 · 记者/编辑", "制造/工业 · 质量管理",
               "生活服务 · 健身教练", "互联网/IT · 运营"]
SCHOOLS = ["复旦大学", "上海交通大学", "同济大学", "华东师范大学", "上海大学",
           "东华大学", "上海财经大学", "华东理工大学", "浙江大学", "南京大学",
           "上海外国语大学", "上海师范大学", "苏州大学", "江南大学"]
COMPANIES = ["某互联网公司", "某银行上海分行", "某中学", "某三甲医院", "某广告公司",
             "某电商平台", "某会计师事务所", "某设计工作室", "某事业单位", "某高校",
             "某报社", "某制造企业", "某健身连锁", "某创业公司"]
MBTIS = ["ENFP", "INFJ", "ISFJ", "ENTP", "INFP", "ESTJ", "ESFP", "INTJ", "ENFJ",
         "ISTP", "ISFP", "ENTJ", "ESFJ", "INTP"]
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
]
EXPECTS = [
    "希望你是个愿意好好说话的人，有好奇心，也愿意一起做点没什么用的事。",
    "希望对方真诚、稳定，能一起把日子过得有意思一点。",
    "喜欢有自己热爱之事的人，能聊得来最重要。",
    "希望你有分寸感，也有生活情趣。",
]


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


TARGET_UID = int(os.environ.get("TARGET_UID", "1"))

if "--clean" in sys.argv:
    print("删掉测试用户（手机号 13900000101~114）")
    print("在库里执行：DELETE FROM users WHERE phone LIKE '139000001%';")
    sys.exit(0)

ensure_photos()

created = []
for i in range(N):
    phone = f"139000001{i+1:02d}"
    name = NAMES[i]
    st, r = req("POST", "/auth/register", {"phone": phone, "password": "test1234"})
    if st != 200:
        # 上次跑到一半留下的号：直接登录接着补
        st2, r2 = req("POST", "/auth/login", {"phone": phone, "password": "test1234"})
        if st2 != 200:
            print(f"  ✗ {phone} 注册/登录都失败 {st} {r} / {st2} {r2}")
            continue
        r = r2
    uid = r["data"]["userId"]
    token = r["data"]["accessToken"]
    # 已经建好的（上次跑到这里）就跳过，免得重复传照片
    st0, r0 = req("GET", "/users/me/photos", token=token)
    if st0 == 200 and len(r0.get("data", {}).get("items", []) or []) >= 3:
        print(f"  · {name} 已存在，跳过")
        created.append((uid, phone, name, 0, ""))
        continue

    age = 24 + (i % 9)
    year = 2026 - age

    st, r = req("PATCH", "/users/me/profile", {
        "gender": 2,
        "birthday": f"{year}-0{i%9+1}-1{i%9}",
        "heightCm": 155 + (i * 7) % 18,
        "weightKg": 45 + (i * 3) % 18,
        "hometownProvince": HOMETOWNS[i], "hometownCity": HOMETOWNS[i],
        "cityProvince": PROVINCES[i], "city": "上海市",
        "occupation": OCCUPATIONS[i],
        "mbti": MBTIS[i],
        "smoking": 1, "drinking": 1 + (i % 2),
        "incomeRange": 2 + (i % 4),
        "education": 2 + (i % 3),
        "school": SCHOOLS[i], "company": COMPANIES[i],
        "isOnlyChild": bool(i % 2), "eldercarePressure": 1 + (i % 2),
        "hasCar": bool(i % 3), "hasHouse": 1 + (i % 3), "isDink": 2,
        "weightPublic": True, "incomePublic": True, "companyPublic": True,
    }, token=token)
    if st != 200:
        print(f"  ✗ {name} 资料失败 {st} {r}")
        continue

    cookie = media_cookie(token)
    first_url = None
    for j in (1, 2, 3):
        url = upload_photo(uid, token, cookie, f"/tmp/seedimg/{i+1:02d}-{j}.jpg")
        if j == 1:
            first_url = url
    upload_avatar(uid, token, cookie, f"/tmp/seedimg/{i+1:02d}-2.jpg")

    st, r = req("PUT", "/users/me/hobbies", {"hobbies": [
        {"name": "摄影", "description": MESSAGES[i], "sortOrder": 1},
        {"name": "美食", "description": MESSAGES[(i + 3) % N], "sortOrder": 2},
        {"name": "旅行", "description": MESSAGES[(i + 7) % N], "sortOrder": 3},
    ]}, token=token)
    if st != 200:
        print(f"  ✗ {name} 兴趣失败 {st} {r}")
        continue
    st, r = req("PATCH", "/users/me/texts", {
        "aboutMe": f"我是{name}，在上海工作和生活。{MESSAGES[i]}",
        "expectPartner": EXPECTS[i % len(EXPECTS)],
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
