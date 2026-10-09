package service

// incomeMatches 判断候选人的收入档位是否落在期望区间内。
//
// 两个参数都是档位下标（1–6 对应六档收入）：min 为 0 表示不设下限，
// max 为 0 或 7 表示不设上限（7 是刻度的顶端，前端用它表示「不限」）。
//
// 两端必须**各自独立**判断。原先写成 `min == 0 || (cand >= min && cand <= max)`，
// 只要没设下限就整段短路——于是「只设上限」的人，上限等于白设。
// 表单改成按档位点选（可以只选「至多」）之后这个洞就露出来了。
func incomeMatches(min, max, cand int16) bool {
	if min > 0 && cand < min {
		return false
	}
	if max > 0 && max < 7 && cand > max {
		return false
	}
	return true
}
