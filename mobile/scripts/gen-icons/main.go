// 相悦的 logo 生成器。
//
// 一次生成 App 图标需要的全部 PNG（各尺寸、各变体）+ 一份几何等价的 SVG + 一张对照图。
//
// **为什么是代码而不是设计文件**：这台构建机跑不了任何图形软件（内核 3.10 + glibc 2.17，
// Chromium / ImageMagick / rsvg / Python 图形库全装不上），但 Go 的 stdlib 能直接写 PNG。
// 用代码还有个额外好处：**几何是确定的**——改半径、环宽、配色只要重跑，
// 不会出现"设计稿改了但 48px 那个忘了重新导出"。
//
// 设计：**两个相扣的圆环**（两个人扣在一起），金属金描边，深酒红底。
// 交集留空（A 案）——两环的弧从中间交叉穿过，读起来是"扣住"而不是"两个圆叠着"。
//
// 三个方案（审美判断留给人，几何/配色是共用的执行层）：
//
//	A 相扣    金环，交集留空        最克制，珠宝感
//	B 扣中藏金 金环 + 交集填金       多一处焦点，更像"有主体"
//	C 象牙双环 象牙白环 + 交集填金    上一版的配色，用于对比
//
// 跑法：
//
//	cd mobile/scripts/gen-icons
//	go run . -check                                    # 只做几何自检
//	go run . -out ../../assets -svg ../../logo.svg -preview /tmp/preview.png
package main

import (
	"flag"
	"fmt"
	"image"
	"image/color"
	"image/draw"
	"image/png"
	"math"
	"os"
	"path/filepath"
	"strconv"

	"golang.org/x/image/font"
	"golang.org/x/image/font/basicfont"
	"golang.org/x/image/math/fixed"
	xdraw "golang.org/x/image/draw"
)

// 取色全部来自 src/theme/index.ts，不另起一套。
var (
	wineLight  = hex("#A32E4E") // colors.brand
	wineMid    = hex("#86243F") // colors.brandDark
	wineDeep   = hex("#61182C") // colors.brandDeep
	ivory      = hex("#F7F3EE") // colors.paper
	goldLight  = hex("#E6D6BE") // colors.goldLine
	goldDeep   = hex("#A8763E") // colors.gold
	white      = hex("#FFFFFF")
)

func hex(s string) color.RGBA {
	n, err := strconv.ParseUint(s[1:], 16, 32)
	if err != nil {
		panic(err)
	}
	return color.RGBA{uint8(n >> 16), uint8(n >> 8), uint8(n), 255}
}

/* ------------------------------------------------------------- 几何比例 */

// 图形整体占画布宽度的比例。
//
// 图形是"两环并排"，宽高比约 1 : 0.61，所以约束在**宽度**上：
//   - icon 0.70：iOS 图标的常规留白；
//   - Android 自适应前景 0.62：它会被裁进内切圆，108dp 画布里只有内 72dp 保证
//     可见，也就是图形最外缘到中心的距离必须 < 33.3% 画布宽；图形最外缘是
//     水平方向，恰好 0.5×ratio ⇒ ratio ≤ 0.667 才安全，取 0.62 留余量；
//   - favicon 0.78：48px 太小，宁可占满一点。
const (
	ratioIcon     = 0.70
	ratioAdaptive = 0.62
	ratioFavicon  = 0.78
)

// kOverlap = 两环圆心距 / 半径。
//
// **这个值是"像什么"的分水岭**：0.5 左右是维恩图（两个集合深度相交），
// 0.72 才是链环（浅度相扣）。上一版用的 0.51，所以看着像"两个圆叠着"。
const kOverlap = 0.72

// wRatio = 环宽 / 图形宽度。0.06 比上一版的 0.069 更细——细才显得贵，
// 但小尺寸要单独加粗（strokeMul），否则缩下去会断。
const wRatio = 0.06

// geom 把"图形宽度 M"换算成半径 R、圆心水平偏移 D、环宽 W。
func geom(M, strokeMul float64) (R, D, W float64) {
	W = M * wRatio * strokeMul
	R = (M - W) / (2 * (1 + kOverlap))
	D = kOverlap * R
	return
}

/* ----------------------------------------------------------------- 底色 */

