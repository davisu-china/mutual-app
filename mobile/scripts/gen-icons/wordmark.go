package main

import (
	"fmt"
	"image"
	"math"
	"strconv"
	"strings"

	"golang.org/x/image/vector"
)

/* ------------------------------------------------------------------ 字标 */

// 字标＝"相悦"两个字 + 一个角上的星光。**没有图形**：这一版的方向就是
// 让字本身当图形（参考了用户给的"良配"——一块深色圆角方块 + 白色粗体中文）。
//
// 排版的单位全是**字体单位**（em = 1000），和 glyphs.go 的坐标同一套。
// 星光的位置也定在同一套坐标里，所以光栅化、SVG 导出可以共用一份数。
const (
	wordGap = 60 // 两个字墨迹之间的间隙（0.06em）：汉字自带字面，靠得太近会糊成一块

	sparkleR  = 84  // 星光半径（0.084em，约等于一个字宽的 9%）
	sparkleCX = 10  // 星光中心相对"悦"墨迹右沿的横向偏移（正数=探出去一点）
	sparkleCY = 30  // 星光中心相对"悦"墨迹上沿的纵向偏移
	sparkleK  = 0.30 // 凹度：控制点落在"该象限中点"与中心之间的 30% 处（0=尖，1=胖）
)

// wordLayout 把两个字 + 星光排到一起，返回整体墨迹盒（字体单位，y 向下）。
type layout struct {
	x0, y0, x1, y1 float64
	// 两个字各自的平移量（加到字形轮廓坐标上）
	dx [2]float64
}

var wordLayoutCache *layout

func wordLayout() layout {
	if wordLayoutCache != nil {
		return *wordLayoutCache
	}
	l := layout{}
	// 第一个字：把它自己的墨迹左沿挪到 0
	l.dx[0] = -glyphInk[0].X0
	// 第二个字：接在第一个字的墨迹右沿 + 间隙之后
	right1 := glyphInk[0].X1 + l.dx[0]
	l.dx[1] = right1 + wordGap - glyphInk[1].X0
	right2 := glyphInk[1].X1 + l.dx[1]

	// 横向：从 0 到"悦"右沿再往外的星光
	scx := right2 + sparkleCX
	l.x0, l.x1 = 0, scx+sparkleR
	// 纵向：两个字与星光一并取并集（两个字一样大，y 本来几乎重合）
	top := math.Min(glyphInk[0].Y0, glyphInk[1].Y0)
	bot := math.Max(glyphInk[0].Y1, glyphInk[1].Y1)
	scy := top + sparkleCY
	l.y0 = math.Min(top, scy-sparkleR)
	l.y1 = math.Max(bot, scy+sparkleR)
	wordLayoutCache = &l
	return l
}

// wordAspect 是字标整体的宽高比（排版后固定）。
func wordAspect() float64 {
	l := wordLayout()
	return (l.x1 - l.x0) / (l.y1 - l.y0)
}

// sparklePath 返回星光的路径（**同一套字体单位坐标**，绝对位置）。
// 四个尖角用二次曲线连，控制点往中心收 ⇒ 四边凹进去，才是"星光"而不是"菱形"。
func sparklePath() string {
	l := wordLayout()
	scx := l.x1 - sparkleR
	scy := l.y0 + sparkleR
	// 四个尖角：上、右、下、左
	pts := [4][2]float64{{scx, scy - sparkleR}, {scx + sparkleR, scy}, {scx, scy + sparkleR}, {scx - sparkleR, scy}}
	var b strings.Builder
	fmt.Fprintf(&b, "M%.0f %.0f", pts[0][0], pts[0][1])
	for i := 0; i < 4; i++ {
		p, q := pts[i], pts[(i+1)%4]
		// 控制点：该象限中点再往中心收 sparkleK 的比例
		mx, my := (p[0]+q[0])/2, (p[1]+q[1])/2
		cx := mx + (scx-mx)*sparkleK
		cy := my + (scy-my)*sparkleK
		fmt.Fprintf(&b, "Q%.0f %.0f %.0f %.0f", cx, cy, q[0], q[1])
	}
	b.WriteString("Z")
	return b.String()
}

/* ------------------------------------------------------------- 轮廓解析 */

