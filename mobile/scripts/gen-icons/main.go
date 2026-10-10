// 相悦的 logo 生成器。
//
// 一次生成 App 图标需要的全部 PNG + 一份几何等价的 SVG + 一张对照图。
//
// **为什么是代码而不是设计文件**：这台构建机跑不了任何图形软件（内核 3.10 + glibc 2.17，
// Chromium / ImageMagick / rsvg / Python 图形库全装不上），但 Go 的 stdlib 能直接写 PNG。
// 用代码还有个额外好处：几何是确定的——改参数重跑即可，不会出现"某个尺寸忘了重新导出"。
//
// # 设计取向：做减法
//
// 前两版被评价为"土"。复盘下来不是执行问题，是**方向错了**：
//   - 金 + 酒红是中文语境里"喜庆"的头号配色公式（红包、婚宴、酒楼），
//     而我还把金做成了金属渐变，等于把那个信号又放大一层；
//   - 渐变、暗角、拟物金属——都是"想显得贵"的加法，但贵是减法；
//   - 两个等大正圆居中对称，是图标库素材的形；
//   - 图形占比 0.70，留白不足。
//
// 所以这一版：**纯平涂单色、没有金、没有渐变、线砍细、图形缩小留白做大**，
// 并补一个单一形体的备选（一个圆被细缝分成两半）。
//
// 2×2 可选：形体（双环相扣 / 分割的圆）× 底色（象牙白 / 墨）。
//
// 跑法：
//
//	cd mobile/scripts/gen-icons
//	go run . -check
//	go run . -design rings-ivory -out ../../assets -svg ../../logo.svg -preview /tmp/preview.png
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
	"strings"

	"golang.org/x/image/font"
	"golang.org/x/image/font/basicfont"
	"golang.org/x/image/math/fixed"
	xdraw "golang.org/x/image/draw"
)

// 取色全部来自 src/theme/index.ts。
var (
	ivory    = hex("#F7F3EE") // colors.paper —— 象牙白（暖白，不是纯白）
	ink      = hex("#1A1512") // colors.ink —— 墨（暖墨，不是纯黑）
	wineDeep = hex("#61182C") // colors.brandDeep
	white    = hex("#FFFFFF")
)

func hex(s string) color.RGBA {
	n, err := strconv.ParseUint(s[1:], 16, 32)
	if err != nil {
		panic(err)
	}
	return color.RGBA{uint8(n >> 16), uint8(n >> 8), uint8(n), 255}
}

/* ------------------------------------------------------------ 形体与配色 */

type kind int

const (
	kindRings    kind = iota // 两个相扣的圆环
	kindSplit                // 一个圆被一条细缝分成两半
	kindWordmark             // "相悦"字标：没有图形，字本身当图形（见 wordmark.go）
)

// theme 是"纯平涂"的：底色一个色、图形一个色，没有第三样东西。
// 上一版那种渐变/暗角/金属全部去掉——那些都是加法。
type theme struct {
	bg   color.RGBA
	mark color.RGBA
}

var themes = map[string]theme{
	// 白底酒红：最克制的一路。留白大、单色细线，是中文语境里"高雅"最稳的解法
	// （参考定位高端的婚恋产品：浅底 + 单色 + 极简）。
	"ivory": {bg: ivory, mark: wineDeep},
	// 墨底白字：水墨的方向。深底在手机桌面上更稳。
	"ink": {bg: ink, mark: ivory},
	// 酒红底象牙白：把主色当底。比墨底更有辨识度，但要小心——酒红 + 金在中文语境里
	// 是"喜庆"的头号公式，所以这里**只用酒红一个色**，不掺金、不做渐变。
	"wine": {bg: wineDeep, mark: ivory},
}

/* ---------------------------------------------------------------- 几何 */

// kOverlap = 两环圆心距 / 半径。
// **这是"像什么"的分水岭**：0.5 左右是维恩图（两个集合），0.72 才是链环（相扣）。
const kOverlap = 0.72

// wRatio = 环宽 / 图形宽度。上一版 0.06，这版 0.05——线更细。
const wRatio = 0.05

// seamAmp = 分割缝的正弦摆幅 / 半径。缝走正弦，两半才会互相咬住；
// 直上直下那是"把圆切成两半"，不是合二为一。
const seamAmp = 0.20

