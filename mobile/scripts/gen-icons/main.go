// 相悦的 logo 生成器。
//
// 一次生成 App 图标需要的全部 PNG（各尺寸、各变体）+ 一份几何等价的 SVG + 一张预览图。
//
// **为什么是代码而不是设计文件**：这台构建机跑不了任何图形软件（内核 3.10 + glibc 2.17，
// Chromium / ImageMagick / rsvg / PIL 都装不上），但 Go 的 stdlib 能直接写 PNG。
// 用代码还有个额外好处：**几何是确定的**——改半径、环宽、配色只要重跑，
// 不会出现"设计稿改了但 48px 那个忘了重新导出"。
//
// 设计：两个相交的圆环（两个人相遇），交集处填香槟金——"相悦"就在那个交集里。
// 圆环用象牙白，底色是深酒红的竖向渐变（顶部 brand、底部 brandDeep）。
//
// 跑法：
//
//	cd mobile/scripts/gen-icons
//	go run . -out ../../assets -preview /tmp/logo-preview.png
//	go run . -check        # 只做几何自检，不写文件
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

// 取色全部来自 src/theme/index.ts，不要另起一套。
var (
	wineTop    = hex("#A32E4E") // colors.brand
	wineBottom = hex("#61182C") // colors.brandDeep
	ivory      = hex("#F7F3EE") // colors.paper
	goldTop    = hex("#E6D6BE") // colors.goldLine
	goldBottom = hex("#A8763E") // colors.gold
)

func hex(s string) color.RGBA {
	n, err := strconv.ParseUint(s[1:], 16, 32)
	if err != nil {
		panic(err)
	}
	return color.RGBA{uint8(n >> 16), uint8(n >> 8), uint8(n), 255}
}

// markSize Ratio：图形整体占画布宽度的比例。
//
// icon 用 0.62 是 iOS 图标的常规留白；Android 自适应前景要更小——
// 它会被裁进内切圆（108dp 画布里只有内 72dp 保证可见），
// 图形最外缘到中心的距离必须小于 72/108 ÷ 2 = 33.3% 的画布宽。
// 我们的图形最外缘在水平方向（左/右环的外沿），即 (D+R+W/2) = 0.4995 × markSize，
// 所以 markSize ≤ 0.667 才不越界；取 0.56 留出余量。
const (
	ratioIcon     = 0.62
	ratioAdaptive = 0.56
	ratioFavicon  = 0.70
)

// 图形自身的比例（相对 markSize）：环半径 R、圆心水平偏移 D、环宽 W。
// 三者满足 2*(D+R) + W = 1，即"图形宽度恰好等于 markSize"。
const (
	rR = 0.308
	rD = 0.157
	rW = 0.069
	// 镜头（两圆交集）的高度系数：2*sqrt(R²-D²)
	lensH = 0.530
	// 交集在 y=0 处的半宽：R - D
	lensHalfW = 0.151
)

type variant struct {
	name string
	size int
	// 背景：nil 表示透明
	bgTop, bgBottom *color.RGBA
	// 环的颜色；nil 表示用 ivory
	ring *color.RGBA
	// 交集是否填金色渐变；false 表示与环同色（单色版用）
	lensGold bool
	// 是否整个图形用单色不透明填充（Android 单色图标，系统会给它上色）
	flat bool
	ratio float64
	// 环宽倍率：小尺寸要更粗，否则缩下去就糊成一团
	strokeMul float64
}

func variants() []variant {
	return []variant{
		// App 图标：全出血，酒红渐变底 + 象牙白环 + 金色交集
		{name: "icon.png", size: 1024, bgTop: &wineTop, bgBottom: &wineBottom, lensGold: true, ratio: ratioIcon, strokeMul: 1},
		// Android 自适应图标分三层：前景（图形，透明底）、背景（纯渐变）、单色
		{name: "android-icon-foreground.png", size: 512, lensGold: true, ratio: ratioAdaptive, strokeMul: 1},
		{name: "android-icon-background.png", size: 512, bgTop: &wineTop, bgBottom: &wineBottom, ratio: 0, strokeMul: 1},
		{name: "android-icon-monochrome.png", size: 432, flat: true, ratio: ratioAdaptive, strokeMul: 1.25},
		// 启动图：透明底 + **酒红环**（启动底色是浅色，象牙白环会看不见）
		{name: "splash-icon.png", size: 1024, ring: &wineTop, lensGold: true, ratio: ratioIcon, strokeMul: 1},
		// 浏览器/网页预览用的小图：太细的环在 48px 上会消失，加粗
		{name: "favicon.png", size: 48, bgTop: &wineTop, bgBottom: &wineBottom, lensGold: true, ratio: ratioFavicon, strokeMul: 1.9},
		// 登录页的品牌方块里用（底色是酒红渐变，所以要象牙白环）
		{name: "mark.png", size: 256, lensGold: true, ratio: 0.98, strokeMul: 1},
		// 预览图上的第 4 格：酒红环放在浅色上，看看在浅底上成不成立
		{name: "_on-light.png", size: 256, ring: &wineTop, lensGold: true, ratio: 0.98, strokeMul: 1},
	}
}

