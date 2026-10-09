import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";

interface Toast {
  id: number;
  text: string;
  kind: "info" | "error";
}

const Ctx = createContext<(text: string, kind?: "info" | "error") => void>(() => {});

export function ToastProvider({ children }: { children: ReactNode }) {
  const [list, setList] = useState<Toast[]>([]);

  const push = useCallback((text: string, kind: "info" | "error" = "info") => {
    const id = Date.now() + Math.random();
    setList((l) => [...l, { id, text, kind }]);
    // 停留时间够读完一句话，又不至于挡着操作
    setTimeout(() => setList((l) => l.filter((t) => t.id !== id)), 2600);
  }, []);

  return (
    <Ctx.Provider value={push}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 top-3 z-[60] flex flex-col items-center gap-2 px-4">
        {list.map((t) => (
          <div
            key={t.id}
            className={cn(
              "pointer-events-auto max-w-[420px] rounded-xl px-4 py-2.5 text-[14px] shadow-card",
              "animate-sheet-up",
              t.kind === "error"
                ? "bg-brand text-white"
                : "bg-ink/90 text-white backdrop-blur"
            )}
          >
            {t.text}
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}

export function useToast() {
  return useContext(Ctx);
}