// slitRatio = 缝宽 / 半径。
const slitRatio = 0.075

// markRatio 是图形占画布宽度的比例。**缩小 + 留白**是这一版的主要手段：
// 上一版 0.70，这版 0.56 / 0.50。
func markRatio(k kind, use string) float64 {
	table := map[kind]map[string]float64{
		kindRings: {"icon": 0.56, "adaptive": 0.50, "favicon": 0.74, "mark": 0.98},
		// 分割的圆是正方形（直径＝图形宽），同样的视觉重量要占更小的比例
		kindSplit: {"icon": 0.50, "adaptive": 0.45, "favicon": 0.64, "mark": 0.88},
		// 字标是横长条（宽:高 ≈ 2:1）：横向占比按上面的观感给，纵向自然就只占三分之一。
		// ⚠️ favicon 反而不放大：48px 上"两个字"已经是能认出来的下限，
		// 放到 0.74 会顶到安全区边缘，缩到更小又糊。
		kindWordmark: {"icon": 0.62, "adaptive": 0.52, "favicon": 0.78, "mark": 0.98},
	}
	return table[k][use]
}

// ringsGeom 把图形宽度 M 换算成半径 R、圆心水平偏移 D、环宽 W。
func ringsGeom(M, strokeMul float64) (R, D, W float64) {
	W = M * wRatio * strokeMul
	R = (M - W) / (2 * (1 + kOverlap))
	D = kOverlap * R
	return
}

// slitHalf 返回分割缝在相对圆心 dy 处的**半宽**。
//
// 两端收到 0：两半在圆顶与圆底仍然是连着的，只有中间是一道缝。
// 完全切穿会读成"两片"（是分开，不是合）；连着才读成"整体的合缝"，
// 也更克制——一个完整的圆，中间一道痕。
func slitHalf(dy, R, slit float64) float64 {
	t := (dy + R) / (2 * R)
	const edge = 0.20 // 两端各 20% 内线性收窄
	f := math.Min(1, math.Min(t/edge, (1-t)/edge))
	return slit / 2 * math.Max(0, f)
}

// seamOffset 返回分割缝在相对圆心 dy 处的水平偏移。
// 正弦的好处：dy=±R 时回到 0（缝的端点正好落在圆的正上/正下），中途向两侧各摆一次。
func seamOffset(dy, R float64) float64 {
	t := (dy + R) / (2 * R) // ∈ [0,1]
	return math.Sin(2*math.Pi*t) * seamAmp * R
}

/* ---------------------------------------------------------------- 变体 */

type variant struct {
	name string
	size int
	// 是否画底色；false = 透明底（Android 前景/单色、启动图、登录页的图形）
	hasBG bool
	kind  kind
	th    theme
	ratio float64
	// 环宽 / 缝宽的倍率：小尺寸要加粗，否则缩下去就断了
	strokeMul float64
	slitMul   float64
	// Android 单色层：图形全部用不透明白（系统会给它上色）
	flat bool
}

// designs 是候选方案：几何形体（2×2）与字标（3 个配色）。
//
// 字标是 2026-10-11 加的：用户给了一张参考（"良配"——一块深色圆角方块 + 白色粗体
// 中文 + 角上一颗小星光），要"没啥图形、就是很高级"。前两版几何图形都被评过"土"，
// 字标这条路把图形彻底去掉，正好接上前一轮"做减法"的结论。
var designs = []struct {
	key  string
	kind kind
	th   theme
}{
	{"wordmark-ink", kindWordmark, themes["ink"]},
	{"wordmark-ivory", kindWordmark, themes["ivory"]},
	{"wordmark-wine", kindWordmark, themes["wine"]},
	{"rings-ivory", kindRings, themes["ivory"]},
	{"rings-ink", kindRings, themes["ink"]},
	{"split-ivory", kindSplit, themes["ivory"]},
	{"split-ink", kindSplit, themes["ink"]},
}

func findDesign(key string) (kind, theme) {
	for _, d := range designs {
		if d.key == key {
			return d.kind, d.th
		}
	}
	panic("未知方案: " + key + "（可选 " + designKeys() + "）")
}

func designKeys() string {
	ks := make([]string, 0, len(designs))
	for _, d := range designs {
		ks = append(ks, d.key)
	}
	return strings.Join(ks, " / ")
}

