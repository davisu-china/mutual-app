package service

import (
	"bytes"
	"image"
	"image/color"
	"image/jpeg"
	"image/png"
	"testing"
)

// 造一张有噪点的大图：纯色图 JPEG 压得太好，量不出「缩小后体积骤降」的效果。
func bigJPEG(t *testing.T, w, h int) []byte {
	t.Helper()
	img := image.NewRGBA(image.Rect(0, 0, w, h))
	seed := uint32(12345)
	for y := 0; y < h; y++ {
		for x := 0; x < w; x++ {
			seed = seed*1103515245 + 12345
			img.Set(x, y, color.RGBA{uint8(seed >> 16), uint8(seed >> 8), uint8(seed), 255})
		}
	}
	var buf bytes.Buffer
	if err := jpeg.Encode(&buf, img, &jpeg.Options{Quality: 95}); err != nil {
		t.Fatal(err)
	}
	return buf.Bytes()
}

func TestThumbnailDownscales(t *testing.T) {
	src := bigJPEG(t, 3000, 2000)

	out, ct, err := Thumbnail(src, DefaultThumbWidth)
	if err != nil {
		t.Fatalf("缩放失败: %v", err)
	}
	if ct != "image/jpeg" {
		t.Fatalf("不带透明的图应当编成 jpeg，实际 %s", ct)
	}

	img, _, err := image.Decode(bytes.NewReader(out))
	if err != nil {
		t.Fatalf("缩略图解不开: %v", err)
	}
	if got := img.Bounds().Dx(); got != DefaultThumbWidth {
		t.Fatalf("宽度应为 %d，实际 %d", DefaultThumbWidth, got)
	}
	if got := img.Bounds().Dy(); got != 2000*DefaultThumbWidth/3000 {
		t.Fatalf("高度应当等比，实际 %d", got)
	}

	// 这才是重点：体积要真的降下来（0.47MB/s 的上行下，几 MB 原图要好几秒）
	if len(out) >= len(src)/4 {
		t.Fatalf("缩略图没有明显变小：原图 %d 字节，缩略图 %d 字节", len(src), len(out))
	}
	t.Logf("3000×2000 JPEG：%d KB → %d KB（%d%%）", len(src)/1024, len(out)/1024, len(out)*100/len(src))
}

// 已经比目标小的图不该被重新编码（免得二次压缩掉画质、也白费 CPU）
func TestThumbnailKeepsSmallImages(t *testing.T) {
	small := bigJPEG(t, 320, 240)
	out, ct, err := Thumbnail(small, DefaultThumbWidth)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(out, small) {
		t.Fatal("比目标小的图应当原样返回")
	}
	if ct != "image/jpeg" {
		t.Fatalf("MIME 应当保持 jpeg，实际 %s", ct)
	}
}

// 透明图不能被压成黑块
func TestThumbnailKeepsAlpha(t *testing.T) {
	img := image.NewRGBA(image.Rect(0, 0, 1200, 1200))
	for y := 0; y < 1200; y++ {
		for x := 0; x < 1200; x++ {
			if x > 600 {
				continue // 右半边全透明
			}
			img.Set(x, y, color.RGBA{200, 30, 60, 255})
		}
	}
	var buf bytes.Buffer
	if err := png.Encode(&buf, img); err != nil {
		t.Fatal(err)
	}

	out, ct, err := Thumbnail(buf.Bytes(), 720)
	if err != nil {
		t.Fatal(err)
	}
	if ct != "image/png" {
		t.Fatalf("带透明的图应当保持 png，实际 %s", ct)
	}
	thumb, _, err := image.Decode(bytes.NewReader(out))
	if err != nil {
		t.Fatal(err)
	}
	if _, _, _, a := thumb.At(700, 600).RGBA(); a != 0 {
		t.Fatal("原本透明的地方在缩略图里应当仍然透明")
	}
}

// 解不开的字节必须返回错误（由调用方原样回源），不能把图片变成 404
func TestThumbnailRejectsGarbage(t *testing.T) {
	if _, _, err := Thumbnail([]byte("这不是一张图"), 720); err == nil {
		t.Fatal("非法输入应当报错")
	}
}

// 宽度会被夹到合理区间（防止 ?w=999999 这种请求把内存打爆）
func TestThumbnailClampsWidth(t *testing.T) {
	src := bigJPEG(t, 3000, 2000)
	out, _, err := Thumbnail(src, 1)
	if err != nil {
		t.Fatal(err)
	}
	img, _, _ := image.Decode(bytes.NewReader(out))
	if img.Bounds().Dx() != MinThumbWidth {
		t.Fatalf("过小的宽度应当夹到 %d，实际 %d", MinThumbWidth, img.Bounds().Dx())
	}

	out, _, err = Thumbnail(src, 999999)
	if err != nil {
		t.Fatal(err)
	}
	img, _, _ = image.Decode(bytes.NewReader(out))
	if img.Bounds().Dx() != MaxThumbWidth {
		t.Fatalf("过大的宽度应当夹到 %d，实际 %d", MaxThumbWidth, img.Bounds().Dx())
	}
}

func TestThumbCacheEvicts(t *testing.T) {
	c := newThumbCache(1000)
	for i := 0; i < 20; i++ {
		c.put(string(rune('a'+i)), bytes.Repeat([]byte{1}, 100), "image/jpeg")
	}
	if c.bytes > c.max {
		t.Fatalf("缓存超出上限：%d > %d", c.bytes, c.max)
	}
}