// field 三段竖向渐变 + 很轻的四角压暗。
//
// 上一版是 brand→brandDeep 两段，整体偏中间调、偏"暖"；三段（brand→brandDark→
// brandDeep）把深色占比提上来，整体压暗。压暗让深色占更多、也让金更跳。
// vignette 是纵深——纯平涂看着像色块，有轻微暗角才像"有厚度的东西"。
func field(x, y, n float64) color.RGBA {
	t := y / n
	var c color.RGBA
	if t < 0.45 {
		c = lerp(wineLight, wineMid, t/0.45)
	} else {
		c = lerp(wineMid, wineDeep, (t-0.45)/0.55)
	}
	// 四角压暗：中心 0、四角 1（按半对角线归一）
	dx := (x - n/2) / (n / 2)
	dy := (y - n/2) / (n / 2)
	rr := (dx*dx + dy*dy) / 2
	k := 1 - 0.18*math.Min(1, rr)
	return color.RGBA{uint8(float64(c.R) * k), uint8(float64(c.G) * k), uint8(float64(c.B) * k), 255}
}

/* ---------------------------------------------------------------- 变体 */

type variant struct {
	name string
	size int
	// 是否画底色；false = 透明底（Android 前景/单色、启动图、登录页的图形）
	bg bool
	// 环用金属金渐变；false = 平涂象牙白
	ringMetal bool
	// 交集填金色渐变
	lensFill bool
	// 整个图形单色不透明（Android 单色层，系统会给它上色）
	flat      bool
	ratio     float64
	strokeMul float64
}

// designs 是三个方案的"外观"部分；各尺寸/各变体在下面按方案复制。
var designKeys = []string{"A", "B", "C"}

func designLook(key string) (ringMetal, lensFill bool) {
	switch key {
	case "A":
		return true, false // 金环，交集留空
	case "B":
		return true, true // 金环 + 交集填金
	default:
		return false, true // 象牙白环 + 交集填金（对比用）
	}
}

/** 某个方案在某个尺寸/底色下的一个变体 */
func mk(key string, name string, size int, bg bool, ratio, strokeMul float64) variant {
	rm, lf := designLook(key)
	return variant{name: name, size: size, bg: bg, ringMetal: rm, lensFill: lf, ratio: ratio, strokeMul: strokeMul}
}

// assets 是要落盘的 7 个文件（用 A 案，即推荐方案）。
func assets(key string) []variant {
	return []variant{
		mk(key, "icon.png", 1024, true, ratioIcon, 1),
		mk(key, "android-icon-foreground.png", 512, false, ratioAdaptive, 1),
		// 纯底色层：ratio=0 表示不画图形
		{name: "android-icon-background.png", size: 512, bg: true, ratio: 0},
		mk(key, "android-icon-monochrome.png", 432, false, ratioAdaptive, 1.25),
		mk(key, "splash-icon.png", 1024, false, ratioIcon, 1),
		mk(key, "favicon.png", 48, true, ratioFavicon, 1.8),
		mk(key, "mark.png", 256, false, 0.98, 1),
	}
}

/* --------------------------------------------------------------- 上色 */

// sample 返回画布坐标 (x,y) 处的颜色。
func sample(v variant, x, y float64) color.RGBA {
	n := float64(v.size)
	cx, cy := n/2, n/2
	M := n * v.ratio
	R, D, W := geom(M, v.strokeMul)

	var bg color.RGBA
	if v.bg {
		bg = field(x, y, n)
	}

	if v.ratio == 0 {
		return bg // 纯底色层
	}

	dA := math.Hypot(x-(cx-D), y-cy)
	dB := math.Hypot(x-(cx+D), y-cy)
	onRing := math.Abs(dA-R) <= W/2 || math.Abs(dB-R) <= W/2
	inLens := dA <= R && dB <= R

	// 金属渐变：按像素在整个图形的竖直范围里取 0..1（两环共用一条，像同一块料）
	tMetal := clamp01((y - (cy - R - W/2)) / (2*R + W))

	if v.flat {
		// 单色层：交集与环都是同一个不透明色，交给系统上色
		if inLens || onRing {
			return opaque(white)
		}
		return bg
	}

	// 交集填金时，金**盖住**穿过它的环弧——否则两种同色金叠在一起会糊，
	// 也读不出"中间有一颗宝石"
	if v.lensFill && inLens {
		tLens := clamp01((y-(cy-math.Sqrt(math.Max(0, R*R-D*D)))) / (2 * math.Sqrt(math.Max(0, R*R-D*D))))
		return opaque(lerp(goldLight, goldDeep, tLens))
	}
	if onRing {
		if v.ringMetal {
			return opaque(lerp(goldLight, goldDeep, tMetal))
		}
		return opaque(ivory)
	}
	return bg
}