// sample 返回画布坐标 (x,y) 处的颜色。sub = 每个像素的超采样数（抗锯齿）。
func sample(v variant, x, y float64) color.RGBA {
	n := float64(v.size)
	cx, cy := n/2, n/2
	M := n * v.ratio
	R := M * rR
	D := M * rD
	W := M * rW * v.strokeMul

	// 到两个圆心的距离
	dA := math.Hypot(x-(cx-D), y-cy)
	dB := math.Hypot(x-(cx+D), y-cy)
	inA := math.Abs(dA-R) <= W/2
	inB := math.Abs(dB-R) <= W/2
	inLens := dA <= R && dB <= R

	// 背景（竖向渐变）；没配背景就是透明
	var bg color.RGBA
	if v.bgTop != nil {
		t := y / n
		bg = lerp(*v.bgTop, *v.bgBottom, t)
		bg.A = 255
	}

	if v.ratio == 0 {
		return bg // 纯背景层
	}

	// 图形的颜色：单色版整体同色，否则环象牙白、交集金色（竖向渐变）
	if inLens {
		if v.flat || !v.lensGold {
			// 单色：交集与环同色（交给系统上色）
			return opaque(ivory)
		}
		g := lerp(goldTop, goldBottom, cyOf(y, cy, M))
		g.A = 255
		return g
	}
	if inA || inB {
		rc := ivory
		if v.ring != nil {
			rc = *v.ring
		}
		rc.A = 255
		return rc
	}
	return bg
}

// cyOf 把画布 y 映射到交集内部 0..1 的位置，用于金色渐变
func cyOf(y, cy, M float64) float64 {
	t := (y - (cy - M*lensH/2)) / (M * lensH)
	return math.Max(0, math.Min(1, t))
}

func opaque(c color.RGBA) color.RGBA { c.A = 255; return c }

func lerp(a, b color.RGBA, t float64) color.RGBA {
	t = math.Max(0, math.Min(1, t))
	mix := func(x, y uint8) uint8 { return uint8(float64(x)*(1-t) + float64(y)*t) }
	return color.RGBA{mix(a.R, b.R), mix(a.G, b.G), mix(a.B, b.B), 255}
}

