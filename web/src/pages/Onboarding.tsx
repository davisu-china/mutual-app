import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/input";
import { Choice } from "@/components/ui/choice";
import { OptionSheet } from "@/components/ui/option-sheet";
import { RangeField } from "@/components/ui/range-slider";
import { ProvinceMultiField } from "@/components/picker/province-field";
import { IncomeRangeField } from "@/components/picker/income-range-field";
import { UniversityField } from "@/components/picker/university-field";
import { OccupationField } from "@/components/picker/occupation-field";
import { useToast } from "@/components/ui/toast";
import { HeightField } from "@/components/picker/height-field";
import { WeightField } from "@/components/picker/weight-field";
import { BirthdayField, type Birthday } from "@/components/picker/birthday-field";
import { RegionField, type RegionValue } from "@/components/picker/region-field";
import { MbtiField } from "@/components/profile/mbti-slider";
import { api, uploadToPresigned, ApiError } from "@/lib/api";
import { useAuth } from "@/store/auth";
import { cn } from "@/lib/utils";
import {
  GENDER, SMOKING, DRINKING, INCOME, EDUCATION,
  ELDERCARE, HOUSE, DINK, YES_NO, ACCEPT_3, CAR_PREFER, HOUSE_PREFER,
  DINK_ACCEPT, PARTNER_TAGS, HOBBIES, EDUCATION_MIN,
} from "@/data/options";

const STEPS = ["本人画像", "兴趣爱好", "关于我", "伴侣画像", "期待的他"] as const;

interface Draft {
  // step 1
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
  photoObjectKey: string | null;
  photoPreview: string | null;
  // step 2
  hobbies: { name: string; description: string }[];
  // step 3 / 5
  aboutMe: string;
  expectPartner: string;
  // step 4
  pref: {
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
  };
}

const EMPTY: Draft = {
  gender: null, birthday: null, heightCm: null, weightKg: null,
  hometown: null, residence: null, occupation: null, mbti: null,
  smoking: null, drinking: null, incomeRange: null,
  education: null, school: "", company: "",
  isOnlyChild: null, eldercarePressure: null, hasCar: null, hasHouse: null, isDink: null,
  photoObjectKey: null, photoPreview: null,
  hobbies: [{ name: "", description: "" }, { name: "", description: "" }, { name: "", description: "" }],
  aboutMe: "", expectPartner: "",
  pref: {
    heightMin: 155, heightMax: 185, hometownProvinces: [],
    smokingAccept: null, drinkingAccept: null, incomeMin: 0, incomeMax: 7,
    educationMin: null, onlyChildAccept: null, carPrefer: null, housePrefer: null,
    dinkAccept: null, tags: [],
  },
};

const DRAFT_KEY = "mutual.onboarding.draft";

/** 性别值 → 字段默认值用的键。未选性别时按男性兜底（它在表单里是第一个必填项）。 */
function genderOf(d: Draft): "male" | "female" {
  return d.gender === 2 ? "female" : "male";
}

/** 后端返回的是出生日期，但 Profile 不带这个字段——这里用年龄反推一个占位生日。
 *  实际上后端 /users/me 不下发生日（出于隐私），所以编辑时生日保持用户已选的草稿值。 */
function parseBirthday(_p: unknown): Birthday | null {
  return null;
}

