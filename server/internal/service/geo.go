package service

import (
	"math"
	"strings"
)

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

// geoHashPrecision 是**落库的位数**：5 位约 4.9km × 4.9km。
//
// 这个数字是隐私旋钮，不是精度旋钮——再长就能逼近住址，再短距离就没意义了。
func geoHashPrecision() int { return 5 }

// encodeGeohash 把定位编成 geohash。
//
// 客户端给的是经纬度，**落库的只有这个网格**：既够算「大概几公里」，
// 又无法反推出住址（连成串也只能定位到一个几公里的方块）。PRD 第 15 章的口径。
func encodeGeohash(lat, lng float64, precision int) string {
	latMin, latMax := -90.0, 90.0
	lngMin, lngMax := -180.0, 180.0
	var b strings.Builder
	isLng, bits, bit := true, 0, 0
	for b.Len() < precision {
		if isLng {
			mid := (lngMin + lngMax) / 2
			if lng >= mid {
				bit = bit<<1 | 1
				lngMin = mid
			} else {
				bit <<= 1
				lngMax = mid
			}
		} else {
			mid := (latMin + latMax) / 2
			if lat >= mid {
				bit = bit<<1 | 1
				latMin = mid
			} else {
				bit <<= 1
				latMax = mid
			}
		}
		isLng = !isLng
		if bits++; bits == 5 {
			b.WriteByte(geohashBase32[bit])
			bits, bit = 0, 0
		}
	}
	return b.String()
}

// validLatLng 判断客户端给的定位是不是个正常的经纬度。
// 越界的直接忽略（**不至于让整次资料保存失败**——定位拿不到不该挡着填资料）。
func validLatLng(lat, lng float64) bool {
	return lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180
}
