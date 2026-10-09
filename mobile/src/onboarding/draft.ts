/**
 * 资料向导的**纯逻辑**：草稿形状、每步的完成判定、差什么、以及各步的请求体。
 *
 * 为什么单独一个模块、不写在页面里：这一屏全是原生选择器（滚轮、底部弹层、
 * 系统相册），jest 里渲染不出真实交互，页面级的测试只能验"没崩"。把判定和
 * 请求体抽成纯函数之后，"五步各自要什么、什么时候能点下一步、提交什么给后端"
 * 才是可验证的——而这恰好是最容易悄悄错的部分（少一个必填项、生日没补零）。
 *
 * 口径与 Web 版 `web/src/pages/Onboarding.tsx` 一一对应。
 */

export const STEPS = ["本人画像", "兴趣爱好", "关于我", "伴侣画像", "期待的他"] as const;

/** 服务端的字数下限（service.aboutMeMin），三处文案共用同一个数 */
export const TEXT_MIN = 20;
export const TEXT_MAX = 500;
/** 每个兴趣的介绍至少这么长——太短就成了标签，没有信息量 */
export const HOBBY_DESC_MIN = 10;
export const HOBBY_DESC_MAX = 200;
/** 体重的合理区间。必填字段没有上界时，总会有人填 0 或者 999 */
export const WEIGHT_MIN = 30;
export const WEIGHT_MAX = 200;

export interface Birthday {
  year: number;
  month: number;
  day: number;
}

/** 家乡只有省市；现居地多一级区县 */
export interface RegionValue {
  province: string;
  city: string;
  district?: string;
}

export interface Pref {
  heightMin: number;
  heightMax: number;
  hometownProvinces: string[];
  smokingAccept: number | null;
  drinkingAccept: number | null;
  incomeMin: number;
  incomeMax: number;
  educationMin: number | null;
  onlyChildAccept: number | null;
  carPrefer: number | null;
  housePrefer: number | null;
  dinkAccept: number | null;
  tags: string[];
}

export interface Hobby {
  name: string;
  description: string;
}

export interface Draft {
  // 第一步：本人画像
  gender: number | null;
  birthday: Birthday | null;
  heightCm: number | null;
  weightKg: number | null;
  hometown: RegionValue | null;
  residence: RegionValue | null;
  occupation: string | null;
  mbti: string | null;
  smoking: number | null;
  drinking: number | null;
  incomeRange: number | null;
  education: number | null;
  school: string;
  company: string;
  isOnlyChild: boolean | null;
  eldercarePressure: number | null;
  hasCar: boolean | null;
  hasHouse: number | null;
  isDink: number | null;
  /**
   * 照片的 objectKey。
   *
   * 两个特殊取值：`null` = 还没传；`"__existing__"` = 服务端已经有了（回填时）。
   * 移动端**不需要**在这里再调一次 confirm——`uploadPhoto()` 里已经走完了
   * presign → 直传 → confirm；Web 版是在这一步才 confirm 的，照抄会传成两张。
   */
  photoObjectKey: string | null;
  /** 本地选中的图片 URI（预览用），回填时是服务端地址 */
  photoPreview: string | null;
  // 第二步
  hobbies: Hobby[];
  // 第三步 / 第五步
  aboutMe: string;
  expectPartner: string;
  // 第四步
  pref: Pref;
}

export const EMPTY: Draft = {
  gender: null, birthday: null, heightCm: null, weightKg: null,
  hometown: null, residence: null, occupation: null, mbti: null,
  smoking: null, drinking: null, incomeRange: null,
  education: null, school: "", company: "",
  isOnlyChild: null, eldercarePressure: null, hasCar: null, hasHouse: null, isDink: null,
  photoObjectKey: null, photoPreview: null,
  hobbies: [
    { name: "", description: "" },
    { name: "", description: "" },
    { name: "", description: "" },
  ],
  aboutMe: "", expectPartner: "",
  pref: {
    heightMin: 155, heightMax: 185, hometownProvinces: [],
    smokingAccept: null, drinkingAccept: null, incomeMin: 0, incomeMax: 7,
    educationMin: null, onlyChildAccept: null, carPrefer: null, housePrefer: null,
    dinkAccept: null, tags: [],
  },
};

/** 字数是按**码点**数的，不是按 UTF-16 长度——emoji 和生僻字不能算两个字 */
const len = (s: string) => [...s].length;

/** 平台只面向成年人；年龄上限只是防止滚轮无限长 */
export const MIN_AGE = 18;
export const MAX_AGE = 70;

export const pad2 = (n: number) => String(n).padStart(2, "0");

export function birthdayText(b: Birthday): string {
  return `${b.year}-${pad2(b.month)}-${pad2(b.day)}`;
}

