// 从字体里抽出"相悦"两个字的字形轮廓，生成 gen-icons 用的 glyphs.go。
//
//	go run . /path/to/NotoSansSC_900Black.ttf > ../../glyphs.go
//
// 字体不在仓库里（Noto Sans SC 一个字重 10.5MB），需要时这样拿：
//
//	npm pack @expo-google-fonts/noto-sans-sc@0.4.4 && tar xzf noto-sans-sc-*.tgz
//	# 字体在 package/900Black/NotoSansSC_900Black.ttf，OFL 1.1 授权
//
// 为什么要抽轮廓而不是直接用字体：为了两个汉字让仓库背 10MB 不划算，而且
// 抽出来之后图标和网站 SVG 共用同一份矢量、构建机上不需要任何字体。
//
// ⚠️ 坐标约定：sfnt 给的就是 **y 向下**（基线为 0，字身在其上方为负）。
// 早先这里多手翻了一次 y，渲出来的字是**上下颠倒**的——而覆盖率类的自检
// 照样能过。gen-icons 的 -check 里有一条"字形上沿必须是负数"专门钉这个。
package main

import (
	"fmt"
	"math"
	"os"
	"strings"

	"golang.org/x/image/font"
	"golang.org/x/image/font/sfnt"
	"golang.org/x/image/math/fixed"
)

func title(s string) string { return strings.ToUpper(s[:1]) + s[1:] }

func main() {
	raw, err := os.ReadFile(os.Args[1])
	if err != nil {
		panic(err)
	}
	f, err := sfnt.Parse(raw)
	if err != nil {
		panic(err)
	}
	upm := float64(f.UnitsPerEm())

	var b strings.Builder
	b.WriteString(`// 由 tools/extract-glyphs 从 Noto Sans SC 900Black 抽出的字形轮廓。**别手改**。
//
// 为什么是轮廓而不是字体文件：这个字重一个就 10.5MB，为了两个汉字不值当。
// 抽出来之后：图标按轮廓栅格化、网站 SVG 直接用同一份 path，两边同源，
// 构建机上也不需要任何字体。坐标是**字体单位**整数值，y 向下、
// 原点在基线左端。
//
// 字体授权：Noto Sans SC 是 OFL 1.1（npm 包 @expo-google-fonts/noto-sans-sc 里那份）。

package main

`)
	fmt.Fprintf(&b, "// em 的单位数（该字体的 unitsPerEm）；用的时候除以它才是 em。\nconst glyphEm = %d\n\n", int(upm))

	type g struct{ name string; r rune }
	gs := []g{{"xiang", '相'}, {"yue", '悦'}}
	type info struct {
		adv          float64
		x0, y0, x1, y1 float64
	}
	infos := make([]info, 0, 2)

	for _, one := range gs {
		idx, err := f.GlyphIndex(nil, one.r)
		if err != nil || idx == 0 {
			panic(fmt.Sprintf("字形缺失: %c", one.r))
		}
		segs, err := f.LoadGlyph(nil, idx, fixed.Int26_6(f.UnitsPerEm()), nil)
		if err != nil {
			panic(err)
		}
		adv, err := f.GlyphAdvance(nil, idx, fixed.Int26_6(f.UnitsPerEm()), font.HintingNone)
		if err != nil {
			panic(err)
		}
		var d strings.Builder
		// 坐标：sfnt 给的是 26.6 定点，这里 ppem=unitsPerEm ⇒ 原始整数就是字体单位
		x0, y0, x1, y1 := math.Inf(1), math.Inf(1), math.Inf(-1), math.Inf(-1)
		track := func(x, y float64) {
			x0 = math.Min(x0, x); x1 = math.Max(x1, x)
			y0 = math.Min(y0, y); y1 = math.Max(y1, y)
		}
		put := func(format string, args ...any) { fmt.Fprintf(&d, format, args...) }
		for _, s := range segs {
			switch s.Op {
			case sfnt.SegmentOpMoveTo:
				put("M%d %d", s.Args[0].X, s.Args[0].Y)
				track(float64(s.Args[0].X), float64(s.Args[0].Y))
			case sfnt.SegmentOpLineTo:
				put("L%d %d", s.Args[0].X, s.Args[0].Y)
				track(float64(s.Args[0].X), float64(s.Args[0].Y))
			case sfnt.SegmentOpQuadTo:
				put("Q%d %d %d %d", s.Args[0].X, s.Args[0].Y, s.Args[1].X, s.Args[1].Y)
				track(float64(s.Args[0].X), float64(s.Args[0].Y))
				track(float64(s.Args[1].X), float64(s.Args[1].Y))
			case sfnt.SegmentOpCubeTo:
				put("C%d %d %d %d %d %d", s.Args[0].X, s.Args[0].Y, s.Args[1].X, s.Args[1].Y, s.Args[2].X, s.Args[2].Y)
				track(float64(s.Args[0].X), float64(s.Args[0].Y))
				track(float64(s.Args[1].X), float64(s.Args[1].Y))
				track(float64(s.Args[2].X), float64(s.Args[2].Y))
			}
		}
		infos = append(infos, info{float64(adv), x0, y0, x1, y1})
		fmt.Fprintf(&b, "// %c：advance %.0f，墨迹 bbox x[%.0f,%.0f] y[%.0f,%.0f]（字体单位，y 向下）\n", one.r, float64(adv), x0, x1, y0, y1)
		// 一行一个字形的 path：太长的话按段折行，但保持一个字符串
		fmt.Fprintf(&b, "const glyphPath%s = %q\n\n", title(one.name), d.String())
	}
	fmt.Fprintf(&b, `// glyphInk 是两个字形的墨迹包围盒（字体单位，y 向下），排版时按它对齐、居中。
var glyphInk = [2]struct{ X0, Y0, X1, Y1, Advance float64 }{
	{%g, %g, %g, %g, %g},
	{%g, %g, %g, %g, %g},
}
`, infos[0].x0, infos[0].y0, infos[0].x1, infos[0].y1, infos[0].adv,
		infos[1].x0, infos[1].y0, infos[1].x1, infos[1].y1, infos[1].adv)

	os.Stdout.WriteString(b.String())
}
