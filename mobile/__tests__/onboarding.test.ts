/**
 * 资料向导的纯逻辑。
 *
 * 这一屏全是原生选择器（滚轮、底部弹层、系统相册），jest 里渲染不出真实交互，
 * 页面测试只能验"没崩"。而最容易悄悄错的地方恰好不在渲染上：
 * 少一个必填项、生日没补零、把服务端的 0 当成真值回填、回填时凭空写了"否"。
 * 这些都在这里钉住。
 */
import {
  EMPTY,
  HOBBY_DESC_MIN,
  MAX_AGE,
  MIN_AGE,
  TEXT_MAX,
  TEXT_MIN,
  backfill,
  birthdayText,
  calcAge,
  daysInMonth,
  hintFor,
  hobbiesPayload,
  profilePayload,
  stepDone,
  stepRequest,
  yearOptions,
  type Draft,
} from "@/onboarding/draft";

/** 第一步全部填满的草稿——每个用例只改它关心的那一项 */
function fullDraft(): Draft {
  return {
    ...EMPTY,
    gender: 1,
    birthday: { year: 1996, month: 6, day: 15 },
    heightCm: 175,
    weightKg: 70,
    hometown: { province: "浙江省", city: "杭州市" },
    residence: { province: "上海市", city: "上海市", district: "徐汇区" },
    occupation: "互联网/IT · 产品经理",
    mbti: "INTJ",
    smoking: 1,
    drinking: 2,
    incomeRange: 4,
    education: 3,
    school: "复旦大学",
    company: "某互联网公司",
    isOnlyChild: true,
    eldercarePressure: 2,
    hasCar: true,
    hasHouse: 2,
    isDink: 2,
    photoObjectKey: "photos/1/a.jpg",
    photoPreview: "file:///a.jpg",
    hobbies: [
      { name: "摄影", description: "喜欢拍街上的光影和路过的人，周末会带相机出门。" },
      { name: "美食", description: "喜欢逛菜市场，看到新鲜的菜就想试试新菜谱。" },
      { name: "旅行", description: "每年会一个人出去玩一次，去年去的青海湖。" },
    ],
    aboutMe: "写代码也写字，周末不是在山里就是在咖啡馆，做事比较认真。",
    expectPartner: "希望你是个愿意好好说话的人，有好奇心，也愿意一起做点没什么用的事。",
    pref: {
      ...EMPTY.pref,
      smokingAccept: 3,
      drinkingAccept: 3,
      educationMin: 3,
      onlyChildAccept: 3,
      carPrefer: 2,
      housePrefer: 2,
      dinkAccept: 1,
    },
  };
}

/* -------------------------------------------------------------- 日期计算 */

describe("年龄与日期", () => {
  it("没到生日那天要减一岁", () => {
    // 今天 2026-10-10：12 月生日的人今年还没过生日
    const today = new Date(2026, 9, 10);
    expect(calcAge({ year: 2000, month: 12, day: 15 }, today)).toBe(25);
    expect(calcAge({ year: 2000, month: 10, day: 10 }, today)).toBe(26); // 当天算过了
    expect(calcAge({ year: 2000, month: 10, day: 11 }, today)).toBe(25); // 明天才过
    expect(calcAge({ year: 2000, month: 1, day: 1 }, today)).toBe(26);
  });

  it("2 月天数按闰年算", () => {
    expect(daysInMonth(2024, 2)).toBe(29);
    expect(daysInMonth(2025, 2)).toBe(28);
    expect(daysInMonth(2000, 2)).toBe(29); // 整百年但能被 400 整除
    expect(daysInMonth(1900, 2)).toBe(28);
    expect(daysInMonth(2026, 4)).toBe(30);
    expect(daysInMonth(2026, 1)).toBe(31);
  });

  it("年份滚轮是降序的，且刚好覆盖 18–70 岁", () => {
    const today = new Date(2026, 9, 10);
    const years = yearOptions(today);
    expect(years[0]).toBe(2026 - MIN_AGE);
    expect(years[years.length - 1]).toBe(2026 - MAX_AGE);
    expect(years.length).toBe(MAX_AGE - MIN_AGE + 1);
    // 降序
    expect(years[0]).toBeGreaterThan(years[1]);
  });

  it("生日补零：后端解析不了 2026-1-5", () => {
    expect(birthdayText({ year: 1996, month: 1, day: 5 })).toBe("1996-01-05");
    expect(profilePayload({ ...fullDraft(), birthday: { year: 1996, month: 1, day: 5 } }).birthday).toBe("1996-01-05");
  });
});