func clamp01(t float64) float64 { return math.Max(0, math.Min(1, t)) }

func opaque(c color.RGBA) color.RGBA { c.A = 255; return c }

func lerp(a, b color.RGBA, t float64) color.RGBA {
	t = clamp01(t)
	mix := func(x, y uint8) uint8 { return uint8(float64(x)*(1-t) + float64(y)*t) }
	return color.RGBA{mix(a.R, b.R), mix(a.G, b.G), mix(a.B, b.B), 255}
}

// render 用 ss×ss 超采样渲染一张。
func render(v variant, ss int) *image.RGBA {
	img := image.NewRGBA(image.Rect(0, 0, v.size, v.size))
	inv := 1.0 / float64(ss)
	for py := 0; py < v.size; py++ {
		for px := 0; px < v.size; px++ {
			var r, g, b, a float64
			for sy := 0; sy < ss; sy++ {
				for sx := 0; sx < ss; sx++ {
					c := sample(v, float64(px)+(float64(sx)+0.5)*inv, float64(py)+(float64(sy)+0.5)*inv)
					af := float64(c.A) / 255
					// 预乘后平均，避免边缘出现深色描边
					r += float64(c.R) * af
					g += float64(c.G) * af
					b += float64(c.B) * af
					a += af
				}
			}
			k := float64(ss * ss)
			img.SetRGBA(px, py, color.RGBA{
				R: uint8(math.Round(r / k)), G: uint8(math.Round(g / k)),
				B: uint8(math.Round(b / k)), A: uint8(math.Round(a / k * 255)),
			})
		}
	}
	return img
}

/* ------------------------------------------------------------- 自检 */

