package service

import (
	"reflect"
	"testing"
)

// 推荐卡下半部分那三样东西（理由 / 共同兴趣 / 自述）里，前两样是这两个纯函数算的。
// 它们不碰数据库，所以这个文件里没有任何 TEST_DSN 判断——永远会跑。

func TestForwardScoreCollectsHitLabels(t *testing.T) {
	me := &Candidate{
		PrefHeightMin: 165, PrefHeightMax: 180,
		PrefEducationMin: 3,
		PrefIncomeMin:    3, PrefIncomeMax: 5,
		PrefDink:          2, // 不接受丁克
	}
	hit := &Candidate{HeightCm: 172, Education: 4, Income: 4, IsDink: 2}

	score, hits, miss := forwardScore(me, hit)
	if score != 1 {
		t.Errorf("全部命中时分数应为 1，实际 %v", score)
	}
	if len(miss) != 0 {
		t.Errorf("不该有未命中项，实际 %v", miss)
	}
	want := []string{"身高合适", "学历达标", "收入合适", "丁克一致"}
	if !reflect.DeepEqual(hits, want) {
		t.Errorf("命中标签应为 %v，实际 %v", want, hits)
	}
}

func TestForwardScoreMissesDoNotLeakIntoHits(t *testing.T) {
	me := &Candidate{PrefHeightMin: 175, PrefHeightMax: 190, PrefEducationMin: 4}
	c := &Candidate{HeightCm: 160, Education: 2}

	score, hits, miss := forwardScore(me, c)
	if score != 0 {
		t.Errorf("全不命中时分数应为 0，实际 %v", score)
	}
	if len(hits) != 0 {
		t.Errorf("没命中就不该有理由——理由是给「为什么推荐」用的，不能拿未命中项凑数：%v", hits)
	}
	// `miss` 的措辞和 `hits` 是两套：前者是给"部分条件不符"那行用的列名词
	if !reflect.DeepEqual(miss, []string{"身高", "学历"}) {
		t.Errorf("未命中标签应为 [身高 学历]，实际 %v", miss)
	}
}

func TestForwardScoreNoPreferenceMeansNeutral(t *testing.T) {
	// 没填任何伴侣偏好时给中位分（1.0），且没有任何理由——
	// 卡片那边会显示"多填几项偏好，推荐会更有依据"
	score, hits, miss := forwardScore(&Candidate{}, &Candidate{HeightCm: 170})
	if score != 1 || len(hits) != 0 || len(miss) != 0 {
		t.Errorf("无偏好时应为 (1, 空, 空)，实际 (%v, %v, %v)", score, hits, miss)
	}
}

func TestSharedHobbies(t *testing.T) {
	if got := sharedHobbies(nil, []string{"摄影"}); got != nil {
		t.Errorf("自己没有兴趣时应为 nil，实际 %v", got)
	}
	if got := sharedHobbies([]string{"摄影"}, nil); got != nil {
		t.Errorf("对方没有兴趣时应为 nil，实际 %v", got)
	}
	// 保序按"对方"的顺序：卡片上先看到的是她的兴趣里你也有哪些
	if got := sharedHobbies([]string{"美食", "摄影", "旅行"}, []string{"摄影", "游戏", "美食"}); !reflect.DeepEqual(got, []string{"摄影", "美食"}) {
		t.Errorf("共同兴趣应为 [摄影 美食]，实际 %v", got)
	}
	if got := sharedHobbies([]string{"摄影"}, []string{"跑步"}); len(got) != 0 {
		t.Errorf("没有交集时应为空，实际 %v", got)
	}
}