/* -------------------------------------------------------------- 每步判定 */

describe("stepDone / hintFor", () => {
  it("空草稿五步都完不成，且都说得出还差什么", () => {
    for (let s = 0; s < 5; s++) {
      expect(stepDone(s, EMPTY)).toBe(false);
      expect(hintFor(s, EMPTY)).not.toBe("");
    }
  });

  it("填满之后五步都能过", () => {
    const d = fullDraft();
    for (let s = 0; s < 5; s++) expect(stepDone(s, d)).toBe(true);
  });

  it("第一步少任何一项都过不了，并且点名是哪一项", () => {
    const d = fullDraft();
    // 逐个挖掉一项，每一次都该被拦下并指名道姓
    const cases: [keyof Draft, string][] = [
      ["gender", "性别"],
      ["birthday", "出生年月日"],
      ["heightCm", "身高"],
      ["hometown", "家乡"],
      ["residence", "现居地"],
      ["occupation", "职业"],
      ["mbti", "MBTI"],
      ["school", "学校"],
      ["company", "公司"],
      ["photoObjectKey", "照片"],
    ];
    for (const [key, label] of cases) {
      const broken = { ...d, [key]: key === "school" || key === "company" ? "  " : null } as Draft;
      expect(stepDone(0, broken)).toBe(false);
      expect(hintFor(0, broken)).toContain(label);
    }
  });

  it("体重超出 30–200kg 不算填好，并给出区间", () => {
    const d = fullDraft();
    expect(stepDone(0, { ...d, weightKg: 29 })).toBe(false);
    expect(stepDone(0, { ...d, weightKg: 201 })).toBe(false);
    expect(hintFor(0, { ...d, weightKg: 500 })).toContain("30–200");
    expect(stepDone(0, { ...d, weightKg: 30 })).toBe(true);
    expect(stepDone(0, { ...d, weightKg: 200 })).toBe(true);
  });

  it("第二步：三个兴趣都要选且各写够 10 字", () => {
    const d = fullDraft();
    expect(stepDone(1, { ...d, hobbies: d.hobbies.map((h, i) => (i === 1 ? { ...h, name: "" } : h)) })).toBe(false);
    expect(stepDone(1, { ...d, hobbies: d.hobbies.map((h, i) => (i === 2 ? { ...h, description: "太短" } : h)) })).toBe(false);
    // 正好卡在下限上应该算过
    const exact = { ...d, hobbies: d.hobbies.map((h) => ({ ...h, description: "一".repeat(HOBBY_DESC_MIN) })) };
    expect(stepDone(1, exact)).toBe(true);
    expect(hintFor(1, { ...d, hobbies: d.hobbies.map((h, i) => (i === 2 ? { ...h, description: "太短" } : h)) })).toContain("第 3 个");
  });

  it("关于我 / 期待的他：至少 20 字，且提示还差几个字", () => {
    expect(stepDone(2, { ...fullDraft(), aboutMe: "一".repeat(TEXT_MIN - 1) })).toBe(false);
    expect(stepDone(2, { ...fullDraft(), aboutMe: "一".repeat(TEXT_MIN) })).toBe(true);
    expect(hintFor(2, { ...fullDraft(), aboutMe: "一".repeat(5) })).toContain(`${TEXT_MIN - 5} 字`);
    expect(stepDone(4, { ...fullDraft(), expectPartner: "一".repeat(TEXT_MIN - 1) })).toBe(false);
    expect(stepDone(4, { ...fullDraft(), expectPartner: "一".repeat(TEXT_MIN) })).toBe(true);
  });

  it("超长时说清楚是超了，而不是「还差 0 字」", () => {
    // 曾经的写法：超长时 hintFor 算出 Math.max(0, 20-len)=0 →
    // 显示「还差 0 字」而按钮是灰的，用户会一直点、不知道为什么点不动。
    const long = "一".repeat(TEXT_MAX + 3);
    expect(stepDone(2, { ...fullDraft(), aboutMe: long })).toBe(false);
    expect(hintFor(2, { ...fullDraft(), aboutMe: long })).toContain("超出 3 字");
    expect(hintFor(2, { ...fullDraft(), aboutMe: long })).not.toContain("还差");
    expect(hintFor(4, { ...fullDraft(), expectPartner: long })).toContain("超出 3 字");
    // 正好卡在上限上应该算过
    expect(stepDone(2, { ...fullDraft(), aboutMe: "一".repeat(TEXT_MAX) })).toBe(true);
  });

  it("兴趣介绍超长也过不了（服务端上限 200）", () => {
    const d = fullDraft();
    const long = { ...d, hobbies: d.hobbies.map((h, i) => (i === 0 ? { ...h, description: "一".repeat(201) } : h)) };
    expect(stepDone(1, long)).toBe(false);
    expect(hintFor(1, long)).toContain("第 1 个");
    expect(hintFor(1, long)).toContain("最多 200 字");
  });

  it("第四步：七项态度都必须表态", () => {
    const d = fullDraft();
    for (const k of ["smokingAccept", "drinkingAccept", "educationMin", "onlyChildAccept", "carPrefer", "housePrefer", "dinkAccept"] as const) {
      const p = { ...d.pref, [k]: null };
      expect(stepDone(3, { ...d, pref: p })).toBe(false);
    }
  });
});

