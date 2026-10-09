import { useState } from "react";
import { HeightField } from "@/components/picker/height-field";
import {
  BirthdayField,
  calcAge,
  type Birthday,
} from "@/components/picker/birthday-field";
import { RegionField, type RegionValue } from "@/components/picker/region-field";
import { shortName } from "@/data/regions";

/**
 * Onboarding 第 1 步的表单演示。
 *
 * 这一页不是最终形态，而是把三个高交互组件放在真实语境里看效果——
 * 它们最终会嵌进「本人画像」那一步，和职业、学历等普通字段排在一起。
 */
export default function App() {
  const [gender, setGender] = useState<"male" | "female">("female");
  const [height, setHeight] = useState<number | null>(null);
  const [birthday, setBirthday] = useState<Birthday | null>(null);
  const [hometown, setHometown] = useState<RegionValue | null>(null);
  const [residence, setResidence] = useState<RegionValue | null>(null);

  const filled = [height, birthday, hometown, residence].filter(Boolean).length;

  return (
    <div className="min-h-screen bg-paper">
      <div className="mx-auto flex min-h-screen max-w-[440px] flex-col">
        {/* 顶部：进度 */}
        <header className="sticky top-0 z-10 border-b border-line-soft bg-paper/95 px-5 py-3.5 backdrop-blur">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-[13px] text-muted-2">本人画像</span>
            <span className="text-[13px] font-medium text-brand">
              {filled} / 4 已填写
            </span>
          </div>
          <div className="h-1 w-full overflow-hidden rounded-full bg-line-soft">
            <div
              className="h-full rounded-full bg-brand transition-[width] duration-300 ease-out"
              style={{ width: `${(filled / 4) * 100}%` }}
            />
          </div>
        </header>

        <main className="flex-1 px-5 py-6">
          <h1 className="mb-1 text-[22px] font-bold text-ink">先认识一下你</h1>
          <p className="mb-6 text-[14px] leading-relaxed text-muted">
            这几项会直接影响给你推荐谁，也会出现在别人看到的卡片上。
          </p>

          {/* 性别决定身高的默认落点 */}
          <div className="mb-4">
            <p className="mb-2 text-[15px] text-muted">性别</p>
            <div className="flex gap-2">
              {(["female", "male"] as const).map((g) => (
                <button
                  key={g}
                  type="button"
                  onClick={() => setGender(g)}
                  className={
                    "flex-1 rounded-field border py-3 text-[15px] transition-colors " +
                    (gender === g
                      ? "border-brand bg-brand-soft font-medium text-brand-dark"
                      : "border-line bg-surface text-ink hover:border-brand/40")
                  }
                >
                  {g === "female" ? "女" : "男"}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-3">
            <BirthdayField value={birthday} onChange={setBirthday} />
            <HeightField
              value={height}
              onChange={setHeight}
              gender={gender}
            />
            <RegionField
              label="家乡"
              value={hometown}
              onChange={setHometown}
              placeholder="请选择家乡"
            />
            <RegionField
              label="现居地"
              value={residence}
              onChange={setResidence}
            />
          </div>

          {/* 实时把选择结果汇总出来，方便核对 */}
          <div className="mt-7 rounded-card border border-line bg-surface p-4">
            <p className="mb-2.5 text-[12px] font-medium tracking-wide text-muted-2">
              当前已选
            </p>
            <dl className="space-y-1.5 text-[14px]">
              <Row label="性别" value={gender === "female" ? "女" : "男"} />
              <Row
                label="出生"
                value={
                  birthday
                    ? `${birthday.year}-${String(birthday.month).padStart(2, "0")}-${String(birthday.day).padStart(2, "0")}（${calcAge(birthday)} 岁）`
                    : "—"
                }
              />
              <Row label="身高" value={height ? `${height} cm` : "—"} />
              <Row
                label="家乡"
                value={
                  hometown
                    ? `${shortName(hometown.province)} ${shortName(hometown.city)}`
                    : "—"
                }
              />
              <Row
                label="现居"
                value={
                  residence
                    ? `${shortName(residence.province)} ${shortName(residence.city)}`
                    : "—"
                }
              />
            </dl>
          </div>

          <p className="mt-6 text-center text-[12px] leading-relaxed text-muted-2">
            交互说明：身高用滚轮（100 个连续值需精确到厘米），
            <br />
            生日三列联动并实时算年龄，省市以搜索为主路径。
          </p>
        </main>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <dt className="shrink-0 text-muted-2">{label}</dt>
      <dd className="truncate font-medium tabular-nums text-ink">{value}</dd>
    </div>
  );
}
