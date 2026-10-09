import type { InputHTMLAttributes, TextareaHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

interface Props extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  hint?: string;
}

export function Input({ label, error, hint, className, ...rest }: Props) {
  return (
    <label className="block">
      {label && <span className="mb-1.5 block text-[14px] text-muted">{label}</span>}
      <input
        {...rest}
        className={cn(
          "w-full rounded-field border bg-surface px-4 py-3 text-[15px] text-ink",
          "placeholder:text-muted-2 transition-colors",
          "focus:outline-none focus:ring-2 focus:ring-brand/30",
          error ? "border-brand" : "border-line focus:border-brand/50",
          className
        )}
      />
      {error ? (
        <span className="mt-1.5 block text-[13px] text-brand">{error}</span>
      ) : hint ? (
        <span className="mt-1.5 block text-[13px] text-muted-2">{hint}</span>
      ) : null}
    </label>
  );
}

export function Textarea({
  label,
  error,
  hint,
  max,
  value,
  className,
  ...rest
}: TextareaHTMLAttributes<HTMLTextAreaElement> & {
  label?: string;
  error?: string;
  hint?: string;
  max?: number;
}) {
  const len = typeof value === "string" ? [...value].length : 0;
  return (
    <label className="block">
      {label && (
        <span className="mb-1.5 flex items-center justify-between text-[14px] text-muted">
          <span>{label}</span>
          {max && (
            <span className={cn("text-[12px]", len > max ? "text-brand" : "text-muted-2")}>
              {len}/{max}
            </span>
          )}
        </span>
      )}
      <textarea
        {...rest}
        value={value}
        className={cn(
          "w-full resize-none rounded-field border bg-surface px-4 py-3 text-[15px]",
          "leading-relaxed text-ink placeholder:text-muted-2",
          "focus:outline-none focus:ring-2 focus:ring-brand/30",
          error ? "border-brand" : "border-line focus:border-brand/50",
          className
        )}
      />
      {error ? (
        <span className="mt-1.5 block text-[13px] text-brand">{error}</span>
      ) : hint ? (
        <span className="mt-1.5 block text-[13px] text-muted-2">{hint}</span>
      ) : null}
    </label>
  );
}
