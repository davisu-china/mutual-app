import { useState } from "react";
import { cn } from "@/lib/utils";
import { Sheet } from "@/components/ui/sheet";
import { FieldRow } from "@/components/ui/field-row";

/** 四个维度，顺序即类型字母的顺序（E/I · S/N · T/F · J/P）。 */
export const MBTI_DIMS = [
  { left: "E", right: "I", leftHint: "外向", rightHint: "内向" },
  { left: "S", right: "N", leftHint: "实感", rightHint: "直觉" },
  { left: "T", right: "F", leftHint: "思考", rightHint: "情感" },
  { left: "J", right: "P", leftHint: "判断", rightHint: "感知" },
] as const;

/** 四个维度各一个字母，未选的维度为 null。 */
export type MbtiDims = (string | null)[];

export function emptyDims(): MbtiDims {
  return MBTI_DIMS.map(() => null);
}

export function dimsToMbti(dims: MbtiDims): string | null {
  return dims.every((x) => x) ? dims.join("") : null;
}

/** 把 "ENFP" 拆回四个维度。"NONE"（不知道）和任何非四字母的值都当作都没选。 */
export function splitMbti(v: string | null | undefined): MbtiDims {
  if (!v) return emptyDims();
  return MBTI_DIMS.map((dim, i) => {
    const ch = v[i];
    return ch === dim.left || ch === dim.right ? ch : null;
  });
}

/**
 * MBTI 选择器。
 *
 * 不把 16 个类型铺成一片格子，而是让用户按四个维度各自滑动 —— 很多人根本不知道
 * 自己的四字母组合，但「更外向还是更内向」是答得出来的。
 *
 * 用原生 range（min=0 / max=2 / step=1）而不是自己画轨道：中间位代表「还没选」，
 * 滑到哪一端就是哪个字母。惯性、键盘操作和移动端手感都交给浏览器，也顺带有了无障碍。
 * 两个端点各带一个中文提示，避免用户不认识字母缩写。
 */
export function MbtiSlider({
  dims,
  onChange,
}: {
  dims: MbtiDims;
  onChange: (dims: MbtiDims) => void;
}) {
  const type = dimsToMbti(dims);

  return (
    <div className="space-y-3">
      {MBTI_DIMS.map((dim, i) => {
        const v = dims[i];
        const pos = v === dim.left ? 0 : v === dim.right ? 2 : 1;
        return (
          <div key={dim.left}>
            <div className="mb-1 flex items-baseline justify-between text-[13px]">
              <span className={cn(v === dim.left ? "font-semibold text-brand-dark" : "text-muted-2")}>
                {dim.left} · {dim.leftHint}
              </span>
              <span className={cn(v === dim.right ? "font-semibold text-brand-dark" : "text-muted-2")}>
                {dim.rightHint} · {dim.right}
              </span>
            </div>
            <input
              type="range"
              min={0}
              max={2}
              step={1}
              value={pos}
              aria-label={`${dim.left}（${dim.leftHint}）还是 ${dim.right}（${dim.rightHint}）`}
              onChange={(e) => {
                const n = Number(e.target.value);
                const next = [...dims];
                next[i] = n === 0 ? dim.left : n === 2 ? dim.right : null;
                onChange(next);
              }}
              className="h-6 w-full accent-[#E4596B]"
            />
          </div>
        );
      })}
      <p className="text-center text-[13px] text-muted-2">
        {type ? (
          <>
            你的类型：<span className="text-[15px] font-bold tracking-wide text-ink">{type}</span>
          </>
        ) : (
          "四个维度都滑一下就有了"
        )}
      </p>
    </div>
  );
}

/**
 * 表单里的 MBTI 字段：平时只占一行，点开才是那四根滑杆。
 *
 * 四根滑杆直接铺在页面上太占地方（还会把「本人画像」这一屏撑长一倍），
 * 所以收进底部弹层——和身高、生日、省市三个选择器是同一种交互语言：
 * 点一行 → 从底部弹出 → 选完收起。
 *
 * 弹层里先滑、点「确认」才写回表单：中途取消不该改动已经填好的值。
 */
export function MbtiField({
  value,
  onChange,
}: {
  value: string | null;
  onChange: (v: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<MbtiDims>(() => splitMbti(value));

  const type = dimsToMbti(draft);

  function openSheet() {
    setDraft(splitMbti(value)); // 每次打开都从当前值重新开始
    setOpen(true);
  }

  return (
    <>
      <FieldRow label="MBTI" value={value ?? ""} placeholder="请选择" onClick={openSheet} />

      <Sheet
        open={open}
        onClose={() => setOpen(false)}
        title="MBTI"
        confirmText={type ? "确认" : undefined}
        onConfirm={() => {
          if (!type) return;
          onChange(type);
          setOpen(false);
        }}
      >
        <div className="px-5 pb-6 pt-1">
          <p className="mb-4 text-[13px] leading-relaxed text-muted-2">
            按四个维度各自滑动即可，不必先知道自己属于哪一型。
          </p>
          <MbtiSlider dims={draft} onChange={setDraft} />
        </div>
      </Sheet>
    </>
  );
}