export default function Onboarding() {
  const nav = useNavigate();
  const toast = useToast();
  const { markOnboarded } = useAuth();

  const [step, setStep] = useState(0);
  const [d, setD] = useState<Draft>(() => {
    // 进度本地留一份：中途退出、切后台、误刷新都能续填（PRD 3.3）
    try {
      const raw = localStorage.getItem(DRAFT_KEY);
      if (raw) return { ...EMPTY, ...JSON.parse(raw) };
    } catch {
      /* 损坏的草稿直接丢弃 */
    }
    return EMPTY;
  });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");
  const { onboarded } = useAuth();

  useEffect(() => {
    localStorage.setItem(DRAFT_KEY, JSON.stringify(d));
  }, [d]);

  // 已完成的用户点「编辑」进来时，从服务端回填已有资料，
  // 而不是让他对着空表单重填一遍。
  useEffect(() => {
    if (!onboarded) return;
    let cancelled = false;
    (async () => {
      try {
        const p = await api.get<import("@/lib/api").Profile>("/users/me");
        if (cancelled) return;
        const bd = parseBirthday(p);
        setD((prev) => ({
          ...prev,
          gender: p.gender ?? prev.gender,
          birthday: bd ?? prev.birthday,
          heightCm: p.heightCm || null,
          weightKg: p.weightKg ?? null,
          hometown: p.hometownCity
            ? { province: p.hometownProvince, city: p.hometownCity }
            : prev.hometown,
          residence: p.city
            ? { province: p.cityProvince, city: p.city, district: p.cityDistrict }
            : prev.residence,
          occupation: p.occupation || null,
          mbti: p.mbti ?? null,
          smoking: p.smoking || null,
          drinking: p.drinking || null,
          incomeRange: p.incomeRange ?? null,
          education: p.education || null,
          school: p.school ?? "",
          company: p.company ?? "",
          isOnlyChild: p.isOnlyChild,
          eldercarePressure: p.eldercarePressure ?? null,
          hasCar: p.hasCar,
          hasHouse: p.hasHouse || null,
          isDink: p.isDink || null,
          // 已经有照片就不用再传一次；这里塞一个占位让校验通过
          // （avatarUrl 现在就是相册第一张，见后端 profile.build）
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
        }));
      } catch {
        /* 回填失败就用空表单，不阻断 */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [onboarded]);

  const set = useCallback(<K extends keyof Draft>(k: K, v: Draft[K]) => {
    setD((prev) => ({ ...prev, [k]: v }));
    setErr("");
  }, []);

  const setPref = useCallback(<K extends keyof Draft["pref"]>(k: K, v: Draft["pref"][K]) => {
    setD((prev) => ({ ...prev, pref: { ...prev.pref, [k]: v } }));
    setErr("");
  }, []);

  // ---------- 每步的完成判定 ----------
  const stepDone = useMemo(() => {
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
        // 恰好 3 个，且每个都写了 10 字以上
        return d.hobbies.every((h) => h.name && [...h.description].length >= 10);
      case 2:
        return [...d.aboutMe].length >= 20;
      case 3:
        return (
          d.pref.smokingAccept !== null && d.pref.drinkingAccept !== null &&
          d.pref.educationMin !== null && d.pref.onlyChildAccept !== null &&
          d.pref.carPrefer !== null && d.pref.housePrefer !== null &&
          d.pref.dinkAccept !== null
        );
      case 4:
        return [...d.expectPartner].length >= 20;
      default:
        return false;
    }
  }, [step, d]);

  async function saveStep(): Promise<boolean> {
    setSaving(true);
    setErr("");
    try {
      switch (step) {
        case 0: {
          await api.patch("/users/me/profile", {
            nickname: undefined,
            gender: d.gender,
            birthday: `${d.birthday!.year}-${String(d.birthday!.month).padStart(2, "0")}-${String(d.birthday!.day).padStart(2, "0")}`,
            heightCm: d.heightCm,
            // 体重/年收入/公司都改成必填且固定对外可见：表单里不再给「对外公开」
            // 开关，用户没有可选项，所以这里写死 true，免得留一个永远为 false
            // 的字段让资料对别人显示成「隐藏」。
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
          });
          if (d.photoObjectKey && d.photoObjectKey !== "__existing__") {
            await api.post("/users/me/photos/confirm", { objectKey: d.photoObjectKey });
          }
          break;
        }
        case 1: {
          await api.put("/users/me/hobbies", {
            hobbies: d.hobbies.map((h, i) => ({ ...h, sortOrder: i + 1 })),
          });
          break;
        }
        case 2: {
          await api.patch("/users/me/texts", { aboutMe: d.aboutMe });
          break;
        }
        case 3: {
          await api.patch("/users/me/preference", d.pref);
          break;
        }
        case 4: {
          await api.patch("/users/me/texts", { expectPartner: d.expectPartner });
          break;
        }
      }
      return true;
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "保存失败，请重试");
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function next() {
    if (!(await saveStep())) return;
    if (step < STEPS.length - 1) {
      setStep(step + 1);
      window.scrollTo({ top: 0 });
      return;
    }
    // 最后一步：收口，通过后才能真正开始用
    setSaving(true);
    try {
      await api.post("/users/me/onboarding/complete");
      localStorage.removeItem(DRAFT_KEY);
      markOnboarded();
      toast("资料已完成，开始认识人吧");
      nav("/", { replace: true });
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "提交失败，请重试");
    } finally {
      setSaving(false);
    }
  }

  const pct = ((step + (stepDone ? 1 : 0)) / STEPS.length) * 100;

  return (
    <div className="min-h-screen bg-paper">
      <header className="sticky top-0 z-10 border-b border-line-soft bg-paper/95 backdrop-blur">
        <div className="mx-auto max-w-[460px] px-5 py-3">
          <div className="mb-2 flex items-center justify-between">
            <button
              type="button"
              onClick={() => step > 0 && setStep(step - 1)}
              className={cn(
                "text-[14px] transition-opacity",
                step === 0 ? "pointer-events-none opacity-0" : "text-muted-2 hover:text-ink"
              )}
            >
              ← 上一步
            </button>
            <span className="text-[13px] font-medium text-brand">
              {step + 1} / {STEPS.length} · {STEPS[step]}
            </span>
            <span className="w-14" />
          </div>
          <div className="h-1 overflow-hidden rounded-full bg-line-soft">
            <div
              className="h-full rounded-full bg-brand transition-[width] duration-300 ease-out"
              style={{ width: `${pct}%` }}
            />
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[460px] px-5 pb-36 pt-6">
        {step === 0 && <Step1 d={d} set={set} />}
        {step === 1 && <Step2 d={d} setD={setD} toast={toast} />}
        {step === 2 && <Step3 d={d} set={set} />}
        {step === 3 && <Step4 d={d} setPref={setPref} />}
        {step === 4 && <Step5 d={d} set={set} />}
      </main>

      <footer className="fixed inset-x-0 bottom-0 border-t border-line-soft bg-paper/95 px-5 backdrop-blur">
        <div className="mx-auto max-w-[460px] py-4 pb-safe">
          {err && (
            <p className="mb-3 rounded-field bg-brand-soft px-3 py-2.5 text-[13px] text-brand-dark">
              {err}
            </p>
          )}
          {!stepDone && !err && (
            <p className="mb-3 text-center text-[13px] text-muted-2">
              {hintFor(step, d)}
            </p>
          )}
          <Button size="lg" className="w-full" loading={saving} disabled={!stepDone} onClick={next}>
            {step === STEPS.length - 1 ? "完成，开始认识人" : "下一步"}
          </Button>
        </div>
      </footer>
    </div>
  );
}

/** 体重的合理区间。必填字段没有上界时，总会有人填 0 或者 999。 */
const WEIGHT_MIN = 30;
const WEIGHT_MAX = 200;

function weightOk(d: Draft): boolean {
  return d.weightKg !== null && d.weightKg >= WEIGHT_MIN && d.weightKg <= WEIGHT_MAX;
}

/** 未完成时告诉用户「还差什么」，而不是只把按钮置灰 */
function hintFor(step: number, d: Draft): string {
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
      const bad = d.hobbies.findIndex((h) => !h.name || [...h.description].length < 10);
      if (d.hobbies.some((h) => !h.name)) return "请选择 3 个兴趣爱好";
      if (bad >= 0) return `第 ${bad + 1} 个兴趣的介绍还差一点（至少 10 字）`;
      return "";
    }
    case 2:
      return `「关于我」还差 ${Math.max(0, 20 - [...d.aboutMe].length)} 字`;
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
      return `「期待的那个他/她」还差 ${Math.max(0, 20 - [...d.expectPartner].length)} 字`;
    default:
      return "";
  }
}

// ============================ Step 1 ============================

function Step1({ d, set }: { d: Draft; set: <K extends keyof Draft>(k: K, v: Draft[K]) => void }) {
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  // 头像＝相册第一张，所以这里传的就是相册里的第一张照片
  async function pickPhoto(file: File) {
    setUploading(true);
    try {
      const pre = await api.post<{ uploadUrl: string; objectKey: string; publicUrl: string }>(
        "/users/me/photos/presign",
        { contentType: file.type || "image/jpeg" }
      );
      await uploadToPresigned(pre.uploadUrl, file);
      set("photoObjectKey", pre.objectKey);
      set("photoPreview", URL.createObjectURL(file));
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "照片上传失败", "error");
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="space-y-4">
      <h1 className="mb-1 text-[22px] font-bold text-ink">先认识一下你</h1>
      <p className="mb-4 text-[14px] leading-relaxed text-muted">
        这些会决定给你推荐谁，也会出现在别人看到的卡片上。
      </p>

      {/* 第一张照片：它就是你的头像 / 封面（见 PRD 头像口径） */}
      <div className="flex justify-center pb-1">
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          className="relative h-24 w-24 overflow-hidden rounded-full border-2 border-dashed border-line bg-surface transition-colors hover:border-brand/50"
        >
          {d.photoPreview ? (
            <img src={d.photoPreview} alt="" className="h-full w-full object-cover" />
          ) : (
            <span className="flex h-full flex-col items-center justify-center gap-1 text-[12px] text-muted-2">
              {uploading ? "上传中…" : "上传照片"}
            </span>
          )}
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void pickPhoto(f);
            e.target.value = "";
          }}
        />
      </div>
      {!d.photoObjectKey && (
        <p className="text-center text-[12px] text-muted-2">
          至少一张照片（它就是你的头像，之后可以在「我的」里加更多并调整顺序）
        </p>
      )}

      <Choice label="性别" options={GENDER} value={d.gender} onChange={(v) => set("gender", v)} />
      {d.gender !== null && (
        <p className="text-[12px] text-muted-2">性别填写后不可修改，请确认无误</p>
      )}

      <BirthdayField value={d.birthday} onChange={(v) => set("birthday", v)} gender={genderOf(d)} />
      <HeightField value={d.heightCm} onChange={(v) => set("heightCm", v)} gender={genderOf(d)} />

      <WeightField
        value={d.weightKg}
        onChange={(v) => set("weightKg", v)}
        gender={genderOf(d)}
      />

      <RegionField label="家乡" value={d.hometown} onChange={(v) => set("hometown", v)} placeholder="请选择家乡" />
      <RegionField label="现居地" value={d.residence} onChange={(v) => set("residence", v)} withDistrict />

      <OccupationField label="职业" value={d.occupation ?? ""} onChange={(v) => set("occupation", v)} />

      <MbtiField value={d.mbti} onChange={(v) => set("mbti", v)} />
      <Choice label="抽烟" options={SMOKING} value={d.smoking} onChange={(v) => set("smoking", v)} />
      <Choice label="喝酒" options={DRINKING} value={d.drinking} onChange={(v) => set("drinking", v)} />

      <OptionSheet
        label="年收入"
        options={INCOME}
        value={d.incomeRange}
        onChange={(v) => set("incomeRange", v)}
        columns={2}
      />

      <Choice label="学历" options={EDUCATION} value={d.education} onChange={(v) => set("education", v)} />
      <UniversityField label="学校" value={d.school} onChange={(v) => set("school", v)} />

      <Input label="公司" value={d.company} onChange={(e) => set("company", e.target.value)} placeholder="请输入公司" maxLength={30} />

      <Choice label="是否独生" options={YES_NO} value={d.isOnlyChild} onChange={(v) => set("isOnlyChild", v)} />
      <Choice label="有无养老压力" options={ELDERCARE} value={d.eldercarePressure} onChange={(v) => set("eldercarePressure", v)} />
      <Choice label="是否有车" options={YES_NO} value={d.hasCar} onChange={(v) => set("hasCar", v)} />
      <Choice label="是否有房" options={HOUSE} value={d.hasHouse} onChange={(v) => set("hasHouse", v)} />
      <Choice label="是否丁克" options={DINK} value={d.isDink} onChange={(v) => set("isDink", v)} />
    </div>
  );
}

