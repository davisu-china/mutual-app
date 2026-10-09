import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface FieldRowProps {
  label: string;
  /** 已填的值；为空时显示占位文案 */
  value?: ReactNode;
  placeholder?: string;
  /** 值右侧的补充说明，如「28 岁」 */
  hint?: string;
  onClick: () => void;
  /** 校验未通过时的提示 */
  error?: string;
}

/**
 * 表单字段的触发行。
 *
 * 三个选择器（身高 / 生日 / 省市）共用同一个触发外观，
 * 这样用户在 Onboarding 五步里看到的是**同一种交互语言**：
 * 点一行 → 从底部弹出选择器 → 选完收起。
 *
 * 不用原生 <select>：原生控件在各端长相完全不同、无法定制，
 * 而且移动端会弹出系统级滚轮，样式和我们的品牌色割裂。
 */
export function FieldRow({
  label,
  value,
  placeholder = "请选择",
  hint,
  onClick,
  error,
}: FieldRowProps) {
  const filled = value !== undefined && value !== null && value !== "";
  return (
    <div>
      <button
        type="button"
        onClick={onClick}
        className={cn(
          "flex w-full items-center justify-between gap-3 rounded-field",
          "border bg-surface px-4 py-3.5 text-left",
          "transition-colors duration-150",
          "focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40",
          error ? "border-brand" : "border-line hover:border-line/80"
        )}
      >
        <span className="shrink-0 text-[15px] text-muted">{label}</span>
        <span className="flex min-w-0 items-center gap-2">
          <span
            className={cn(
              "truncate text-[15px]",
              filled ? "font-medium text-ink" : "text-muted-2"
            )}
          >
            {filled ? value : placeholder}
          </span>
          {filled && hint && (
            <span className="shrink-0 text-[13px] text-muted-2">{hint}</span>
          )}
          {/* 指示可点击的箭头 */}
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            className="shrink-0 text-muted-2"
            aria-hidden="true"
          >
            <path
              d="M9 6l6 6-6 6"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </span>
      </button>
      {error && (
        <p className="mt-1.5 px-1 text-[13px] text-brand">{error}</p>
      )}
    </div>
  );
}
