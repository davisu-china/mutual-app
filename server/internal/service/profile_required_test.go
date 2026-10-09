package service

import (
	"strings"
	"testing"

	"github.com/davisu-china/mutual-app/server/internal/model"
)

func i16p(v int16) *int16   { return &v }
func strp(v string) *string { return &v }

// 体重/学校/公司在 2026-10-09 改成必填（表单里同时去掉了它们的「对外公开」开关）。
// 这个用例盯住那条规则：漏填要被点出来，填齐了不能再拦人。
func TestMissingProfileFields(t *testing.T) {
	full := model.UserProfile{
		HeightCm:          175,
		WeightKg:          i16p(62),
		HometownProv:      "浙江省",
		CityCity:          "杭州市",
		Occupation:        "互联网",
		MBTI:              strp("ENFP"),
		Smoking:           1,
		Drinking:          1,
		IncomeRange:       4,
		Education:         3,
		School:            strp("某大学"),
		Company:           strp("某公司"),
		EldercarePressure: 1,
		HasHouse:          1,
		IsDink:            1,
	}
	if m := missingProfileFields(&full); len(m) != 0 {
		t.Fatalf("填齐了不该再报缺项，实际报出：%v", m)
	}

	// 只抽掉这三项，其余保持不变
	onlyNew := full
	onlyNew.WeightKg = nil
	onlyNew.School = nil
	onlyNew.Company = nil
	got := strings.Join(missingProfileFields(&onlyNew), "、")
	for _, want := range []string{"体重", "学校", "公司"} {
		if !strings.Contains(got, want) {
			t.Errorf("缺「%s」时应该报出来，实际：%q", want, got)
		}
	}
	if n := len(missingProfileFields(&onlyNew)); n != 3 {
		t.Errorf("只抽掉三项时应恰好报 3 项，实际 %d 项：%q", n, got)
	}

	// 空字符串不算填了
	blank := full
	blank.School = strp("")
	blank.Company = strp("")
	got = strings.Join(missingProfileFields(&blank), "、")
	if !strings.Contains(got, "学校") || !strings.Contains(got, "公司") {
		t.Errorf("空字符串应当作没填，实际：%q", got)
	}
}