// check 按解析式断言图形画对了。
//
// 这台机器看不到图，所以"画对不对"只能靠算：几何是解析式定义的，
// 那么"图形的左右外沿在哪""竖直上沿在哪""交集边界在哪"都能断言。
// 好不好看交给预览图，画错没有交给这里——这两个问题得分开验。
func check() bool {
	ok := true
	report := func(name string, cond bool, got color.RGBA) {
		mark := "✅"
		if !cond {
			mark = "❌"
			ok = false
		}
		fmt.Printf("  %s %-36s 取到 #%02X%02X%02X\n", mark, name, got.R, got.G, got.B)
	}
	// 区分"图形"与"底色"：底色是酒红（G < B），金/象牙白都是暖色（G > B）
	isMark := func(c color.RGBA) bool { return c.G > c.B }

	fmt.Println("几何自检（icon 1024，A 案）：")
	v := mk("A", "check", 1024, true, ratioIcon, 1)
	M := 1024 * ratioIcon
	R, D, W := geom(M, 1)
	cx, cy := 512.0, 512.0

	report("正中＝底色（A 案交集留空）", !isMark(sample(v, cx, cy)), sample(v, cx, cy))

	// 左右外沿：y=cy 这条线上，最左的图形像素应在 cx−D−R−W/2
	firstMarkLeft := -1.0
	for x := 0.0; x < cx; x += 0.5 {
		if isMark(sample(v, x, cy)) {
			firstMarkLeft = x
			break
		}
	}
	expectLeft := cx - D - R - W/2
	report(fmt.Sprintf("图形左沿 x=%.1f（设计 %.1f）", firstMarkLeft, expectLeft),
		firstMarkLeft > 0 && math.Abs(firstMarkLeft-expectLeft) < 3, sample(v, expectLeft+3, cy))

	lastMarkRight := -1.0
	for x := cx; x < 1024; x += 0.5 {
		if isMark(sample(v, x, cy)) {
			lastMarkRight = x
		}
	}
	expectRight := cx + D + R + W/2
	report(fmt.Sprintf("图形右沿 x=%.1f（设计 %.1f）", lastMarkRight, expectRight),
		math.Abs(lastMarkRight-expectRight) < 3, sample(v, expectRight-3, cy))

	// 竖直上沿（x=cx 处环带的外沿）：cy − √((R+W/2)² − D²)
	firstMarkTop := -1.0
	for y := 0.0; y < cy; y += 0.5 {
		if isMark(sample(v, cx, y)) {
			firstMarkTop = y
			break
		}
	}
	expectTop := cy - math.Sqrt((R+W/2)*(R+W/2)-D*D)
	report(fmt.Sprintf("图形上沿 y=%.1f（设计 %.1f）", firstMarkTop, expectTop),
		firstMarkTop > 0 && math.Abs(firstMarkTop-expectTop) < 3, sample(v, cx, expectTop+3))

	// 环宽：穿过 y=cy 的那一段，量出来应约等于 W
	if firstMarkLeft > 0 && lastMarkRight > 0 {
		// 左环在 y=cy 处的外沿 → 内沿
		inner := -1.0
		for x := firstMarkLeft; x < cx; x += 0.5 {
			if !isMark(sample(v, x, cy)) {
				inner = x
				break
			}
		}
		gotW := inner - firstMarkLeft
		report(fmt.Sprintf("环宽 %.1f（设计 %.1f）", gotW, W), inner > 0 && math.Abs(gotW-W) < 3, sample(v, firstMarkLeft+W/2, cy))
	}

	// B 案：交集填金 ⇒ 在 y=cy 上，从中心向右的第一个非图形像素应在 cx+(R−D)
	vb := mk("B", "check-b", 1024, true, ratioIcon, 1)
	firstNonGold := -1.0
	for x := cx; x < 1024; x += 0.5 {
		if !isMark(sample(vb, x, cy)) {
			firstNonGold = x
			break
		}
	}
	// 注意期望值是 cx+(R−D)+W/2 而不是 cx+(R−D)：两等圆的交集右边界**恰好落在
	// 左环的圆心线上**（左环最右点就是 cx−D+R，和交集右边界同一个 x），所以再往右
	// 还有半个环宽仍属于图形。这条断言同时验了交集边界和环宽。
	expectLensEdge := cx + (R - D) + W/2
	report(fmt.Sprintf("B 案：中心向右第一个非图形像素 x=%.1f（设计 %.1f）", firstNonGold, expectLensEdge),
		firstNonGold > 0 && math.Abs(firstNonGold-expectLensEdge) < 3, sample(vb, expectLensEdge-6, cy))

	// 透明底变体：图形外必须完全透明
	fg := mk("A", "fg", 512, false, ratioAdaptive, 1)
	report("透明底变体的角落是全透明", sample(fg, 2, 2).A == 0, sample(fg, 2, 2))

	// 单色层：图形内必须完全不透明
	mv := mk("A", "mono", 432, false, ratioAdaptive, 1.25)
	mv.flat = true
	R2, D2, _ := geom(432*ratioAdaptive, 1.25)
	report("单色层的环是不透明的", sample(mv, 216-D2-R2, 216).A == 255, sample(mv, 216-D2-R2, 216))
	return ok
}

/* --------------------------------------------------------------- SVG */