func mk(key, name string, size int, hasBG bool, use string, strokeMul, slitMul float64) variant {
	k, th := findDesign(key)
	return variant{
		name: name, size: size, hasBG: hasBG, kind: k, th: th,
		ratio: markRatio(k, use), strokeMul: strokeMul, slitMul: slitMul,
	}
}

// assets 是要落盘的 7 个文件。
func assets(key string) []variant {
	_, th := findDesign(key)
	return []variant{
		mk(key, "icon.png", 1024, true, "icon", 1, 1),
		mk(key, "android-icon-foreground.png", 512, false, "adaptive", 1.15, 1.15),
		// 纯底色层：ratio=0 表示不画图形
		{name: "android-icon-background.png", size: 512, hasBG: true, ratio: 0, th: th},
		mk(key, "android-icon-monochrome.png", 432, false, "adaptive", 1.3, 1.3),
		mk(key, "splash-icon.png", 1024, false, "icon", 1, 1),
		mk(key, "favicon.png", 48, true, "favicon", 1.7, 1.7),
		mk(key, "mark.png", 256, false, "mark", 1, 1),
	}
}

/* --------------------------------------------------------------- 上色 */

func sample(v variant, x, y float64) color.RGBA {
	n := float64(v.size)
	cx, cy := n/2, n/2
	M := n * v.ratio

	var bg color.RGBA
	if v.hasBG {
		bg = v.th.bg
	}
	if v.ratio == 0 {
		return bg // 纯底色层
	}

	mark := v.th.mark
	if v.flat {
		mark = white // 单色层：交给系统上色
	}

	hit := false
	switch v.kind {
	case kindWordmark:
		// 字标：把点换算到"墨迹盒内的归一化坐标"，再从掩膜取覆盖率。
		// 这里必须能返回**部分覆盖**（边缘像素），否则字的边缘会有锯齿。
		h := M / wordAspect()
		u := (x - (cx - M/2)) / M
		vv := (y - (cy - h/2)) / h
		if cov := wordMask(wordMaskH).cover(u, vv); cov > 0 {
			c := mark
			c.A = uint8(math.Round(cov * 255))
			return c
		}
		return bg
	case kindRings:
		R, D, W := ringsGeom(M, v.strokeMul)
		dA := math.Hypot(x-(cx-D), y-cy)
		dB := math.Hypot(x-(cx+D), y-cy)
		hit = math.Abs(dA-R) <= W/2 || math.Abs(dB-R) <= W/2
	case kindSplit:
		R := M / 2
		slit := R * slitRatio * v.slitMul
		if math.Hypot(x-cx, y-cy) <= R {
			// 缝的两侧各让开半个缝宽 ⇒ 两半之间留出一道光
			hit = math.Abs(x-(cx+seamOffset(y-cy, R))) > slitHalf(y-cy, R, slit)
		}
	}
	if hit {
		mark.A = 255
		return mark
	}
	return bg
}

/* -------------------------------------------------------------- 渲染 */

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
			k2 := float64(ss * ss)
			img.SetRGBA(px, py, color.RGBA{
				R: uint8(math.Round(r / k2)), G: uint8(math.Round(g / k2)),
				B: uint8(math.Round(b / k2)), A: uint8(math.Round(a / k2 * 255)),
			})
		}
	}
	return img
}

/* -------------------------------------------------------------- 自检 */