// addPath 把 gen 出来的 path 字符串喂进光栅化器。
//
// 数据是**自己生成的**，格式很规整：每个命令后面紧跟它需要的整数坐标。
// 所以这里不做通用 SVG 解析，只在遇到新命令时结算上一段。
func addPath(r *vector.Rasterizer, d string, tr func(x, y float64) (float32, float32)) {
	var op byte
	var args []float64
	flush := func() {
		switch op {
		case 'M':
			x, y := tr(args[0], args[1])
			r.MoveTo(x, y)
		case 'L':
			x, y := tr(args[0], args[1])
			r.LineTo(x, y)
		case 'Q':
			x0, y0 := tr(args[0], args[1])
			x1, y1 := tr(args[2], args[3])
			r.QuadTo(x0, y0, x1, y1)
		case 'C':
			x0, y0 := tr(args[0], args[1])
			x1, y1 := tr(args[2], args[3])
			x2, y2 := tr(args[4], args[5])
			r.CubeTo(x0, y0, x1, y1, x2, y2)
		case 'Z':
			r.ClosePath()
		default:
			panic("未知路径命令: " + string(op))
		}
		args = args[:0]
	}
	i := 0
	for i < len(d) {
		ch := d[i]
		switch {
		case ch == ' ' || ch == ',':
			i++
		case ch >= 'A' && ch <= 'Z':
			if op != 0 {
				flush()
			}
			op = ch
			i++
		default:
			j := i
			for j < len(d) && (d[j] == '-' || (d[j] >= '0' && d[j] <= '9')) {
				j++
			}
			if j == i {
				panic("路径解析卡在: " + d[i:])
			}
			v, err := strconv.ParseFloat(d[i:j], 64)
			if err != nil {
				panic(err)
			}
			args = append(args, v)
			i = j
		}
	}
	if op != 0 {
		flush()
	}
}

/* --------------------------------------------------------------- 掩膜 */

// mask 是字标的高分辨率覆盖率掩膜（0=底，1=墨）。
type mask struct {
	a    *image.Alpha
	w, h int
}

var maskCache map[int]*mask

// wordMaskH 是栅格化字标用的固定精度（掩膜高度，单位像素）。
// 与图标尺寸无关：比最大的图标还大一个数量级，所以任何尺寸取样都不糊。
const wordMaskH = 2048

// wordMask 在**指定的像素高度**上栅格化字标（跟屏幕尺寸无关，只跟需要的精度有关）。
func wordMask(height int) *mask {
	if maskCache == nil {
		maskCache = map[int]*mask{}
	}
	if m, ok := maskCache[height]; ok {
		return m
	}
	l := wordLayout()
	w := int(math.Round(float64(height) * (l.x1 - l.x0) / (l.y1 - l.y0)))
	s := float64(height) / (l.y1 - l.y0)
	// 屏幕坐标 = (字体坐标 - 墨迹盒左上角) * s
	tr := func(x, y float64) (float32, float32) {
		return float32((x - l.x0) * s), float32((y - l.y0) * s)
	}
	r := vector.NewRasterizer(w, height)
	for i, d := range []string{glyphPathXiang, glyphPathYue} {
		dx := l.dx[i]
		addPath(r, d, func(x, y float64) (float32, float32) { return tr(x+dx, y) })
	}
	addPath(r, sparklePath(), tr)

	img := image.NewAlpha(image.Rect(0, 0, w, height))
	r.Draw(img, img.Bounds(), image.Opaque, image.Point{})
	m := &mask{a: img, w: w, h: height}
	maskCache[height] = m
	return m
}

// cover 取覆盖率：给定字标墨迹盒内的归一化坐标（0..1，左上为原点），
// 双线性插值——掩膜本身带抗锯齿，图标又被超采样，两者叠加边缘已经很干净。
func (m *mask) cover(u, v float64) float64 {
	if u < 0 || u > 1 || v < 0 || v > 1 {
		return 0
	}
	fx := u*float64(m.w-1) - 0.5
	fy := v*float64(m.h-1) - 0.5
	x0, y0 := int(math.Floor(fx)), int(math.Floor(fy))
	tx, ty := fx-float64(x0), fy-float64(y0)
	clamp := func(v, hi int) int {
		if v < 0 {
			return 0
		}
		if v > hi {
			return hi
		}
		return v
	}
	at := func(x, y int) float64 { return float64(m.a.AlphaAt(clamp(x, m.w-1), clamp(y, m.h-1)).A) / 255 }
	top := at(x0, y0)*(1-tx) + at(x0+1, y0)*tx
	bot := at(x0, y0+1)*(1-tx) + at(x0+1, y0+1)*tx
	return top*(1-ty) + bot*ty
}

/* ---------------------------------------------------- SVG 用的路径字符串 */

// wordPaths 返回 (path, 每个 path 的平移量)，坐标都是字体单位。
// SVG 那边套一个 `<g transform>` 就能复用同一份几何。
func wordPaths() []struct {
	D  string
	Dx float64
} {
	l := wordLayout()
	return []struct {
		D  string
		Dx float64
	}{
		{glyphPathXiang, l.dx[0]},
		{glyphPathYue, l.dx[1]},
		{sparklePath(), 0},
	}
}

// wordViewBox 给出整体墨迹盒（字体单位），SVG 里当 transform 的基准。
func wordViewBox() (x0, y0, w, h float64) {
	l := wordLayout()
	return l.x0, l.y0, l.x1 - l.x0, l.y1 - l.y0
}