// ============================ Step 2 ============================

function Step2({
  d, setD, toast,
}: {
  d: Draft;
  setD: React.Dispatch<React.SetStateAction<Draft>>;
  toast: (t: string, k?: "info" | "error") => void;
}) {
  const [picking, setPicking] = useState<number | null>(null);

  function setName(i: number, name: string) {
    setD((p) => {
      if (p.hobbies.some((h, j) => j !== i && h.name === name)) {
        toast("这个兴趣已经选过了");
        return p;
      }
      const hs = [...p.hobbies];
      hs[i] = { ...hs[i], name };
      return { ...p, hobbies: hs };
    });
  }
  function setDesc(i: number, description: string) {
    setD((p) => {
      const hs = [...p.hobbies];
      hs[i] = { ...hs[i], description };
      return { ...p, hobbies: hs };
    });
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="mb-1 text-[22px] font-bold text-ink">你的三个兴趣爱好</h1>
        <p className="text-[14px] leading-relaxed text-muted">
          每个都写几句具体的情况——这比标签本身更能让人认识你。
        </p>
      </div>

      {d.hobbies.map((h, i) => (
        <div key={i} className="rounded-card bg-surface p-4 shadow-card">
          <div className="mb-3 flex items-center gap-2">
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-brand-soft text-[12px] font-bold text-brand-dark">
              {i + 1}
            </span>
            <button
              type="button"
              onClick={() => setPicking(i)}
              className={cn(
                "flex-1 rounded-field border px-3 py-2 text-left text-[15px] transition-colors",
                h.name ? "border-line text-ink" : "border-dashed border-line text-muted-2"
              )}
            >
              {h.name || "选择兴趣"}
            </button>
          </div>
          <Textarea
            value={h.description}
            onChange={(e) => setDesc(i, e.target.value)}
            placeholder="比如：去年一个人去了川西，跑了 1200 公里，最喜欢在海拔 4000 米的垭口发呆"
            rows={3}
            max={200}
          />
          <p className="mt-1 text-right text-[12px] text-muted-2">
            {[...h.description].length}/200（至少 10 字）
          </p>
        </div>
      ))}

      {picking !== null && (
        <div className="fixed inset-0 z-50 flex items-end" role="dialog">
          <div className="absolute inset-0 bg-ink/40 animate-fade-in" onClick={() => setPicking(null)} />
          <div className="relative w-full max-w-[460px] mx-auto rounded-t-[22px] bg-surface animate-sheet-up">
            <div className="flex items-center justify-between px-5 py-4">
              <span className="text-[15px] font-semibold">选择兴趣</span>
              <button type="button" onClick={() => setPicking(null)} className="text-[15px] text-brand">
                完成
              </button>
            </div>
            <div className="max-h-[52vh] overflow-y-auto px-5 pb-8">
              <div className="flex flex-wrap gap-2">
                {HOBBIES.map((name) => {
                  const active = d.hobbies[picking].name === name;
                  const usedElsewhere = d.hobbies.some((h, j) => j !== picking && h.name === name);
                  return (
                    <button
                      key={name}
                      type="button"
                      onClick={() => {
                        setName(picking, name);
                        setPicking(null);
                      }}
                      className={cn(
                        "rounded-full border px-3.5 py-2 text-[14px] transition-all",
                        active
                          ? "border-brand bg-brand-soft font-medium text-brand-dark"
                          : usedElsewhere
                            ? "border-line-soft text-muted-2 opacity-40"
                            : "border-line text-ink hover:border-brand/40"
                      )}
                    >
                      {name}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ============================ Step 3 ============================

function Step3({ d, set }: { d: Draft; set: <K extends keyof Draft>(k: K, v: Draft[K]) => void }) {
  return (
    <div className="space-y-5">
      <div>
        <h1 className="mb-1 text-[22px] font-bold text-ink">关于我</h1>
        <p className="text-[14px] leading-relaxed text-muted">
          用一段话补充前面的字段说不清的部分——性格、生活方式、你在意什么。
        </p>
      </div>
      <Textarea
        value={d.aboutMe}
        onChange={(e) => set("aboutMe", e.target.value)}
        placeholder="比如：写代码也写字，周末不是在山里就是在咖啡馆。做事比较认真，不太会寒暄，但熟起来话很多。"
        rows={9}
        max={500}
      />
      <div className="rounded-card bg-brand-soft/60 p-4 text-[13px] leading-relaxed text-brand-dark">
        <p className="mb-1 font-medium">一个小建议</p>
        <p className="text-brand-dark/80">
          避免「喜欢旅游、看电影、美食」这种谁都能写的句子。
          写具体的事，比如「上个月在厦门住了五天，每天只去一个地方」。
        </p>
      </div>
    </div>
  );
}

// ============================ Step 4 ============================

function Step4({
  d, setPref,
}: {
  d: Draft;
  setPref: <K extends keyof Draft["pref"]>(k: K, v: Draft["pref"][K]) => void;
}) {
  const p = d.pref;
  // 省份名单来自国家统计局口径（构建期生成），不再手写维护

  return (
    <div className="space-y-6">
      <div>
        <h1 className="mb-1 text-[22px] font-bold text-ink">你期待的伴侣</h1>
        <p className="text-[14px] leading-relaxed text-muted">
          这些条件用来排序推荐，不是硬性筛选——不满足的人也可能出现在后面。
        </p>
      </div>

      <RangeField
        label="期望身高"
        min={140}
        max={210}
        valueMin={p.heightMin}
        valueMax={p.heightMax}
        gap={5}
        format={(v) => `${v} cm`}
        endLabels={["140", "210"]}
        onChange={(lo, hi) => {
          setPref("heightMin", lo);
          setPref("heightMax", hi);
        }}
      />

      <ProvinceMultiField
        label="期待家乡"
        hint="可多选，不选即不限。"
        value={p.hometownProvinces}
        onChange={(v) => setPref("hometownProvinces", v)}
      />

      <Choice label="抽烟" options={ACCEPT_3} value={p.smokingAccept} onChange={(v) => setPref("smokingAccept", v)} />
      <Choice label="喝酒" options={ACCEPT_3} value={p.drinkingAccept} onChange={(v) => setPref("drinkingAccept", v)} />

      <IncomeRangeField
        label="期望年收入"
        min={p.incomeMin}
        max={p.incomeMax}
        onChange={(lo, hi) => {
          setPref("incomeMin", lo);
          setPref("incomeMax", hi);
        }}
      />

      <Choice label="最低学历" options={EDUCATION_MIN} value={p.educationMin} onChange={(v) => setPref("educationMin", v)} />
      <Choice label="独生情况" options={ACCEPT_3} value={p.onlyChildAccept} onChange={(v) => setPref("onlyChildAccept", v)} />
      <Choice label="是否有车" options={CAR_PREFER} value={p.carPrefer} onChange={(v) => setPref("carPrefer", v)} />
      <Choice label="有房" options={HOUSE_PREFER} value={p.housePrefer} onChange={(v) => setPref("housePrefer", v)} />
      <Choice label="是否丁克" options={DINK_ACCEPT} value={p.dinkAccept} onChange={(v) => setPref("dinkAccept", v)} />
      <p className="-mt-3 text-[12px] text-muted-2">丁克分歧对关系影响较大，这里只留「接受 / 不接受」</p>

      <div>
        <p className="mb-2 text-[15px] text-muted">你的期待（可多选）</p>
        <div className="flex flex-wrap gap-2">
          {PARTNER_TAGS.map((t) => {
            const on = p.tags.includes(t);
            return (
              <button
                key={t}
                type="button"
                onClick={() =>
                  setPref("tags", on ? p.tags.filter((x) => x !== t) : [...p.tags, t])
                }
                className={cn(
                  "rounded-full border px-4 py-2 text-[14px] transition-all",
                  on ? "border-brand bg-brand-soft font-medium text-brand-dark" : "border-line text-ink"
                )}
              >
                {t}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}


// ============================ Step 5 ============================

function Step5({ d, set }: { d: Draft; set: <K extends keyof Draft>(k: K, v: Draft[K]) => void }) {
  return (
    <div className="space-y-5">
      <div>
        <h1 className="mb-1 text-[22px] font-bold text-ink">期待的那个他 / 她</h1>
        <p className="text-[14px] leading-relaxed text-muted">
          最后一件事：用文字描述一下你希望遇到什么样的人。这是你资料里最容易被认真读完的一段。
        </p>
      </div>
      <Textarea
        value={d.expectPartner}
        onChange={(e) => set("expectPartner", e.target.value)}
        placeholder="比如：希望遇到一个能把话说清楚的人。不用很热闹，但要能聊到一块儿去——比如一起吐槽一部烂片，或者安静地各看各的书。"
        rows={9}
        max={500}
      />
    </div>
  );
}