// check 按解析式断言图形画对了。
//
// 这台机器看不到图：**"画对了"和"好不好看"是两个问题，必须分开验**。
// 好看交给人看对照图；画错交给这里——几何是解析式定义的，边界位置可以断言。
func check() bool {
	ok := true
	report := func(name string, cond bool, got color.RGBA) {
		mark := "✅"
		if !cond {
			mark = "❌"
			ok = false
		}
		fmt.Printf("  %s %-40s 取到 #%02X%02X%02X\n", mark, name, got.R, got.G, got.B)
	}
	// 判"图形还是底色"不能写死色相：本版底色两种、图形色随之反相。
	// 改成**离哪个色更近**，对任何配色都成立。
	dist := func(c, t color.RGBA) float64 {
		dr, dg, db := float64(c.R)-float64(t.R), float64(c.G)-float64(t.G), float64(c.B)-float64(t.B)
		return dr*dr + dg*dg + db*db
	}
	isMark := func(v variant, c color.RGBA) bool { return dist(c, v.th.mark) < dist(c, v.th.bg) }
	cx, cy := 512.0, 512.0

	// ---- 形体一：双环相扣 ----
	fmt.Println("几何自检（rings-ivory，icon 1024）：")
	v := mk("rings-ivory", "check", 1024, true, "icon", 1, 1)
	M := 1024 * v.ratio
	R, D, W := ringsGeom(M, 1)

	report("正中＝底色（交集留空）", !isMark(v, sample(v, cx, cy)), sample(v, cx, cy))

	left, right := -1.0, -1.0
	for x := 0.0; x < cx; x += 0.5 {
		if isMark(v, sample(v, x, cy)) {
			left = x
			break
		}
	}
	for x := 1024.0; x > cx; x -= 0.5 {
		if isMark(v, sample(v, x, cy)) {
			right = x
			break
		}
	}
	report(fmt.Sprintf("图形左沿 x=%.1f（设计 %.1f）", left, cx-D-R-W/2),
		left > 0 && math.Abs(left-(cx-D-R-W/2)) < 3, sample(v, cx-D-R, cy))
	report(fmt.Sprintf("图形右沿 x=%.1f（设计 %.1f）", right, cx+D+R+W/2),
		right > 0 && math.Abs(right-(cx+D+R+W/2)) < 3, sample(v, cx+D+R, cy))

	inner := -1.0
	for x := left; x < cx; x += 0.5 {
		if !isMark(v, sample(v, x, cy)) {
			inner = x
			break
		}
	}
	report(fmt.Sprintf("环宽 %.1f（设计 %.1f）", inner-left, W),
		inner > 0 && math.Abs((inner-left)-W) < 3, sample(v, left+W/2, cy))

	top := -1.0
	for y := 0.0; y < cy; y += 0.5 {
		if isMark(v, sample(v, cx, y)) {
			top = y
			break
		}
	}
	expectTop := cy - math.Sqrt((R+W/2)*(R+W/2)-D*D)
	report(fmt.Sprintf("图形上沿 y=%.1f（设计 %.1f）", top, expectTop),
		top > 0 && math.Abs(top-expectTop) < 3, sample(v, cx, expectTop+3))

	// 留白是这一版的主要手段，给它一条下限，别哪天悄悄变回去
	report(fmt.Sprintf("左侧留白 %.1f%%（要求 ≥18%%）", left/1024*100), left/1024 >= 0.18, sample(v, 4, cy))

	// ---- 形体二：分割的圆 ----
	fmt.Println("几何自检（split-ivory，icon 1024）：")
	vs := mk("split-ivory", "check-split", 1024, true, "icon", 1, 1)
	Rs := 1024 * vs.ratio / 2
	slit := Rs * slitRatio

	report("正中＝底色（缝压在中线上）", !isMark(vs, sample(vs, cx, cy)), sample(vs, cx, cy))

	near := -1.0
	for x := cx; x < 1024; x += 0.5 {
		if isMark(vs, sample(vs, x, cy)) {
			near = x
			break
		}
	}
	report(fmt.Sprintf("中缝右边缘 x=%.1f（设计 %.1f）", near, cx+slit/2),
		near > 0 && math.Abs(near-(cx+slit/2)) < 3, sample(vs, cx+slit/2+3, cy))

	outer := -1.0
	for x := 1024.0; x > cx; x -= 0.5 {
		if isMark(vs, sample(vs, x, cy)) {
			outer = x
			break
		}
	}
	report(fmt.Sprintf("圆的右沿 x=%.1f（设计 %.1f）", outer, cx+Rs),
		outer > 0 && math.Abs(outer-(cx+Rs)) < 3, sample(vs, cx+Rs-3, cy))
	// 缝的两端收到 0 ⇒ 圆顶圆底是连着的（否则会读成"两片"而不是"合缝"）
	report("圆顶是连着的（缝在两端收到 0）", isMark(vs, sample(vs, cx, cy-Rs+3)), sample(vs, cx, cy-Rs+3))
	report("圆顶外侧仍是底色", !isMark(vs, sample(vs, cx, cy-Rs-5)), sample(vs, cx, cy-Rs-5))
	// 半高处的缝应当是全宽
	report(fmt.Sprintf("半高处的缝半宽 %.1f（设计 %.1f）", slitHalf(0, Rs, slit), slit/2),
		math.Abs(slitHalf(0, Rs, slit)-slit/2) < 0.01, sample(vs, cx+slit/2+3, cy))

	// 缝在四分之一高度应摆到 +seamAmp*R 一侧（正弦确实在做事，不是直缝）
	got := seamOffset(-Rs/2, Rs)
	report(fmt.Sprintf("缝在半高处摆到 %.1f（设计 %.1f）", got, seamAmp*Rs),
		math.Abs(got-seamAmp*Rs) < 0.5, sample(vs, cx+got+slit, cy-Rs/2))

	// ---- 透明底与单色层 ----
	fg := mk("rings-ivory", "fg", 512, false, "adaptive", 1.15, 1)
	report("透明底变体的角落是全透明", sample(fg, 2, 2).A == 0, sample(fg, 2, 2))
	mv := mk("rings-ivory", "mono", 432, false, "adaptive", 1.3, 1)
	mv.flat = true
	Rm, Dm, _ := ringsGeom(432*mv.ratio, 1.3)
	report("单色层的环是不透明的白", sample(mv, 216-Dm-Rm, 216) == white, sample(mv, 216-Dm-Rm, 216))

	// ---- 字标（相悦）----
	//
	// 字面本身的"像不像"没法解析式断言（那是审美，交给对照图），但**排版对不对**
	// 可以：字是不是两个字、星光在不在右上角、笔画密度是否正常、字有没有上下颠倒。
	fmt.Println("字标自检（wordmark-ink，icon 1024）：")
	wv := mk("wordmark-ink", "check", 1024, true, "icon", 1, 1)
	// 轮廓朝向：CJK 字形落在基线上方，y 向下 ⇒ 上沿是负数。抽错了方向（y 没翻）
	// 这张图会上下颠倒，而覆盖率之类的指标**照样能过**——所以单独钉一条。
	report("字形上沿在基线之上（y 向下 ⇒ 负）",
		glyphInk[0].Y0 < -800 && glyphInk[1].Y0 < -800 && glyphInk[0].Y1 < 200,
		wv.th.mark)

	mkMask := wordMask(wordMaskH)
	// 覆盖率：在墨迹盒里按网格统计（汉字笔画密度大约 1/5～1/4）
	var inkAll, inkLeft, inkRight float64
	const nx, ny = 200, 100
	for i := 0; i < nx; i++ {
		for j := 0; j < ny; j++ {
			u, vv := (float64(i)+0.5)/nx, (float64(j)+0.5)/ny
			c := mkMask.cover(u, vv)
			inkAll += c
			if u < 0.5 {
				inkLeft += c
			} else {
				inkRight += c
			}
		}
	}
	inkAll /= nx * ny
	inkLeft /= nx * ny * 0.5
	inkRight /= nx * ny * 0.5
	// 密度区间按**实测**给：Noto Sans SC 的 Black 字重笔画很粗，两个字在墨迹盒里的
	// 墨占比就是 55% 上下（字腔是空的，看图确认过）。这条断言防的是"整体糊成一块"
	// （比如填充规则错、把字腔填实）和"几乎没画上"，不是审美判断。
	report(fmt.Sprintf("墨迹密度 %.1f%%（预期 20–65%%）", inkAll*100), inkAll > 0.20 && inkAll < 0.65, wv.th.mark)
	report(fmt.Sprintf("左字与右字都有墨（%.0f%% / %.0f%%）", inkLeft*100, inkRight*100), inkLeft > 0.05 && inkRight > 0.05, wv.th.mark)

	// 星光：落在墨迹盒最右侧、靠上。它的中心位置由排版算出来，不写死。
	lw := wordLayout()
	scx := lw.x1 - sparkleR
	scy := lw.y0 + sparkleR
	su := (scx - lw.x0) / (lw.x1 - lw.x0)
	sv := (scy - lw.y0) / (lw.y1 - lw.y0)
	starInk := mkMask.cover(su, sv)
	report(fmt.Sprintf("星光中心 (%.2f, %.2f) 有墨（%.0f%%）", su, sv, starInk*100), starInk > 0.6, wv.th.mark)
	report("星光在最右侧（探出字形之外）", su > 0.95 && mkMask.cover(0.999, sv) > 0.05, wv.th.mark)

	// ---- 每个方案、每个尺寸都不能贴边（Android 自适应还要留够裁切余量）----
	fmt.Println("留白检查（各方案 × 各尺寸）：")
	for _, d := range designs {
		for _, use := range []string{"icon", "adaptive", "favicon"} {
			vv := mk(d.key, d.key, 256, true, use, 1.3, 1.3)
			half := 0.5 * 256 * vv.ratio
			if vv.kind == kindRings {
				_, Dv, Wv := ringsGeom(256*vv.ratio, 1.3)
				half = Dv + (256*vv.ratio-Wv)/(2*(1+kOverlap)) + Wv/2
			}
			blank := 0.5 - half/256
			// 各处对留白的要求不一样：
			//   adaptive 的图形最外缘必须落在内切圆（半径 33.3%）以内，留够裁切余量；
			//   favicon 只有 48px，本来就该占满一点，不然线细到看不见。
			min := 0.18
			if use == "adaptive" {
				min = 0.17
			} else if use == "favicon" {
				min = 0.10
			}
			report(fmt.Sprintf("%s/%s 留白 %.1f%% ≥ %.0f%%", d.key, use, blank*100, min*100), blank >= min, vv.th.bg)
		}
	}
	return ok
}