/**
 * 精确年龄：没到生日那天要减一岁。
 * 用年份相减会让「今年 12 月才满 18」的人在 10 月就被放进去。
 */
export function calcAge(b: Birthday, today: Date = new Date()): number {
  let age = today.getFullYear() - b.year;
  const m = today.getMonth() + 1;
  if (m < b.month || (m === b.month && today.getDate() < b.day)) age--;
  return age;
}

/** 滚轮里的年份是**降序**的（从刚够 18 岁那年起往回），和大多数人翻生日的方向一致 */
export function yearOptions(today: Date = new Date()): number[] {
  const top = today.getFullYear() - MIN_AGE;
  const bottom = today.getFullYear() - MAX_AGE;
  const out: number[] = [];
  for (let y = top; y >= bottom; y--) out.push(y);
  return out;
}

export function daysInMonth(year: number, month: number): number {
  // 第 0 天 = 上个月的最后一天，自动处理闰年
  return new Date(year, month, 0).getDate();
}

export function weightOk(d: Draft): boolean {
  return d.weightKg !== null && d.weightKg >= WEIGHT_MIN && d.weightKg <= WEIGHT_MAX;
}

/** 这一屏填完了吗（决定「下一步」能不能点） */
export function stepDone(step: number, d: Draft): boolean {
  switch (step) {
    case 0:
      return (
        d.gender !== null && d.birthday !== null && d.heightCm !== null &&
        weightOk(d) && d.hometown !== null && d.residence !== null && d.occupation !== null &&
        d.mbti !== null && d.smoking !== null && d.drinking !== null &&
        d.incomeRange !== null && d.education !== null &&
        d.school.trim() !== "" && d.company.trim() !== "" &&
        d.isOnlyChild !== null && d.eldercarePressure !== null && d.hasCar !== null &&
        d.hasHouse !== null && d.isDink !== null && d.photoObjectKey !== null
      );
    case 1:
      return d.hobbies.every(
        (h) => h.name !== "" && len(h.description) >= HOBBY_DESC_MIN && len(h.description) <= HOBBY_DESC_MAX
      );
    case 2:
      return len(d.aboutMe) >= TEXT_MIN && len(d.aboutMe) <= TEXT_MAX;
    case 3:
      return (
        d.pref.smokingAccept !== null && d.pref.drinkingAccept !== null &&
        d.pref.educationMin !== null && d.pref.onlyChildAccept !== null &&
        d.pref.carPrefer !== null && d.pref.housePrefer !== null &&
        d.pref.dinkAccept !== null
      );
    case 4:
      return len(d.expectPartner) >= TEXT_MIN && len(d.expectPartner) <= TEXT_MAX;
    default:
      return false;
  }
}

/** 差什么就说什么，而不是只把按钮置灰——用户不该猜为什么点不动 */
export function hintFor(step: number, d: Draft): string {
  switch (step) {
    case 0: {
      const miss: string[] = [];
      if (d.gender === null) miss.push("性别");
      if (!d.birthday) miss.push("出生年月日");
      if (!d.heightCm) miss.push("身高");
      if (d.weightKg === null) miss.push("体重");
      else if (!weightOk(d)) miss.push(`体重（${WEIGHT_MIN}–${WEIGHT_MAX}kg）`);
      if (!d.hometown) miss.push("家乡");
      if (!d.residence) miss.push("现居地");
      if (!d.occupation) miss.push("职业");
      if (!d.mbti) miss.push("MBTI");
      if (d.smoking === null) miss.push("抽烟");
      if (d.drinking === null) miss.push("喝酒");
      if (!d.incomeRange) miss.push("年收入");
      if (!d.education) miss.push("学历");
      if (!d.school.trim()) miss.push("学校");
      if (!d.company.trim()) miss.push("公司");
      if (d.isOnlyChild === null) miss.push("是否独生");
      if (d.eldercarePressure === null) miss.push("养老压力");
      if (d.hasCar === null) miss.push("是否有车");
      if (!d.hasHouse) miss.push("是否有房");
      if (!d.isDink) miss.push("是否丁克");
      if (!d.photoObjectKey) miss.push("照片");
      return miss.length ? `还差：${miss.join("、")}` : "";
    }
    case 1: {
      const over = d.hobbies.findIndex((h) => len(h.description) > HOBBY_DESC_MAX);
      const bad = d.hobbies.findIndex((h) => h.name === "" || len(h.description) < HOBBY_DESC_MIN);
      if (d.hobbies.some((h) => h.name === "")) return "请选择 3 个兴趣爱好";
      // 超长和不足要分开说。只说"还差 N 字"在超长时会显示"还差 0 字"，
      // 而按钮是灰的——用户会一直点、不知道为什么点不动。
      if (over >= 0) return `第 ${over + 1} 个兴趣的介绍最多 ${HOBBY_DESC_MAX} 字，请精简`;
      if (bad >= 0) return `第 ${bad + 1} 个兴趣的介绍还差一点（至少 ${HOBBY_DESC_MIN} 字）`;
      return "";
    }
    case 2:
      if (len(d.aboutMe) > TEXT_MAX) return `「关于我」最多 ${TEXT_MAX} 字，现在超出 ${len(d.aboutMe) - TEXT_MAX} 字`;
      return `「关于我」还差 ${Math.max(0, TEXT_MIN - len(d.aboutMe))} 字`;
    case 3: {
      const miss: string[] = [];
      const p = d.pref;
      if (p.smokingAccept === null) miss.push("抽烟态度");
      if (p.drinkingAccept === null) miss.push("喝酒态度");
      if (p.educationMin === null) miss.push("最低学历");
      if (p.onlyChildAccept === null) miss.push("独生情况");
      if (p.carPrefer === null) miss.push("是否有车");
      if (p.housePrefer === null) miss.push("有房要求");
      if (p.dinkAccept === null) miss.push("丁克态度");
      return miss.length ? `还差：${miss.join("、")}` : "";
    }
    case 4:
      if (len(d.expectPartner) > TEXT_MAX)
        return `「期待的那个他/她」最多 ${TEXT_MAX} 字，现在超出 ${len(d.expectPartner) - TEXT_MAX} 字`;
      return `「期待的那个他/她」还差 ${Math.max(0, TEXT_MIN - len(d.expectPartner))} 字`;
    default:
      return "";
  }
}