// render 用 SS×SS 超采样渲染一张。
func render(v variant, ss int) *image.RGBA {
	img := image.NewRGBA(image.Rect(0, 0, v.size, v.size))
	inv := 1.0 / float64(ss)
	for py := 0; py < v.size; py++ {
		for px := 0; px < v.size; px++ {
			var r, g, b, a float64
			for sy := 0; sy < ss; sy++ {
				for sx := 0; sx < ss; sx++ {
					x := float64(px) + (float64(sx)+0.5)*inv
					y := float64(py) + (float64(sy)+0.5)*inv
					c := sample(v, x, y)
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

/* ----------------------------------------------------------------- 自检 */

// check 用坐标断言图形确实按设计画出来了。
//
// 这台机器看不到图，所以"设计对不对"只能靠算：图形是解析式定义的，
// 那么"正中必须是金色""左环最左点必须是象牙白""右环最右点外侧必须是底色"
// 都是可以断言的。比人眼更可靠的部分就交给它，剩下的（好不好看）交给你。
func check() bool {
	ok := true
	report := func(name string, cond bool, got color.RGBA) {
		mark := "✅"
		if !cond {
			mark = "❌"
			ok = false
		}
		fmt.Printf("  %s %-34s 取到 #%02X%02X%02X\n", mark, name, got.R, got.G, got.B)
	}
	// 金色和酒红的 RGB 很接近（#A8763E vs #A22D4D），数值容差稍松就会互相误判。
	// 可靠的区别是 G 与 B 的大小关系：暖金 G>B，酒红 G<B。
	// 判据要同时排除象牙白（#F7F3EE 也是 G>B，但 R−B 只有 9）和酒红（G<B）。
	// 金色在渐变中段是 #C7A67E，R−B≈73，所以 60 这条线站得住。
	isGold := func(c color.RGBA) bool { return c.G > c.B && int(c.R)-int(c.B) > 60 }
	near := func(c color.RGBA, want color.RGBA, tol int) bool {
		d := func(a, b uint8) int {
			v := int(a) - int(b)
			if v < 0 {
				return -v
			}
			return v
		}
		return d(c.R, want.R) <= tol && d(c.G, want.G) <= tol && d(c.B, want.B) <= tol
	}

	v := variant{name: "check", size: 1024, bgTop: &wineTop, bgBottom: &wineBottom, lensGold: true, ratio: ratioIcon, strokeMul: 1}
	M := 1024 * ratioIcon
	R, D, W := M*rR, M*rD, M*rW
	cx, cy := 512.0, 512.0

	fmt.Println("几何自检（icon 1024）：")
	// 正中 = 交集中心 = 金色
	report("正中是金色", isGold(sample(v, cx, cy)), sample(v, cx, cy))
	// 左环最左点（环中线）应该是象牙白
	report("左环最左点＝象牙白", near(sample(v, cx-D-R, cy), ivory, 6), sample(v, cx-D-R, cy))
	// 左环最右点（环中线，落在交集里）应该是金色（交集覆盖了那里）
	// 取在环带内、且稳稳落在交集里的点：正好取在环中线上会因为浮点误差
	// 让 dA 比 R 大一两个 ulp，"落在交集内"的判断就翻面了
	report("环穿过交集处被金色覆盖", isGold(sample(v, cx-D+R-W*0.2, cy)), sample(v, cx-D+R-W*0.2, cy))
	// 右环最右点＝象牙白
	report("右环最右点＝象牙白", near(sample(v, cx+D+R, cy), ivory, 6), sample(v, cx+D+R, cy))
	// 圆环外侧（越界 20px）应当是底色（酒红系）
	out := sample(v, cx-D-R-W/2-20, cy)
	report("环外侧＝底色（酒红系）", out.R > 100 && out.R < 200 && out.B < out.R, out)
	// 四角应当是底色
	report("左上角＝底色", near(sample(v, 4, 4), wineTop, 8), sample(v, 4, 4))
	// 交集上下尖点：高度应当约等于设计值
	// 量出来的边界要和解析式对得上。
	//
	// 不在 x=cx 上量交集的上下尖点：那里恰好被环带压着（环 A 的描边在 x=cx 处
	// 覆盖 y∈[cy−193, cy−142]，而交集尖点在 cy−168，落在带子里面）——量到的是
	// 环不是交集。所以改成量两处干净的边界：
	//   ① y=cy 这条水平线上，金色向右到 x = cx+(R−D) 为止（交集的右边界就是左圆）
	//   ② x=cx 这条竖直线上，从顶上往下第一个非底色像素是环的外沿
	firstNonGoldRight := -1.0
	for x := cx; x < 1024; x += 0.5 {
		if !isGold(sample(v, x, cy)) {
			firstNonGoldRight = x
			break
		}
	}
	expectRight := cx + (R - D)
	report(fmt.Sprintf("交集右边界 x=%.1f（设计 %.1f）", firstNonGoldRight, expectRight),
		firstNonGoldRight > 0 && math.Abs(firstNonGoldRight-expectRight) < 4, sample(v, expectRight-2, cy))

	firstNonBG := -1.0
	for y := 0.0; y < 1024; y += 0.5 {
		c := sample(v, cx, y)
		bg := lerp(wineTop, wineBottom, y/1024)
		if math.Abs(float64(c.R)-float64(bg.R)) > 10 || math.Abs(float64(c.G)-float64(bg.G)) > 10 || math.Abs(float64(c.B)-float64(bg.B)) > 10 {
			firstNonBG = y
			break
		}
	}
	// x=cx 上最靠上的图形像素 = 环带外沿：cy − sqrt((R+W/2)² − D²)
	expectTop := cy - math.Sqrt((R+W/2)*(R+W/2)-D*D)
	report(fmt.Sprintf("图形上沿 y=%.1f（设计 %.1f）", firstNonBG, expectTop),
		firstNonBG > 0 && math.Abs(firstNonBG-expectTop) < 4, sample(v, cx, expectTop+3))

	// 透明底变体：图形外必须完全透明
	fg := variant{name: "fg", size: 512, lensGold: true, ratio: ratioAdaptive, strokeMul: 1}
	report("透明底变体的角落是全透明", sample(fg, 2, 2).A == 0, sample(fg, 2, 2))
	report("透明底变体的环是不透明的", sample(fg, 512*ratioAdaptive*rD, 256).A == 255 || sample(fg, 512/2-512*ratioAdaptive*(rD+rR), 256).A == 255, sample(fg, 512/2-512*ratioAdaptive*(rD+rR), 256))
	return ok
}

/* ------------------------------------------------------------------ SVG */

// svg 用与光栅化同一组参数导出矢量版，保证两边不会各自漂移。
// 交集用采样点连成的多边形而不是 arc 命令：arc 的 sweep-flag 很容易写反，
// 而多点折线在 1024 个单位里看不出棱角（这里取 240 个点）。
func svg(size int, ringHex string) string {
	n := float64(size)
	cx, cy := n/2, n/2
	M := n * ratioIcon
	R, D, W := M*rR, M*rD, M*rW
	H := math.Sqrt(R*R - D*D)
	// 两个交点相对圆心的夹角（围绕 180° 的那一半）
	phi0 := math.Atan2(H, D)

	// 交集的边界：左边界是**右圆**的左弧，右边界是**左圆**的右弧。
	// 用密集折线而不是 SVG 的 arc 命令——arc 的 sweep-flag 极易写反，
	// 而 120 段折线在 512 个单位里看不出棱角。光栅那边用的是解析式判据，
	// 两边几何一致（同一组 R/D/W），所以不会各自漂移。
	var pts []string
	steps := 120
	for i := 0; i <= steps; i++ { // 右圆的左弧：下尖点 → 上尖点，中途经过最左点
		ang := math.Pi - phi0 + 2*phi0*float64(i)/float64(steps)
		pts = append(pts, fmt.Sprintf("%.2f,%.2f", cx+D+R*math.Cos(ang), cy+R*math.Sin(ang)))
	}
	for i := 0; i <= steps; i++ { // 左圆的右弧：上尖点 → 下尖点，中途经过最右点
		ang := -phi0 + 2*phi0*float64(i)/float64(steps)
		pts = append(pts, fmt.Sprintf("%.2f,%.2f", cx-D+R*math.Cos(ang), cy+R*math.Sin(ang)))
	}

	return fmt.Sprintf(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 %d %d" width="%d" height="%d">
  <title>相悦</title>
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="%s"/>
      <stop offset="1" stop-color="%s"/>
    </linearGradient>
    <linearGradient id="gold" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="%s"/>
      <stop offset="1" stop-color="%s"/>
    </linearGradient>
  </defs>
  <rect width="%d" height="%d" fill="url(#bg)"/>
  <polygon points="%s" fill="url(#gold)"/>
  <circle cx="%.2f" cy="%.2f" r="%.2f" fill="none" stroke="%s" stroke-width="%.2f"/>
  <circle cx="%.2f" cy="%.2f" r="%.2f" fill="none" stroke="%s" stroke-width="%.2f"/>
</svg>
`, size, size, size, size,
		"#A32E4E", "#61182C", "#E6D6BE", "#A8763E",
		size, size, joinPts(pts),
		cx-D, cy, R, ringHex, W,
		cx+D, cy, R, ringHex, W)
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

/* ---------------------------------------------------------------- 预览图 */

func label(dst *image.RGBA, x, y int, s string, scale int) {
	small := image.NewRGBA(image.Rect(0, 0, 90, 14))
	d := &font.Drawer{Dst: small, Src: image.NewUniform(color.RGBA{0x6B, 0x61, 0x5A, 255}),
		Face: basicfont.Face7x13, Dot: fixed.P(0, 11)}
	d.DrawString(s)
	xdraw.NearestNeighbor.Scale(dst, image.Rect(x, y, x+90*scale, y+14*scale), small, small.Bounds(), xdraw.Over, nil)
}

// preview 拼一张给人和我一起看的对照图：同一套图形在几种尺寸/底色的实际效果。
func preview(dir string) *image.RGBA {
	const pad, gap = 28, 20
	w, h := 1180, 640
	img := image.NewRGBA(image.Rect(0, 0, w, h))
	// 浅色底（模拟网页/浅色界面）
	draw.Draw(img, img.Bounds(), image.NewUniform(color.RGBA{0xF7, 0xF3, 0xEE, 255}), image.Point{}, draw.Src)

	put := func(v variant, x, y int) {
		src := render(v, 3)
		draw.Draw(img, image.Rect(x, y, x+v.size, y+v.size), src, image.Point{}, draw.Over)
	}

	// 第一行：App 图标在各尺寸下的样子（从 256 一路缩到 48）
	x := pad
	for _, s := range []int{256, 128, 96, 64, 48} {
		put(variant{size: s, bgTop: &wineTop, bgBottom: &wineBottom, lensGold: true, ratio: ratioIcon, strokeMul: 1}, x, pad)
		label(img, x, pad+s+6, fmt.Sprintf("%dpx", s), 2)
		x += s + gap
	}
	// Android 自适应：把前景放进酒红圆形（模拟系统裁切）
	{
		size := 128
		cx, cy, r := x+size/2, pad+size/2, size/2
		for py := 0; py < size; py++ {
			for px := 0; px < size; px++ {
				dx, dy := px-cx, py-cy
				if dx*dx+dy*dy <= r*r {
					img.Set(x+px, pad+py, color.RGBA{0xA3, 0x2E, 0x4E, 255})
				}
			}
		}
		put(variant{size: size, lensGold: true, ratio: ratioAdaptive, strokeMul: 1}, x, pad)
		label(img, x, pad+size+6, "android fg", 2)
		x += size + gap
	}
	// 单色（Android 会给它上色，这里用深灰示意）
	{
		size := 96
		put(variant{size: size, flat: true, ratio: ratioAdaptive, strokeMul: 1.25}, x, pad)
		label(img, x, pad+size+6, "monochrome", 2)
	}

	// 第二行：用在浅底 / 深底上的效果
	y2 := pad + 256 + 56
	put(variant{size: 160, ring: &wineTop, lensGold: true, ratio: 0.9, strokeMul: 1}, pad, y2)
	label(img, pad, y2+160+6, "on light", 2)
	{
		// 深底块
		block := image.Rect(pad+200, y2, pad+200+220, y2+160)
		draw.Draw(img, block, image.NewUniform(color.RGBA{0x1A, 0x15, 0x12, 255}), image.Point{}, draw.Src)
		put(variant{size: 160, lensGold: true, ratio: 0.9, strokeMul: 1}, pad+200+30, y2)
		label(img, pad+200, y2+160+6, "on dark", 2)
	}
	// 登录页那块品牌方块的实际样子（64pt 圆角块 + 40pt 图形）
	{
		bx, by, bs := pad+460, y2, 140
		for py := 0; py < bs; py++ {
			for px := 0; px < bs; px++ {
				t := float64(py) / float64(bs)
				c := lerp(color.RGBA{0xA3, 0x2E, 0x4E, 255}, color.RGBA{0x61, 0x18, 0x2C, 255}, t)
				img.Set(bx+px, by+py, c)
			}
		}
		put(variant{size: 92, lensGold: true, ratio: 0.98, strokeMul: 1}, bx+24, by+24)
		label(img, bx, by+bs+6, "login mark", 2)
	}
	return img
}

/* ------------------------------------------------------------------- 主 */

func main() {
	out := flag.String("out", "../../assets", "输出 PNG 的目录")
	previewPath := flag.String("preview", "", "预览图输出路径（留空则不生成）")
	svgPath := flag.String("svg", "", "矢量版输出路径（留空则不生成）")
	checkOnly := flag.Bool("check", false, "只做几何自检")
	flag.Parse()

	if *checkOnly {
		if !check() {
			os.Exit(1)
		}
		return
	}
	if !check() {
		fmt.Println("几何自检未通过，已中止")
		os.Exit(1)
	}

	if err := os.MkdirAll(*out, 0o755); err != nil {
		panic(err)
	}
	for _, v := range variants() {
		if len(v.name) > 0 && v.name[0] == '_' {
			continue // 只给预览用的，不落盘
		}
		ss := 4
		img := render(v, ss)
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
		if err := os.WriteFile(*svgPath, []byte(svg(512, "#F7F3EE")), 0o644); err != nil {
			panic(err)
		}
		fmt.Printf("  ✓ %-32s (矢量版，浏览器可直接打开)\n", *svgPath)
	}

	if *previewPath != "" {
		f, err := os.Create(*previewPath)
		if err != nil {
			panic(err)
		}
		if err := png.Encode(f, preview(*out)); err != nil {
			panic(err)
		}
		f.Close()
		fmt.Printf("  ✓ %-32s (对照图)\n", *previewPath)
	}
}
