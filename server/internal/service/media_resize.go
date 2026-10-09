package service

import (
	"bytes"
	"context"
	"fmt"
	"image"
	"image/jpeg"
	"image/png"
	"io"
	"sync"

	xdraw "golang.org/x/image/draw"

	// 注册解码器：jpeg/png 是标准库自带的，webp 需要 x/image
	_ "golang.org/x/image/webp"
)

// 缩略图尺寸。
//
// 默认 720：卡片最宽 520px（Deck 与广场都是），720 在 2x 屏上也够清晰；
// 相册九宫格里每张只有 ~130px，同一个 URL 也够用——所以整站一个尺寸就够，
// 不必按场景各存一份。
const (
	DefaultThumbWidth = 720
	MinThumbWidth     = 64
	MaxThumbWidth     = 1600
	thumbQuality      = 82
)

// Thumbnail 把图片等比缩到不超过 maxW 宽，返回字节与 MIME 类型。
//
// 只在**缩小时**才重新编码：原图本来就比目标小就直接原样返回（省一次编解码，
// 也让已经很小的图不会被二次压缩）。
//
// 为什么这件事必须做：这台机器的公网上行只有 ~0.47MB/s，而用户传的是手机原图
// （常见 2–5MB），卡片上只显示 200px。不缩的话，每张卡片首屏就是几秒钟的白块——
// 这才是「用起来卡卡的」的真正来源，而不是 SQL（接口本地 1–10ms）。
func Thumbnail(data []byte, maxW int) ([]byte, string, error) {
	if maxW < MinThumbWidth {
		maxW = MinThumbWidth
	}
	if maxW > MaxThumbWidth {
		maxW = MaxThumbWidth
	}

	src, format, err := image.Decode(bytes.NewReader(data))
	if err != nil {
		// 解不开的（例如我们不认识的编码）由调用方原样返回，
		// 不能因为缩不了图就把图片变成 404。
		return nil, "", err
	}

	b := src.Bounds()
	if b.Dx() <= maxW {
		return data, mimeOf(format), nil
	}

	h := b.Dy() * maxW / b.Dx()
	if h < 1 {
		h = 1
	}

	// CatmullRom 比标准库的最近邻好太多——最近邻缩小后的照片会有明显锯齿，
	// 而这里每张图只算一次（结果会进缓存）。
	dst := image.NewRGBA(image.Rect(0, 0, maxW, h))
	xdraw.CatmullRom.Scale(dst, dst.Bounds(), src, b, xdraw.Over, nil)

	var buf bytes.Buffer
	if hasAlpha(src) {
		// 带透明的（少见，多是 PNG 头像）保持 PNG，转 JPEG 会把透明压成黑块
		err = png.Encode(&buf, dst)
		if err != nil {
			return nil, "", err
		}
		return buf.Bytes(), "image/png", nil
	}

	if err := jpeg.Encode(&buf, dst, &jpeg.Options{Quality: thumbQuality}); err != nil {
		return nil, "", err
	}
	return buf.Bytes(), "image/jpeg", nil
}

func mimeOf(format string) string {
	switch format {
	case "jpeg":
		return "image/jpeg"
	case "png":
		return "image/png"
	case "webp":
		return "image/webp"
	case "gif":
		return "image/gif"
	default:
		return "application/octet-stream"
	}
}

func hasAlpha(src image.Image) bool {
	switch src.(type) {
	case *image.NRGBA, *image.RGBA, *image.NRGBA64, *image.RGBA64:
		// 只有真的存在非全不透明像素时才算带透明
		b := src.Bounds()
		for y := b.Min.Y; y < b.Max.Y; y++ {
			for x := b.Min.X; x < b.Max.X; x++ {
				if _, _, _, a := src.At(x, y).RGBA(); a < 0xffff {
					return true
				}
			}
		}
		return false
	}
	return false
}

// ---------- 缩略图缓存 ----------
//
// 每张图第一次请求要解码 + 缩放（一张 3MB 的照片约 50–150ms），之后同尺寸的请求
// 直接命中内存。上限按 96MB 控制——本机总内存 7.8G，这点占用无所谓，
// 但绝不能无上限地长（图片是不可控输入）。
type thumbEntry struct {
	data []byte
	ct   string
}

type thumbCache struct {
	mu    sync.Mutex
	items map[string]thumbEntry
	bytes int
	max   int
}

func newThumbCache(maxBytes int) *thumbCache {
	return &thumbCache{items: make(map[string]thumbEntry), max: maxBytes}
}

func (c *thumbCache) get(key string) (thumbEntry, bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	v, ok := c.items[key]
	return v, ok
}

func (c *thumbCache) put(key string, data []byte, ct string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if _, exists := c.items[key]; exists {
		return
	}
	// 单张就超过上限 1/8 的（异常大的图）不入缓存，免得把整个池子冲掉
	if len(data) > c.max/8 {
		return
	}
	for c.bytes+len(data) > c.max && len(c.items) > 0 {
		for k, v := range c.items { // 简单的随机淘汰：缩略图命中率均匀，不值得上 LRU
			delete(c.items, k)
			c.bytes -= len(v.data)
			break
		}
	}
	c.items[key] = thumbEntry{data: data, ct: ct}
	c.bytes += len(data)
}

// ThumbBytes 取（并缓存）缩略图。返回 false 表示这张图缩不了，
// 调用方应当原样回源——缩略图是优化，不能因为它失败就让图片打不开。
func (s *UploadService) ThumbBytes(ctx context.Context, key string, width int) ([]byte, string, bool) {
	cacheKey := fmt.Sprintf("%s@%d", key, width)
	if e, ok := s.thumbs.get(cacheKey); ok {
		return e.data, e.ct, true
	}

	obj, _, size, err := s.OpenMedia(ctx, key)
	if err != nil {
		return nil, "", false
	}
	defer obj.Close()
	if size > maxPhotoByte {
		return nil, "", false // 异常大的对象不进内存
	}
	data, err := io.ReadAll(io.LimitReader(obj, maxPhotoByte+1))
	if err != nil {
		return nil, "", false
	}

	out, ct, err := Thumbnail(data, width)
	if err != nil {
		return nil, "", false
	}
	s.thumbs.put(cacheKey, out, ct)
	return out, ct, true
}