/**
 * 第一步的请求体。
 *
 * 三处刻意的写法：
 *   - **不传 nickname**：这一屏不收昵称，传 `undefined` 只是为了不改动它；
 *     直接不放进对象里更清楚（JSON 序列化本来也会丢掉 undefined）。
 *   - **体重/年收入/公司写死 public=true**：表单里已经没有「对外公开」开关了，
 *     用户没有可选项；留一个永远为 false 的字段会让资料对别人显示成「隐藏」。
 *   - **出生日期补零**：`2026-1-5` 后端解析不了，必须是 `2026-01-05`。
 */
export function profilePayload(d: Draft): Record<string, unknown> {
  const b = d.birthday!;
  return {
    gender: d.gender,
    birthday: `${b.year}-${pad2(b.month)}-${pad2(b.day)}`,
    heightCm: d.heightCm,
    weightKg: d.weightKg ?? undefined,
    weightPublic: true,
    hometownProvince: d.hometown!.province,
    hometownCity: d.hometown!.city,
    cityProvince: d.residence!.province,
    city: d.residence!.city,
    cityDistrict: d.residence!.district,
    occupation: d.occupation,
    mbti: d.mbti,
    smoking: d.smoking,
    drinking: d.drinking,
    incomeRange: d.incomeRange,
    incomePublic: true,
    education: d.education,
    school: d.school.trim() || undefined,
    company: d.company.trim() || undefined,
    companyPublic: true,
    isOnlyChild: d.isOnlyChild,
    eldercarePressure: d.eldercarePressure,
    hasCar: d.hasCar,
    hasHouse: d.hasHouse,
    isDink: d.isDink,
  };
}

/** 第二步：兴趣。sortOrder 从 1 开始，服务端按它排序 */
export function hobbiesPayload(d: Draft): { hobbies: (Hobby & { sortOrder: number })[] } {
  return {
    hobbies: d.hobbies.map((h, i) => ({
      name: h.name,
      description: h.description.trim(),
      sortOrder: i + 1,
    })),
  };
}

/* ------------------------------------------------------- 从服务端回填草稿 */

/**
 * `/users/me` 里我们用得到的部分。
 *
 * 注意**没有 birthday**：后端 `Profile.Birthday` 标了 `json:"-"`，出于隐私刻意
 * 不下发生日（只给 `age`）。所以中途退出再进来，生日必须重选一次——这一项无法
 * 回填，也不该拿 age 编一个（那会把假生日写进库里）。其余字段都能续上。
 */
export interface ProfileSnapshot {
  gender?: number | null;
  heightCm?: number;
  weightKg?: number | null;
  hometownProvince?: string;
  hometownCity?: string;
  cityProvince?: string;
  city?: string;
  cityDistrict?: string | null;
  occupation?: string;
  mbti?: string | null;
  smoking?: number;
  drinking?: number;
  incomeRange?: number | null;
  education?: number;
  school?: string | null;
  company?: string | null;
  isOnlyChild?: boolean;
  eldercarePressure?: number | null;
  hasCar?: boolean;
  hasHouse?: number;
  isDink?: number;
  avatarUrl?: string;
  hobbies?: { name: string; description: string }[] | null;
  aboutMe?: string | null;
  expectPartner?: string | null;
  preference?: {
    heightMin: number;
    heightMax: number;
    hometownProvinces?: string[] | null;
    smokingAccept: number | null;
    drinkingAccept: number | null;
    incomeMin: number;
    incomeMax: number;
    educationMin: number | null;
    onlyChildAccept: number | null;
    carPrefer: number | null;
    housePrefer: number | null;
    dinkAccept: number | null;
    tags?: string[] | null;
  } | null;
}

