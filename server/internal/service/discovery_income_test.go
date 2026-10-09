package service

import "testing"

// 期望收入的匹配：两端各自独立生效。
//
// 这条用例盯的是一个真实踩过的洞——原先写成「没设下限就整段短路」，
// 于是只设上限的人上限白设。表单改成可以只选「至多」之后它就暴露了。
func TestIncomeMatches(t *testing.T) {
	const (
		under10  = 1 // 10 万以下
		b20to30  = 3 // 20–30 万
		b50to100 = 5 // 50–100 万
		over100  = 6 // 100 万以上
		unset    = 0 // 不设下限
		noCeil   = 7 // 不设上限（刻度顶端）
	)

	cases := []struct {
		name     string
		min, max int16
		cand     int16
		want     bool
	}{
		{"两端都不设：全通过", unset, noCeil, under10, true},
		{"两端都不设：高档也通过", unset, noCeil, over100, true},

		{"只设下限：够档通过", b20to30, noCeil, b50to100, true},
		{"只设下限：不够档拦掉", b20to30, noCeil, under10, false},
		{"只设下限：正好在下限档通过", b20to30, noCeil, b20to30, true},

		{"⚠️ 只设上限：超过上限必须拦掉", unset, b20to30, b50to100, false},
		{"只设上限：在上限内通过", unset, b20to30, under10, true},
		{"只设上限：正好在上限档通过", unset, b20to30, b20to30, true},

		{"上下限都设：区间内通过", b20to30, b50to100, b20to30, true},
		{"上下限都设：低于下限拦掉", b20to30, b50to100, under10, false},
		{"上下限都设：高于上限拦掉", b20to30, b50to100, over100, false},

		{"上限为 0（老数据没写）等同于不设上限", b20to30, 0, over100, true},
	}

	for _, tc := range cases {
		if got := incomeMatches(tc.min, tc.max, tc.cand); got != tc.want {
			t.Errorf("%s：incomeMatches(%d,%d,%d)=%v，期望 %v",
				tc.name, tc.min, tc.max, tc.cand, got, tc.want)
		}
	}
}
