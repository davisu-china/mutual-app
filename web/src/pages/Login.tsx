import { useState } from "react";
import { HeartHandshake } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/store/auth";
import { ApiError } from "@/lib/api";

type Mode = "login" | "register";

export default function Login() {
  const { login, register } = useAuth();
  const [mode, setMode] = useState<Mode>("login");
  const [phone, setPhone] = useState("");
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [agreed, setAgreed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const phoneOk = /^1[3-9]\d{9}$/.test(phone);
  const pwOk = pw.length >= 8 && pw.length <= 20 && /[a-zA-Z]/.test(pw) && /\d/.test(pw);
  const pw2Ok = mode === "login" || pw === pw2;

  const canSubmit =
    phoneOk && pwOk && pw2Ok && (mode === "login" || agreed) && !busy;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setBusy(true);
    setErr("");
    try {
      if (mode === "login") await login(phone, pw);
      else await register(phone, pw);
    } catch (e2) {
      setErr(e2 instanceof ApiError ? e2.message : "网络异常，请稍后重试");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="relative flex min-h-screen flex-col justify-center overflow-hidden bg-paper px-6 pb-16">
      {/* 顶部一层柔和的玫瑰光：登录页是全站第一印象，纯色底显得像内部工具 */}
      <div
        className="pointer-events-none absolute inset-x-0 -top-40 h-96 bg-[radial-gradient(60%_60%_at_50%_50%,rgba(163,46,78,.14),transparent_70%)]"
        aria-hidden="true"
      />
      <div className="relative mx-auto w-full max-w-[400px]">
        <div className="mb-10 text-center">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-[22px] bg-gradient-to-br from-brand to-brand-deep shadow-brand">
            <HeartHandshake size={30} strokeWidth={1.9} className="text-white" aria-hidden="true" />
          </div>
          <h1 className="font-sans text-[34px] font-bold tracking-tight text-ink">相悦</h1>
          <p className="mt-2 text-[14px] text-muted-2">两情相悦，才值得开始</p>
        </div>

        {/* 登录/注册切换做成胶囊，一眼看清当前在哪一边 */}
        <div className="mb-6 flex rounded-field bg-line-soft p-1">
          {(["login", "register"] as Mode[]).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => {
                setMode(m);
                setErr("");
              }}
              className={
                "flex-1 rounded-[7px] py-2 text-[14px] font-medium transition-all duration-200 " +
                (mode === m ? "bg-surface text-ink shadow-sm" : "text-muted-2")
              }
            >
              {m === "login" ? "登录" : "注册"}
            </button>
          ))}
        </div>

        <form onSubmit={submit} className="space-y-4">
          <Input
            label="手机号"
            type="tel"
            inputMode="numeric"
            maxLength={11}
            value={phone}
            onChange={(e) => setPhone(e.target.value.replace(/\D/g, ""))}
            placeholder="请输入 11 位手机号"
            autoComplete="tel"
            error={phone && !phoneOk ? "手机号格式不正确" : undefined}
          />
          <Input
            label="密码"
            type="password"
            value={pw}
            onChange={(e) => setPw(e.target.value)}
            placeholder="8–20 位，含字母和数字"
            autoComplete={mode === "login" ? "current-password" : "new-password"}
            error={pw && !pwOk ? "需 8–20 位，且同时包含字母和数字" : undefined}
          />
          {mode === "register" && (
            <Input
              label="确认密码"
              type="password"
              value={pw2}
              onChange={(e) => setPw2(e.target.value)}
              placeholder="再输一次"
              autoComplete="new-password"
              error={pw2 && !pw2Ok ? "两次输入不一致" : undefined}
            />
          )}

          {mode === "register" && (
            <label className="flex items-start gap-2.5 pt-1 text-[13px] leading-relaxed text-muted-2">
              <input
                type="checkbox"
                checked={agreed}
                onChange={(e) => setAgreed(e.target.checked)}
                className="mt-[3px] h-4 w-4 shrink-0 accent-brand"
              />
              <span>
                我已阅读并同意
                <span className="text-brand">《用户协议》</span>和
                <span className="text-brand">《隐私政策》</span>
              </span>
            </label>
          )}

          {err && (
            <p className="rounded-field bg-brand-soft px-4 py-3 text-[13px] text-brand-dark">
              {err}
            </p>
          )}

          <Button type="submit" size="lg" className="w-full" loading={busy} disabled={!canSubmit}>
            {mode === "login" ? "登录" : "注册并开始填写资料"}
          </Button>
        </form>

        <p className="mt-6 text-center text-[12px] leading-relaxed text-muted-2">
          注册后需要填写资料才能开始匹配
          <br />
          本平台仅面向 18 周岁以上用户
        </p>
      </div>
    </div>
  );
}
