package service

import "math"

// geohash 字母表
const geohashBase32 = "0123456789bcdefghjkmnpqrstuvwxyz"

// decodeGeohash 把 geohash 字符串解码成经纬度中心点。
//
// 为什么不用 PostGIS：我们只需要「大概几公里」这一个用途，
// 引一个扩展 + 一次容器改造不值得（技术方案 9.1 的「避免过度设计」）。
func decodeGeohash(hash string) (lat, lng float64, ok bool) {
	if hash == "" {
		return 0, 0, false
	}

	latMin, latMax := -90.0, 90.0
	lngMin, lngMax := -180.0, 180.0
	isLng := true

	for _, c := range hash {
		idx := indexOfRune(geohashBase32, c)
		if idx < 0 {
			return 0, 0, false
		}
		for mask := 16; mask > 0; mask >>= 1 {
			if isLng {
				mid := (lngMin + lngMax) / 2
				if idx&mask != 0 {
					lngMin = mid
				} else {
					lngMax = mid
				}
			} else {
				mid := (latMin + latMax) / 2
				if idx&mask != 0 {
					latMin = mid
				} else {
					latMax = mid
				}
			}
			isLng = !isLng
		}
	}

	return (latMin + latMax) / 2, (lngMin + lngMax) / 2, true
}

func indexOfRune(s string, r rune) int {
	for i, c := range s {
		if c == r {
			return i
		}
	}
	return -1
}

// haversineKm 两点球面距离（公里）。
func haversineKm(lat1, lng1, lat2, lng2 float64) float64 {
	const earthKm = 6371.0
	rad := math.Pi / 180

	dLat := (lat2 - lat1) * rad
	dLng := (lng2 - lng1) * rad
	a := math.Sin(dLat/2)*math.Sin(dLat/2) +
		math.Cos(lat1*rad)*math.Cos(lat2*rad)*math.Sin(dLng/2)*math.Sin(dLng/2)
	return earthKm * 2 * math.Atan2(math.Sqrt(a), math.Sqrt(1-a))
}

// distanceKm 估算两个 geohash 之间的距离（公里）。
//
// 精度受 geohash 长度限制：5 位约 ±2.5km。所以对外只展示「3–5 km」这样的区间，
// 不给精确数字——既诚实，也保护隐私（PRD 第 15 章）。
func distanceKm(hashA, hashB string) (int, bool) {
	lat1, lng1, ok1 := decodeGeohash(hashA)
	lat2, lng2, ok2 := decodeGeohash(hashB)
	if !ok1 || !ok2 {
		return 0, false
	}
	return int(math.Round(haversineKm(lat1, lng1, lat2, lng2))), true
}