/* ---------------------------------------------------------------- SVG */

// svg 用与光栅化同一组参数导出矢量版，保证两边不会各自漂移。
func svg(size int, key string) string {
	n := float64(size)
	cx, cy := n/2, n/2
	k, th := findDesign(key)
	if k == kindWordmark {
		// 字标：直接把同一份字形轮廓当 <path>，不做字体依赖——网页端也不需要装字体
		M := n * markRatio(k, "icon")
		x0, y0, w0, h0 := wordViewBox()
		s := M / w0
		tx, ty := cx-M/2-x0*s, cy-h0*s/2-y0*s
		var paths strings.Builder
		for _, p := range wordPaths() {
			fmt.Fprintf(&paths, "    <path d=%q", p.D)
			if p.Dx != 0 {
				fmt.Fprintf(&paths, " transform=\"translate(%.0f 0)\"", p.Dx)
			}
			paths.WriteString("/>\n")
		}
		return fmt.Sprintf(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 %d %d" width="%d" height="%d">
  <title>相悦</title>
  <rect width="%d" height="%d" fill="%s"/>
  <g fill="%s" transform="translate(%.3f %.3f) scale(%.6f)">
%s  </g>
</svg>
`, size, size, size, size, size, size, cssHex(th.bg), cssHex(th.mark), tx, ty, s, paths.String())
	}
	if k == kindRings {
		M := n * markRatio(k, "icon")
		R, D, W := ringsGeom(M, 1)
		return fmt.Sprintf(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 %d %d" width="%d" height="%d">
  <title>相悦</title>
  <rect width="%d" height="%d" fill="%s"/>
  <g fill="none" stroke="%s" stroke-width="%.2f">
    <circle cx="%.2f" cy="%.2f" r="%.2f"/>
    <circle cx="%.2f" cy="%.2f" r="%.2f"/>
  </g>
</svg>
`, size, size, size, size, size, size, cssHex(th.bg), cssHex(th.mark), W, cx-D, cy, R, cx+D, cy, R)
	}

	// 分割的圆：两半各用采样点连成多边形。
	// 弧线也用折线——arc 命令的 sweep-flag 极易写反（上一版就写反过）。
	M := n * markRatio(k, "icon")
	R := M / 2
	slit := R * slitRatio
	steps := 160
	arc := func(from, to float64) []string {
		var pts []string
		for i := 0; i <= steps; i++ {
			a := from + (to-from)*float64(i)/float64(steps)
			pts = append(pts, fmt.Sprintf("%.2f,%.2f", cx+R*math.Cos(a), cy+R*math.Sin(a)))
		}
		return pts
	}
	// 缝的一侧：sign=−1 取缝的左边缘，+1 取右边缘
	seam := func(sign float64, topToBottom bool) []string {
		var pts []string
		for i := 0; i <= steps; i++ {
			t := float64(i) / float64(steps)
			if !topToBottom {
				t = 1 - t
			}
			dy := -R + 2*R*t
			pts = append(pts, fmt.Sprintf("%.2f,%.2f", cx+seamOffset(dy, R)+sign*slitHalf(dy, R, slit), cy+dy))
		}
		return pts
	}
	// 左半：圆顶 → 沿缝下行 → 沿左弧（π→2π）回到圆顶
	leftHalf := append(seam(-1, true), arc(math.Pi, 2*math.Pi)...)
	// 右半：圆底 → 沿缝上行 → 沿右弧（0→π）回到圆底
	rightHalf := append(seam(1, false), arc(0, math.Pi)...)
	return fmt.Sprintf(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 %d %d" width="%d" height="%d">
  <title>相悦</title>
  <rect width="%d" height="%d" fill="%s"/>
  <polygon points="%s" fill="%s"/>
  <polygon points="%s" fill="%s"/>
</svg>
`, size, size, size, size, size, size, cssHex(th.bg),
		strings.Join(leftHalf, " "), cssHex(th.mark),
		strings.Join(rightHalf, " "), cssHex(th.mark))
}

func cssHex(c color.RGBA) string { return fmt.Sprintf("#%02X%02X%02X", c.R, c.G, c.B) }

/* ------------------------------------------------------------- 预览图 */

func label(dst *image.RGBA, x, y int, s string, scale int) {
	small := image.NewRGBA(image.Rect(0, 0, 150, 14))
	d := &font.Drawer{Dst: small, Src: image.NewUniform(color.RGBA{0x6B, 0x61, 0x5A, 255}),
		Face: basicfont.Face7x13, Dot: fixed.P(0, 11)}
	d.DrawString(s)
	xdraw.NearestNeighbor.Scale(dst, image.Rect(x, y, x+150*scale, y+14*scale), small, small.Bounds(), xdraw.Over, nil)
}

// overlay 把"透明底 + 指定图形色"的图形叠到已经画好的底上
func overlay(img *image.RGBA, x, y int, key string, size int, use string, mark color.RGBA) {
	v := mk(key, "overlay", size, false, use, 1.3, 1.3)
	v.th = theme{bg: color.RGBA{}, mark: mark}
	draw.Draw(img, image.Rect(x, y, x+size, y+size), render(v, 3), image.Point{}, draw.Over)
}

// drawRounded 把一张方形图标按 iOS 的圆角比例贴到目标上（边缘按覆盖率抗锯齿）。
// 对照图上要看"在手机桌面上长什么样"，所以必须带圆角——直角方块是看不出来的。
func drawRounded(dst *image.RGBA, src *image.RGBA, x, y int, r float64) {
	s := float64(src.Bounds().Dx())
	blend := func(sc, dc uint8, a float64) uint8 {
		return uint8(math.Round(float64(sc)*a + float64(dc)*(1-a)))
	}
	for py := 0; py < int(s); py++ {
		for px := 0; px < int(s); px++ {
			c := src.RGBAAt(px, py)
			dx := math.Min(float64(px), s-1-float64(px))
			dy := math.Min(float64(py), s-1-float64(py))
			cov := 1.0
			if dx < r && dy < r {
				cov = math.Max(0, math.Min(1, r-math.Hypot(r-dx, r-dy)+0.5))
			}
			a := float64(c.A) / 255 * cov
			if a <= 0 {
				continue
			}
			d := dst.RGBAAt(x+px, y+py)
			dst.SetRGBA(x+px, y+py, color.RGBA{blend(c.R, d.R, a), blend(c.G, d.G, a), blend(c.B, d.B, a), 255})
		}
	}
}

// preview 拼对照图，分三段：
//
//  1. **桌面图标行**：所有候选按 iOS 圆角铺开——这张最关键，因为 logo 最终就是这样被看到的；
//  2. **细节列**：字标候选各出一张大图 + 88/64/44 的小尺寸（看小尺寸还认不认得出）；
//  3. **上下文**：Android 圆形遮罩、深色标题栏里的反白用法。
func preview() *image.RGBA {
	const pad, gap = 34, 26
	const cols = 3
	const iconRow, colW, big = 168, 300, 240
	rows := (len(designs) + cols - 1) / cols
	wordCount := 0
	for _, d := range designs {
		if d.kind == kindWordmark {
			wordCount++
		}
	}
	h := pad + rows*(iconRow+40) + 20 + big + 46 + 92 + 40 + 210 + pad
	w := pad + cols*(colW+gap) + pad
	img := image.NewRGBA(image.Rect(0, 0, w, h))
	// 底不用象牙白：象牙白那版的"块"会和底融在一起，看不出是个图标。
	// 用偏灰的暖白当"桌面"，任何配色都能读出边界。
	draw.Draw(img, img.Bounds(), image.NewUniform(color.RGBA{0xEC, 0xE7, 0xE1, 255}), image.Point{}, draw.Src)

	// ---- 1. 桌面图标行 ----
	y := pad
	label(img, pad, y-2, "home screen:", 2)
	y += 26
	r := iconRow * 0.2237 // iOS 的圆角比例
	for i, d := range designs {
		x := pad + (i%cols)*(colW+gap)
		yy := y + (i/cols)*(iconRow+40)
		v := mk(d.key, d.key, iconRow, true, "icon", 1, 1)
		drawRounded(img, render(v, 3), x, yy, r)
		label(img, x, yy+iconRow+10, d.key, 2)
	}

	// ---- 2. 字标细节列 ----
	y2 := pad + rows*(iconRow+40) + 20
	label(img, pad, y2-2, "wordmark detail:", 2)
	y2 += 26
	col := 0
	for _, d := range designs {
		if d.kind != kindWordmark {
			continue
		}
		x := pad + col*(colW+gap)
		draw.Draw(img, image.Rect(x, y2, x+big, y2+big), render(mk(d.key, d.key, big, true, "icon", 1, 1), 3), image.Point{}, draw.Over)
		label(img, x, y2+big+8, d.key, 2)
		sx := x
		for _, sz := range []int{88, 64, 44} {
			draw.Draw(img, image.Rect(sx, y2+big+42, sx+sz, y2+big+42+sz), render(mk(d.key, d.key, sz, true, "icon", 1.3, 1.3), 3), image.Point{}, draw.Over)
			sx += sz + 12
		}
		label(img, x, y2+big+42+88+6, "88 / 64 / 44", 2)
		col++
	}

	// ---- 3. 上下文 ----
	y3 := y2 + big + 46 + 92 + 40
	label(img, pad, y3-2, "in context:", 2)
	y3 += 26
	first := designs[0].key
	_, firstTheme := findDesign(first)
	// Android 自适应：圆形遮罩
	{
		size, bx := 150, pad
		// ⚠️ 圆心必须按**相对像素**算：原来写的是 `px-cx`，而 cx 是绝对坐标，
		// 于是这个圆一直是"画在画布外"的——标签在、圆不在，看图才发现。
		rr := float64(size) / 2
		for py := 0; py < size; py++ {
			for px := 0; px < size; px++ {
				dx, dy := float64(px)-rr, float64(py)-rr
				if dx*dx+dy*dy <= rr*rr {
					img.Set(bx+px, y3+py, firstTheme.bg)
				}
			}
		}
		fg := mk(first, "fg", size, false, "adaptive", 1.15, 1)
		draw.Draw(img, image.Rect(bx, y3, bx+size, y3+size), render(fg, 3), image.Point{}, draw.Over)
		label(img, bx, y3+size+8, "android adaptive", 2)
	}
	// 深色标题栏里的反白用法（登录页/启动页就是这种）
	{
		bx := pad + 380
		draw.Draw(img, image.Rect(bx, y3, bx+260, y3+150), image.NewUniform(ink), image.Point{}, draw.Src)
		overlay(img, bx+10, y3+15, first, 120, "mark", ivory)
		label(img, bx, y3+150+8, "on ink bar (inverse)", 2)
	}
	return img
}

/* ---------------------------------------------------------------- 主 */

func main() {
	out := flag.String("out", "../../assets", "输出 PNG 的目录")
	previewPath := flag.String("preview", "", "预览图输出路径（留空则不生成）")
	svgPath := flag.String("svg", "", "矢量版输出路径（留空则不生成）")
	design := flag.String("design", "rings-ivory", "落盘用哪个方案（"+designKeys()+"）")
	checkOnly := flag.Bool("check", false, "只做几何自检")
	flag.Parse()

	if !check() {
		if !*checkOnly {
			fmt.Println("几何自检未通过，已中止")
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
		fmt.Printf("  ✓ %-32s (矢量版)\n", *svgPath)
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
		fmt.Printf("  ✓ %-32s (对照图)\n", *previewPath)
	}
}
