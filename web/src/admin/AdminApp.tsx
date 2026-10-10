import { useEffect, useState } from "react";
import { Navigate, NavLink, Route, Routes, useNavigate } from "react-router-dom";
import { ApiError } from "@/lib/api";
import { useAuth } from "@/store/auth";
import { adminApi } from "./api";
import AdminDashboard from "./Dashboard";
import { AdminUserDetail, AdminUsers } from "./Users";
import { AdminConversationDetail, AdminConversations } from "./Conversations";
import { ErrorNote, Loading } from "./ui";
import { cn } from "@/lib/utils";

/**
 * 后台的外壳：登录门槛 + 顶部导航 + 路由。
 *
 * **没有另做一套账号体系**：管理员就用自己已有的手机号密码登录（走同一个
 * /auth/login），权限由 users.is_admin 决定。好处是不给部署再加一个要人工同步的
 * 秘密，坏处是"谁能进后台"要在库里改——对一个内部工具来说这正好。
 *
 * 它被挂在 /admin/* 上，并且**绕开交友端那套登录墙和 onboarding 流程**：
 * 管理员自己的资料填没填完，跟能不能看后台是两件事。
 */
export default function AdminApp() {
  const { userId, ready } = useAuth();

  if (!ready) return <Centered><Loading label="检查登录状态" /></Centered>;
  if (!userId) return <AdminLogin />;
  return <AdminShell />;
}

function Centered({ children }: { children: React.ReactNode }) {
  return <div className="flex min-h-screen items-center justify-center bg-paper px-6">{children}</div>;
}

/* ------------------------------------------------------------------ 登录 */

function AdminLogin() {
  const { login } = useAuth();
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy || !phone || !password) return;
    setBusy(true);
    setErr("");
    try {
      await login(phone.trim(), password);
      // 登录成功后 userId 会变，外层自动切到 AdminShell，权限校验在那里做
    } catch (e2) {
      setErr(e2 instanceof ApiError ? e2.message : "登录失败，请重试");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Centered>
      <form onSubmit={submit} className="w-full max-w-[360px] rounded-card border border-line bg-surface p-7 shadow-card">
        <h1 className="text-[19px] font-semibold text-ink">相悦 · 后台</h1>
        <p className="mt-1 text-[12.5px] leading-relaxed text-muted-2">
          用你自己的账号登录。没有后台权限的账号会看到提示，不会进到任何数据。
        </p>

        <label className="mt-6 block text-[13px] text-muted">手机号</label>
        <input
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          inputMode="numeric"
          autoComplete="username"
          className="mt-1.5 h-11 w-full rounded-field border border-line bg-surface px-3.5 text-[15px] text-ink outline-none transition-colors focus:border-brand"
        />

        <label className="mt-4 block text-[13px] text-muted">密码</label>
        <input
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          type="password"
          autoComplete="current-password"
          className="mt-1.5 h-11 w-full rounded-field border border-line bg-surface px-3.5 text-[15px] text-ink outline-none transition-colors focus:border-brand"
        />

        {err ? <p className="mt-4 rounded-field bg-brand-soft px-3 py-2 text-[13px] text-brand-dark">{err}</p> : null}

        <button
          type="submit"
          disabled={busy || !phone || !password}
          className="mt-6 h-11 w-full rounded-field bg-brand text-[15px] font-medium text-white transition-colors hover:bg-brand-dark disabled:opacity-50"
        >
          {busy ? "登录中…" : "登录"}
        </button>
      </form>
    </Centered>
  );
}

/* ------------------------------------------------------------------ 外壳 */

function AdminShell() {
  const { userId, logout } = useAuth();
  const nav = useNavigate();
  const [gate, setGate] = useState<"checking" | "ok" | "denied" | "error">("checking");

  // 进后台先探一次权限：让"没有权限"在门口就说清楚，
  // 而不是等三张表都渲染出来、每张各报一次 403
  useEffect(() => {
    adminApi
      .stats()
      .then(() => setGate("ok"))
      .catch((e: unknown) => setGate(e instanceof ApiError && e.code === "NOT_ADMIN" ? "denied" : "error"));
  }, [userId]);

  if (gate === "checking") return <Centered><Loading label="校验后台权限" /></Centered>;

  if (gate === "denied") {
    return (
      <Centered>
        <div className="w-full max-w-[420px] rounded-card border border-line bg-surface p-7 text-center shadow-card">
          <h1 className="text-[17px] font-semibold text-ink">这个账号没有后台权限</h1>
          <p className="mt-2 text-[13px] leading-relaxed text-muted">
            后台权限由数据库里的 <span className="font-mono text-[12px]">users.is_admin</span> 决定。
            需要开通的话，让运维把这一位置为 true。
          </p>
          <button
            type="button"
            onClick={async () => {
              await logout();
              nav("/admin", { replace: true });
            }}
            className="mt-6 rounded-field border border-line px-4 py-2 text-[13.5px] text-muted transition-colors hover:border-brand/40 hover:text-ink"
          >
            换个账号登录
          </button>
        </div>
      </Centered>
    );
  }

  if (gate === "error") {
    return <Centered><ErrorNote msg="连不上后台接口——可能是网络问题，或者服务端还没部署后台那部分。" /></Centered>;
  }

  return (
    <div className="min-h-screen bg-paper">
      <header className="sticky top-0 z-20 border-b border-line bg-paper/95 backdrop-blur">
        <div className="mx-auto flex max-w-[1180px] items-center gap-6 px-6 py-3">
          <span className="text-[15px] font-semibold text-ink">
            相悦<span className="ml-1.5 font-normal text-muted-2">后台</span>
          </span>
          <nav className="flex items-center gap-1">
            {[
              ["/admin", "概览"],
              ["/admin/users", "用户"],
              ["/admin/conversations", "会话"],
            ].map(([to, label]) => (
              <NavLink
                key={to}
                to={to}
                end={to === "/admin"}
                className={({ isActive }) =>
                  cn(
                    "rounded-pill px-3.5 py-1.5 text-[13.5px] transition-colors",
                    isActive ? "bg-brand-soft font-medium text-brand-dark" : "text-muted hover:text-ink"
                  )
                }
              >
                {label}
              </NavLink>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-3">
            <span className="font-mono text-[12px] text-muted-2">uid {userId}</span>
            <button
              type="button"
              onClick={async () => {
                await logout();
                nav("/admin", { replace: true });
              }}
              className="text-[13px] text-muted-2 transition-colors hover:text-ink"
            >
              退出
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1180px] px-6 py-6">
        <Routes>
          <Route index element={<AdminDashboard />} />
          <Route path="users" element={<AdminUsers />} />
          <Route path="users/:id" element={<AdminUserDetail />} />
          <Route path="conversations" element={<AdminConversations />} />
          <Route path="conversations/:id" element={<AdminConversationDetail />} />
          {/* 后台里的未知路径回概览，而不是掉进交友端的 404 */}
          <Route path="*" element={<Navigate to="/admin" replace />} />
        </Routes>
      </main>
    </div>
  );
}