/**
 * 用服务端已有的资料回填草稿。
 *
 * 这样"填到一半退出"是能续上的：每一步都会在点「下一步」时先存服务端，
 * 所以已经走过的步骤都在。比在本地存一份草稿更稳（换设备、重装都还在），
 * 也少一处可能对不上的状态。
 *
 * 两个刻意的处理：
 *   - **数值型字段用 `||`**：后端这类字段没填时返回 0，而 0 在这里都不是合法
 *     取值（身高 0 / 学历 0 / 抽烟 0），所以 0 一律当没填。
 *   - **`isOnlyChild` / `hasCar` 是裸 bool**，没有"没填"的表达：一个从没走到
 *     这一步的人也会返回 false。所以只有在**第一步确实存过**时才认它们，
 *     否则会把"否"凭空写进用户的资料里。判据用身高——它是第一步的必填项。
 */
export function backfill(prev: Draft, p: ProfileSnapshot): Draft {
  const step0Saved = (p.heightCm ?? 0) > 0;

  return {
    ...prev,
    gender: p.gender ?? prev.gender,
    // 生日不回填：后端不下发（见上面的说明），保持用户已选的草稿值
    heightCm: p.heightCm || prev.heightCm,
    weightKg: p.weightKg ?? prev.weightKg,
    hometown: p.hometownCity
      ? { province: p.hometownProvince ?? "", city: p.hometownCity }
      : prev.hometown,
    residence: p.city
      ? { province: p.cityProvince ?? "", city: p.city, district: p.cityDistrict ?? undefined }
      : prev.residence,
    occupation: p.occupation || prev.occupation,
    mbti: p.mbti || prev.mbti,
    smoking: p.smoking || prev.smoking,
    drinking: p.drinking || prev.drinking,
    incomeRange: p.incomeRange ?? prev.incomeRange,
    education: p.education || prev.education,
    school: p.school ?? prev.school,
    company: p.company ?? prev.company,
    isOnlyChild: step0Saved ? (p.isOnlyChild ?? prev.isOnlyChild) : prev.isOnlyChild,
    eldercarePressure: p.eldercarePressure ?? prev.eldercarePressure,
    hasCar: step0Saved ? (p.hasCar ?? prev.hasCar) : prev.hasCar,
    hasHouse: p.hasHouse || prev.hasHouse,
    isDink: p.isDink || prev.isDink,
    // 已经有照片就不用再传：塞个占位让校验通过（头像就是相册第一张）
    photoObjectKey: p.avatarUrl ? "__existing__" : prev.photoObjectKey,
    photoPreview: p.avatarUrl || prev.photoPreview,
    hobbies: p.hobbies?.length
      ? p.hobbies.map((h) => ({ name: h.name, description: h.description }))
      : prev.hobbies,
    aboutMe: p.aboutMe ?? prev.aboutMe,
    expectPartner: p.expectPartner ?? prev.expectPartner,
    pref: p.preference
      ? {
          heightMin: p.preference.heightMin,
          heightMax: p.preference.heightMax,
          hometownProvinces: p.preference.hometownProvinces ?? [],
          smokingAccept: p.preference.smokingAccept,
          drinkingAccept: p.preference.drinkingAccept,
          incomeMin: p.preference.incomeMin,
          incomeMax: p.preference.incomeMax,
          educationMin: p.preference.educationMin,
          onlyChildAccept: p.preference.onlyChildAccept,
          carPrefer: p.preference.carPrefer,
          housePrefer: p.preference.housePrefer,
          dinkAccept: p.preference.dinkAccept,
          tags: p.preference.tags ?? [],
        }
      : prev.pref,
  };
}

/** 每一步要提交的东西。返回 null 表示这一步不需要写服务端。 */
export function stepRequest(step: number, d: Draft): { method: "patch" | "put" | "post"; path: string; body?: unknown } | null {
  switch (step) {
    case 0:
      return { method: "patch", path: "/users/me/profile", body: profilePayload(d) };
    case 1:
      return { method: "put", path: "/users/me/hobbies", body: hobbiesPayload(d) };
    case 2:
      return { method: "patch", path: "/users/me/texts", body: { aboutMe: d.aboutMe.trim() } };
    case 3:
      return { method: "patch", path: "/users/me/preference", body: d.pref };
    case 4:
      return { method: "patch", path: "/users/me/texts", body: { expectPartner: d.expectPartner.trim() } };
    default:
      return null;
  }
}
