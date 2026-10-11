package service

import (
	"context"
	"fmt"
	"strings"
	"testing"
	"time"

	"github.com/davisu-china/mutual-app/server/internal/model"
)

// geohash 编码。
//
// 这套代码里"编码"和"解码"是分开写的两段，错了**不会报错**：编出来的网格偏一点点，
// 距离就整体错一点点，没有任何地方会红。所以这里既对标准向量，也对"编了再解"的自洽性。
func TestEncodeGeohash(t *testing.T) {
	// 规范里那个经典例子（geohash 维基百科）：11 位
	if got := encodeGeohash(57.64911, 10.40744, 11); got != "u4pruydqqvj" {
		t.Errorf("标准向量对不上：想要 u4pruydqqvj，得到 %q", got)
	}

	// 位数就是位数
	if got := encodeGeohash(31.2304, 121.4737, 5); len(got) != 5 {
		t.Errorf("5 位精度应当返回 5 个字符，得到 %q", got)
	}
	// 字母表里不能出现 a/i/l/o（那四个不在 geohash 的 base32 里）
	if got := encodeGeohash(31.2304, 121.4737, 8); strings.ContainsAny(got, "ailo") {
		t.Errorf("geohash 字母表不该包含 a/i/l/o：%q", got)
	}
}

func TestEncodeDecodeRoundTrip(t *testing.T) {
	cities := []struct {
		name     string
		lat, lng float64
	}{
		{"上海", 31.2304, 121.4737},
		{"北京", 39.9042, 116.4074},
		{"杭州", 30.2741, 120.1551},
		{"乌鲁木齐", 43.8256, 87.6168},
	}
	for _, c := range cities {
		hash := encodeGeohash(c.lat, c.lng, geoHashPrecision())
		lat, lng, ok := decodeGeohash(hash)
		if !ok {
			t.Fatalf("%s：编出来的 %q 解不回去", c.name, hash)
		}
		// 5 位格子约 4.9km × 4.9km，中心点离原点的误差必然小于一个格子
		if km := haversineKm(c.lat, c.lng, lat, lng); km > 4 {
			t.Errorf("%s：编解码误差 %.1fkm，超过一个 5 位格子", c.name, km)
		}
	}

	// 同一栋楼里的两个人应当落在**同一个格子**（这正是隐私保护起作用的证据：
	// 网格比"一个小区"粗，反推不出具体地址）；隔了上千公里就必须不同格
	sameA := encodeGeohash(31.2304, 121.4737, 5)
	sameB := encodeGeohash(31.2304+0.008, 121.4737+0.008, 5) // 约 1km 外
	if sameA != sameB {
		t.Errorf("1km 内的两点应当同行：%q vs %q", sameA, sameB)
	}
	if encodeGeohash(39.9042, 116.4074, 5) == sameA {
		t.Error("北京和上海不该落在同一个 5 位格子里")
	}
}

// 保存资料时的写入口径。
//
// 这里原来有个真 bug：`Update` 无条件把 geo_hash 置空（注释写着"由现居地派生，
// 由外部补"，但外部从来没有补过），于是**每次保存资料都把网格冲掉**，
// 卡片的距离标因此从来没出现过。现在：给了定位就算，没给就保持原值。
func TestIntegrationProfileGeoHash(t *testing.T) {
	db := testDB(t)
	ctx := context.Background()
	suffix := fmt.Sprintf("%d", time.Now().UnixNano()%100000000)

	u := seedUser(t, db, "130"+suffix, model.GenderFemale, 165)
	cleanUsers(t, db, u.ID)
	svc := NewProfileService(db, NewExposureService(db))

	geoHash := func() *string {
		t.Helper()
		var p model.UserProfile
		if err := db.First(&p, u.ID).Error; err != nil {
			t.Fatal(err)
		}
		return p.GeoHash
	}

	// ① 带定位保存 → 落一个 5 位网格
	lat, lng := 31.2304, 121.4737
	if err := svc.Update(ctx, u.ID, UpdateProfileInput{Lat: &lat, Lng: &lng}); err != nil {
		t.Fatalf("保存失败: %v", err)
	}
	got := geoHash()
	if got == nil || len(*got) != geoHashPrecision() {
		t.Fatalf("应当落一个 %d 位网格，实际 %v", geoHashPrecision(), got)
	}
	first := *got

	// ② 不带定位再存一次（改个身高）→ **不能被清掉**
	height := int16(166)
	if err := svc.Update(ctx, u.ID, UpdateProfileInput{HeightCm: &height}); err != nil {
		t.Fatalf("保存失败: %v", err)
	}
	if again := geoHash(); again == nil || *again != first {
		t.Errorf("不带定位保存不该动已有网格：原来 %q，现在 %v", first, again)
	}

	// ③ 越界的坐标直接忽略，不至于让整次保存失败
	badLat, badLng := 999.0, 999.0
	if err := svc.Update(ctx, u.ID, UpdateProfileInput{Lat: &badLat, Lng: &badLng}); err != nil {
		t.Fatalf("越界坐标不该让保存失败: %v", err)
	}
	if again := geoHash(); again == nil || *again != first {
		t.Errorf("越界坐标应当被忽略：原来 %q，现在 %v", first, again)
	}

	// ④ 换到另一个城市 → 网格跟着换
	lat2, lng2 := 39.9042, 116.4074
	if err := svc.Update(ctx, u.ID, UpdateProfileInput{Lat: &lat2, Lng: &lng2}); err != nil {
		t.Fatal(err)
	}
	if again := geoHash(); again == nil || *again == first {
		t.Errorf("换了城市网格应当变化：%v", again)
	}
}

// 两个人都有网格时给「几公里」，只要缺一个就退回「同城/同省/异地」——
// 那一格不该是空的（今天所有人都是缺网格的那一半）。
func TestFillDistanceFallback(t *testing.T) {
	sh := "wtw3s" // 上海附近
	bj := "wx4g0" // 北京附近
	me := &Candidate{CityProv: "上海市", CityCity: "上海市", GeoHash: &sh}

	nearby := &Candidate{CityProv: "上海市", CityCity: "上海市", GeoHash: &sh}
	var card CardView
	fillDistance(&card, me, nearby)
	if !card.HasDistance || card.DistanceFrom > 3 {
		t.Errorf("同格应当给个很近的距离，实际 %+v", card)
	}
	if card.DistanceLabel != "" {
		t.Errorf("有精确距离时不该同时给粗标签，实际 %q", card.DistanceLabel)
	}

	// 同城但没网格（对方还没授权定位）→ 「同城」
	var c2 CardView
	fillDistance(&c2, me, &Candidate{CityProv: "上海市", CityCity: "上海市"})
	if c2.HasDistance || c2.DistanceLabel != "同城" {
		t.Errorf("没网格时应当给「同城」，实际 %+v", c2)
	}

	// 同省不同城 → 「同省」；跨省 → 「异地」
	var c3 CardView
	fillDistance(&c3, me, &Candidate{CityProv: "江苏省", CityCity: "苏州市"})
	if c3.DistanceLabel != "异地" {
		t.Errorf("跨省应当是「异地」，实际 %q", c3.DistanceLabel)
	}
	me2 := &Candidate{CityProv: "江苏省", CityCity: "南京市"}
	var c4 CardView
	fillDistance(&c4, &Candidate{CityProv: "江苏省", CityCity: "苏州市", GeoHash: &bj}, me2)
	if c4.HasDistance || c4.DistanceLabel != "同省" {
		t.Errorf("同省不同城应当是「同省」，实际 %+v", c4)
	}
}