/* ------------------------------------------------------------ 请求体形状 */

describe("提交给后端的形状", () => {
  it("第一步：不传 nickname，三个公开开关写死 true", () => {
    const body = profilePayload(fullDraft());
    // 这一屏不收昵称，传了就等于把 App 里改不了的东西一起提交上去
    expect("nickname" in body).toBe(false);
    // 表单里已经没有「对外公开」开关了，留 false 会让资料对别人显示成「隐藏」
    expect(body.weightPublic).toBe(true);
    expect(body.incomePublic).toBe(true);
    expect(body.companyPublic).toBe(true);
    expect(body.cityDistrict).toBe("徐汇区");
    expect(body.hometownCity).toBe("杭州市");
  });

  it("完成度低时 school/company 传 undefined 而不是空串", () => {
    const body = profilePayload({ ...fullDraft(), school: "  ", company: "" });
    expect(body.school).toBeUndefined();
    expect(body.company).toBeUndefined();
  });

  it("第二步：sortOrder 从 1 开始，描述去空格", () => {
    const body = hobbiesPayload({ ...fullDraft(), hobbies: [{ name: "摄影", description: "  拍光影  " }, { name: "美食", description: " 菜市场 " }, { name: "旅行", description: "青海湖 " }] });
    expect(body.hobbies.map((h) => h.sortOrder)).toEqual([1, 2, 3]);
    expect(body.hobbies[0].description).toBe("拍光影");
  });

  it("每一步打的是对的接口：兴趣是 PUT 覆盖，不是 POST 追加", () => {
    expect(stepRequest(0, fullDraft())).toMatchObject({ method: "patch", path: "/users/me/profile" });
    expect(stepRequest(1, fullDraft())).toMatchObject({ method: "put", path: "/users/me/hobbies" });
    expect(stepRequest(2, fullDraft())).toMatchObject({ method: "patch", path: "/users/me/texts" });
    expect(stepRequest(3, fullDraft())).toMatchObject({ method: "patch", path: "/users/me/preference" });
    expect(stepRequest(4, fullDraft())).toMatchObject({ method: "patch", path: "/users/me/texts" });
    expect(stepRequest(9, fullDraft())).toBeNull();
  });
});

