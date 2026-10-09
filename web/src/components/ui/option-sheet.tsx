import { useState } from "react";
import { FieldRow } from "@/components/ui/field-row";
import { Sheet } from "@/components/ui/sheet";
import { Choice, type ChoiceOption } from "@/components/ui/choice";

interface Props<T extends string | number | boolean> {
  label: string;
  options: ChoiceOption<T>[];
  value: T | null | undefined;
  onChange: (v: T) => void;
  /** 弹层里的列数 */
  columns?: number;
  /** 弹层标题，默认用 label */
  title?: string;
  placeholder?: string;
  /** 弹层里选项上方的一句说明 */
  hint?: string;
}

/**
 * 「一行 + 底部弹层」的单选字段。
 *
 * 选项直接铺在页面上时，多档枚举（年收入 6 档、职业 11 项）会把一步表单撑得很长，
 * 用户要不停往下滚才能看到后面的字段。收进弹层后每项只占一行，
 * 和身高/生日/省市/MBTI 是同一种交互语言：点一行 → 从底部弹出 → 选完收起。
 *
 * 单选没有「确认」步骤：点中即写回并关闭——和滑杆那种连续调节不一样，
 * 多一步确认只会让人多点一下。
 */
export function OptionSheet<T extends string | number | boolean>({
  label,
  options,
  value,
  onChange,
  columns,
  title,
  placeholder = "请选择",
  hint,
}: Props<T>) {
  const [open, setOpen] = useState(false);
  const current = options.find((o) => o.value === value);

  return (
    <>
      <FieldRow
        label={label}
        value={current?.label ?? ""}
        placeholder={placeholder}
        onClick={() => setOpen(true)}
      />

      <Sheet open={open} onClose={() => setOpen(false)} title={title ?? label}>
        <div className="px-5 pb-6 pt-1">
          {hint && <p className="mb-3 text-[13px] leading-relaxed text-muted-2">{hint}</p>}
          <Choice
            options={options}
            value={value}
            columns={columns}
            onChange={(v) => {
              onChange(v);
              setOpen(false);
            }}
          />
        </div>
      </Sheet>
    </>
  );
}
