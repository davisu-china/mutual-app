import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/utils";

type Variant = "primary" | "ghost" | "outline" | "danger";
type Size = "md" | "lg" | "sm";

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  children: ReactNode;
}

const variants: Record<Variant, string> = {
  primary: "bg-brand text-white hover:bg-brand-dark shadow-brand/60 shadow-md",
  ghost: "text-ink hover:bg-line-soft",
  outline: "border border-line bg-surface text-ink hover:border-brand/40",
  danger: "border border-line bg-surface text-brand hover:bg-brand-soft",
};

const sizes: Record<Size, string> = {
  sm: "px-3 py-1.5 text-[13px] rounded-lg",
  md: "px-4 py-3 text-[15px] rounded-field",
  lg: "px-5 py-3.5 text-[16px] rounded-field",
};

export function Button({
  variant = "primary",
  size = "md",
  loading,
  className,
  children,
  disabled,
  ...rest
}: Props) {
  return (
    <button
      {...rest}
      disabled={disabled || loading}
      className={cn(
        "inline-flex items-center justify-center gap-1.5 font-medium transition-all duration-150",
        "focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40",
        // 按下时轻微缩小，给一个「按到了」的即时反馈
        "active:scale-[0.97] disabled:opacity-50 disabled:active:scale-100",
        variants[variant],
        sizes[size],
        className
      )}
    >
      {loading && <Spinner />}
      {children}
    </button>
  );
}

export function Spinner({ className }: { className?: string }) {
  return (
    <svg
      className={cn("h-4 w-4 animate-spin", className)}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2.5" opacity=".25" />
      <path
        d="M21 12a9 9 0 0 0-9-9"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
      />
    </svg>
  );
}