// svg 用与光栅化同一组参数导出矢量版，保证两边不会各自漂移。
func svg(size int, key string) string {
	n := float64(size)
	cx, cy := n/2, n/2
	M := n * ratioIcon
	R, D, W := geom(M, 1)
	H := math.Sqrt(math.Max(0, R*R-D*D))
	phi0 := math.Atan2(H, D)

	var poly string
	if lf := func() bool { _, l := designLook(key); return l }(); lf {
		// 交集：左边界是右圆的左弧、右边界是左圆的右弧。
		// 用密集折线而不是 arc 命令——arc 的 sweep-flag 极易写反（上一版就写反了）。
		var pts []string
		steps := 120
		for i := 0; i <= steps; i++ { // 右圆左弧：下尖点 → 上尖点
			ang := math.Pi - phi0 + 2*phi0*float64(i)/float64(steps)
			pts = append(pts, fmt.Sprintf("%.2f,%.2f", cx+D+R*math.Cos(ang), cy+R*math.Sin(ang)))
		}
		for i := 0; i <= steps; i++ { // 左圆右弧：上尖点 → 下尖点
			ang := -phi0 + 2*phi0*float64(i)/float64(steps)
			pts = append(pts, fmt.Sprintf("%.2f,%.2f", cx-D+R*math.Cos(ang), cy+R*math.Sin(ang)))
		}
		poly = fmt.Sprintf(`  <polygon points="%s" fill="url(#gold)"/>`, joinPts(pts))
	}

	rm, _ := designLook(key)
	ring := "#F7F3EE"
	if rm {
		ring = "url(#goldStroke)"
	}

	return fmt.Sprintf(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 %d %d" width="%d" height="%d">
  <title>相悦</title>
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="%s"/>
      <stop offset="0.45" stop-color="%s"/>
      <stop offset="1" stop-color="%s"/>
    </linearGradient>
    <linearGradient id="gold" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="%s"/>
      <stop offset="1" stop-color="%s"/>
    </linearGradient>
    <linearGradient id="goldStroke" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="%s"/>
      <stop offset="1" stop-color="%s"/>
    </linearGradient>
  </defs>
  <rect width="%d" height="%d" fill="url(#bg)"/>
%s
  <circle cx="%.2f" cy="%.2f" r="%.2f" fill="none" stroke="%s" stroke-width="%.2f"/>
  <circle cx="%.2f" cy="%.2f" r="%.2f" fill="none" stroke="%s" stroke-width="%.2f"/>
</svg>
`, size, size, size, size,
		"#A32E4E", "#86243F", "#61182C",
		"#E6D6BE", "#A8763E",
		"#E6D6BE", "#A8763E",
		size, size, poly,
		cx-D, cy, R, ring, W,
		cx+D, cy, R, ring, W)
}

func joinPts(p []string) string {
	out := ""
	for i, s := range p {
		if i > 0 {
			out += " "
		}
		out += s
	}
	return out
}

/* ------------------------------------------------------------- 预览图 */

func label(dst *image.RGBA, x, y int, s string, scale int) {
	small := image.NewRGBA(image.Rect(0, 0, 120, 14))
	d := &font.Drawer{Dst: small, Src: image.NewUniform(color.RGBA{0x6B, 0x61, 0x5A, 255}),
		Face: basicfont.Face7x13, Dot: fixed.P(0, 11)}
	d.DrawString(s)
	xdraw.NearestNeighbor.Scale(dst, image.Rect(x, y, x+120*scale, y+14*scale), small, small.Bounds(), xdraw.Over, nil)
}

// preview 拼一张对照图：三个方案各出一列（大图 + 一排小尺寸），外加登录页/浅底/深底三处上下文。
func preview() *image.RGBA {
	const pad, gap = 30, 26
	colW, big := 300, 260
	w := pad + 3*(colW+gap) + pad
	h := pad + big + 46 + 110 + 46 + 190 + pad
	img := image.NewRGBA(image.Rect(0, 0, w, h))
	draw.Draw(img, img.Bounds(), image.NewUniform(color.RGBA{0xF7, 0xF3, 0xEE, 255}), image.Point{}, draw.Src)

	put := func(v variant, x, y int) {
		draw.Draw(img, image.Rect(x, y, x+v.size, y+v.size), render(v, 3), image.Point{}, draw.Over)
	}

	for i, key := range designKeys {
		x := pad + i*(colW+gap)
		put(mk(key, key, big, true, ratioIcon, 1), x, pad)
		label(img, x, pad+big+8, key+"  "+map[string]string{"A": "linked gold, hollow", "B": "linked gold, gold lens", "C": "ivory rings, gold lens"}[key], 2)
		// 一排小尺寸
		sx := x
		for _, s := range []int{96, 72, 48} {
			put(mk(key, key, s, true, ratioIcon, 1), sx, pad+big+40)
			sx += s + 14
		}
		label(img, x+96+72+48+28-120, pad+big+40+96+4, "96 / 72 / 48", 2)
	}

	// 第二块：三处真实上下文（都用 A 案）
	y2 := pad + big + 46 + 110 + 40
	label(img, pad, y2-24, "A in context:", 2)
	// ① 登录页的 64pt 圆角块
	{
		bx, by, bs := pad, y2, 150
		for py := 0; py < bs; py++ {
			for px := 0; px < bs; px++ {
				t := float64(py) / float64(bs)
				var c color.RGBA
				if t < 0.45 {
					c = lerp(wineLight, wineMid, t/0.45)
				} else {
					c = lerp(wineMid, wineDeep, (t-0.45)/0.55)
				}
				img.Set(bx+px, by+py, c)
			}
		}
		put(mk("A", "A", 100, false, 0.98, 1), bx+25, by+25)
		label(img, bx, by+bs+8, "login block (mark on gradient)", 2)
	}
	// ② Android 自适应：前景放进酒红圆形（模拟系统裁切）
	{
		size := 150
		bx := pad + 220
		cx, cy, r := bx+size/2, y2+size/2, size/2
		for py := 0; py < size; py++ {
			for px := 0; px < size; px++ {
				dx, dy := px-cx, py-cy
				if dx*dx+dy*dy <= r*r {
					t := float64(py) / float64(size)
					c := lerp(wineLight, wineDeep, t)
					img.Set(bx+px, y2+py, c)
				}
			}
		}
		put(mk("A", "A", size, false, ratioAdaptive, 1), bx, y2)
		label(img, bx, y2+size+8, "android adaptive (circle mask)", 2)
	}
	// ③ 浅底上的酒红版（比如网页、浅色界面）
	{
		bx := pad + 440
		put(mk("A", "A", 150, false, 0.98, 1), bx, y2)
		// 酒红环在浅底上：临时把金属渐变换成酒红系不方便，这里直接用 C 案（象牙白）示意深底
		label(img, bx, y2+150+8, "mark on ivory bg (A)", 2)
	}
	// ④ 深底（比如深色界面）
	{
		bx := pad + 660
		block := image.Rect(bx, y2, bx+150, y2+150)
		draw.Draw(img, block, image.NewUniform(color.RGBA{0x1A, 0x15, 0x12, 255}), image.Point{}, draw.Src)
		put(mk("A", "A", 150, false, 0.98, 1), bx, y2)
		label(img, bx, y2+150+8, "mark on ink bg (A)", 2)
	}
	return img
}

/* ---------------------------------------------------------------- 主 */

func main() {
	out := flag.String("out", "../../assets", "输出 PNG 的目录")
	previewPath := flag.String("preview", "", "预览图输出路径（留空则不生成）")
	svgPath := flag.String("svg", "", "矢量版输出路径（留空则不生成）")
	design := flag.String("design", "A", "落盘用哪个方案（A/B/C）")
	checkOnly := flag.Bool("check", false, "只做几何自检")
	flag.Parse()

	if !check() {
		if !*checkOnly {
			fmt.Println("几何自检未通过，已中止")
			os.Exit(1)
		}
		os.Exit(1)
	}
	if *checkOnly {
		return
	}

	if err := os.MkdirAll(*out, 0o755); err != nil {
		panic(err)
	}
	for _, v := range assets(*design) {
		img := render(v, 4)
		p := filepath.Join(*out, v.name)
		f, err := os.Create(p)
		if err != nil {
			panic(err)
		}
		if err := png.Encode(f, img); err != nil {
			panic(err)
		}
		f.Close()
		st, _ := os.Stat(p)
		fmt.Printf("  ✓ %-32s %dx%d  %.0f KB\n", v.name, v.size, v.size, float64(st.Size())/1024)
	}

	if *svgPath != "" {
		if err := os.WriteFile(*svgPath, []byte(svg(512, *design)), 0o644); err != nil {
			panic(err)
		}
		fmt.Printf("  ✓ %-32s (矢量版，浏览器可直接打开)\n", *svgPath)
	}
	if *previewPath != "" {
		f, err := os.Create(*previewPath)
		if err != nil {
			panic(err)
		}
		if err := png.Encode(f, preview()); err != nil {
			panic(err)
		}
		f.Close()
		fmt.Printf("  ✓ %-32s (三案对照图)\n", *previewPath)
	}
}