/* ---------------------------------------------------------------- 回填 */

describe("backfill", () => {
  const server = {
    gender: 1,
    heightCm: 175,
    weightKg: 70,
    hometownProvince: "浙江省",
    hometownCity: "杭州市",
    cityProvince: "上海市",
    city: "上海市",
    cityDistrict: "徐汇区",
    occupation: "互联网/IT · 产品经理",
    mbti: "INTJ",
    smoking: 1,
    drinking: 2,
    incomeRange: 4,
    education: 3,
    school: "复旦大学",
    company: "某互联网公司",
    isOnlyChild: true,
    eldercarePressure: 2,
    hasCar: true,
    hasHouse: 2,
    isDink: 2,
    avatarUrl: "/api/v1/media/photos/1/a.jpg",
    hobbies: [{ name: "摄影", description: "拍光影" }],
    aboutMe: "写代码也写字",
    expectPartner: "希望你好好说话",
    preference: {
      heightMin: 155, heightMax: 185, hometownProvinces: ["浙江省"],
      smokingAccept: 3, drinkingAccept: 3, incomeMin: 0, incomeMax: 7,
      educationMin: 3, onlyChildAccept: 3, carPrefer: 2, housePrefer: 2,
      dinkAccept: 1, tags: ["颜控"],
    },
  };

  it("服务端取值为 0 的字段当没填，不能把 0 写进草稿", () => {
    const d = backfill(EMPTY, { ...server, heightCm: 0, education: 0, smoking: 0, drinking: 0, hasHouse: 0, isDink: 0, incomeRange: 0 });
    expect(d.heightCm).toBeNull();
    expect(d.education).toBeNull();
    expect(d.smoking).toBeNull();
    expect(d.drinking).toBeNull();
    expect(d.hasHouse).toBeNull();
    expect(d.isDink).toBeNull();
  });

  it("第一步没存过时，不能把服务端的裸 bool 当成用户的选择", () => {
    // heightCm 为 0 ⇒ 第一步没走过；此时 isOnlyChild/hasCar 的 false 是"没填"而不是"否"
    const notStarted = backfill(EMPTY, { ...server, heightCm: 0, isOnlyChild: false, hasCar: false });
    expect(notStarted.isOnlyChild).toBeNull();
    expect(notStarted.hasCar).toBeNull();

    // 第一步存过了，就要如实回填（包括 false）
    const saved = backfill(EMPTY, { ...server, isOnlyChild: false, hasCar: false });
    expect(saved.isOnlyChild).toBe(false);
    expect(saved.hasCar).toBe(false);
  });

  it("生日不回填（后端不下发），保持用户已选的草稿值", () => {
    const mine = { year: 1996, month: 6, day: 15 };
    expect(backfill({ ...EMPTY, birthday: mine }, server).birthday).toEqual(mine);
  });

  it("已有头像就把照片标记为已存在，不用再传一次", () => {
    const d = backfill(EMPTY, server);
    expect(d.photoObjectKey).toBe("__existing__");
    expect(d.photoPreview).toBe("/api/v1/media/photos/1/a.jpg");
    // 没有头像时保持原样（null），第一步才算没填完
    expect(backfill(EMPTY, { ...server, avatarUrl: "" }).photoObjectKey).toBeNull();
  });

  it("回填出来的草稿能直接过第一步的校验", () => {
    // 除了生日（回填不了）之外，其余都该到位
    const d = { ...backfill(EMPTY, server), birthday: { year: 1996, month: 6, day: 15 } };
    expect(stepDone(0, d)).toBe(true);
    expect(stepDone(3, d)).toBe(true);
  });

  it("服务端没有的字段不要覆盖用户已经填的", () => {
    const typed = { ...EMPTY, school: "我自己填的", company: "我公司" };
    const d = backfill(typed, { ...server, school: null, company: null });
    expect(d.school).toBe("我自己填的");
    expect(d.company).toBe("我公司");
  });
});
