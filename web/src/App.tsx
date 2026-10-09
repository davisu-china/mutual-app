import { BrowserRouter, Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { AuthProvider, useAuth } from "@/store/auth";
import { ToastProvider } from "@/components/ui/toast";
import { Spinner } from "@/components/ui/button";
import Login from "@/pages/Login";
import Onboarding from "@/pages/Onboarding";
import Discover from "@/pages/Discover";
import Plaza from "@/pages/Plaza";
import Likes from "@/pages/Likes";
import Profile from "@/pages/Profile";
import UserDetail from "@/pages/UserDetail";
import { ChatEntry, ChatList, ChatRoom } from "@/pages/Chat";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";

export default function App() {
  return (
    <BrowserRouter>
      <ToastProvider>
        <AuthProvider>
          <Shell />
        </AuthProvider>
      </ToastProvider>
    </BrowserRouter>
  );
}

function Shell() {
  const { userId, onboarded, ready } = useAuth();
  const loc = useLocation();

  if (!ready) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-paper text-brand">
        <Spinner className="h-6 w-6" />
      </div>
    );
  }

  if (!userId) {
    return (
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    );
  }

  // 未完成 Onboarding 时**强制**停在向导页——这是产品规则，
  // 后端中间件也拦着，这里只是让用户不去撞那个错误
  if (!onboarded && !loc.pathname.startsWith("/onboarding")) {
    return <Navigate to="/onboarding" replace />;
  }
  if (onboarded && loc.pathname.startsWith("/onboarding")) {
    // 已完成的用户点「编辑」也应该能进，所以不强制跳走，只在完成后由页面自己 nav
  }

  const hideTab =
    loc.pathname.startsWith("/onboarding") ||
    loc.pathname.startsWith("/chat/") ||
    loc.pathname.startsWith("/u/");

  return (
    <div className={hideTab ? "" : "pb-[68px]"}>
      <Routes>
        <Route path="/login" element={<Navigate to="/" replace />} />
        <Route path="/onboarding" element={<Onboarding />} />
        <Route path="/" element={<Discover />} />
        <Route path="/plaza" element={<Plaza />} />
        <Route path="/likes" element={<Likes />} />
        <Route path="/chat" element={<ChatList />} />
        <Route path="/chat/new" element={<ChatEntry />} />
        <Route path="/chat/:id" element={<ChatRoom />} />
        <Route path="/me" element={<Profile />} />
        <Route path="/u/:id" element={<UserDetail />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      {!hideTab && <TabBar />}
    </div>
  );
}

function TabBar() {
  const nav = useNavigate();
  const loc = useLocation();
  const [badge, setBadge] = useState({ likes: 0, unread: 0 });

  // 角标是最主要的召回钩子，切页时刷新一次
  useEffect(() => {
    let cancelled = false;
    const tick = () => {
      api
        .get<{ likes: number; unread: number }>("/counts")
        .then((c) => !cancelled && setBadge({ likes: c.likes, unread: c.unread }))
        .catch(() => {});
    };
    tick();
    const t = window.setInterval(tick, 30000);
    return () => {
      cancelled = true;
      window.clearInterval(t);
    };
  }, [loc.pathname]);

  const tabs = [
    { path: "/", label: "发现" },
    { path: "/plaza", label: "广场" },
    { path: "/likes", label: "心动", dot: badge.likes },
    { path: "/chat", label: "消息", dot: badge.unread },
    { path: "/me", label: "我的" },
  ];

  return (
    <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-line-soft bg-surface/95 backdrop-blur">
      <div className="mx-auto flex max-w-[520px] pb-safe pt-1.5">
        {tabs.map((t) => {
          const on = t.path === "/" ? loc.pathname === "/" : loc.pathname.startsWith(t.path);
          return (
            <button
              key={t.path}
              type="button"
              onClick={() => nav(t.path)}
              className="relative flex flex-1 flex-col items-center gap-0.5 py-1.5"
            >
              <span
                className={cn(
                  "text-[12.5px] transition-colors",
                  on ? "font-semibold text-brand" : "text-muted-2"
                )}
              >
                {t.label}
              </span>
              {t.dot ? (
                <span className="absolute right-[22%] top-1 flex h-[15px] min-w-[15px] items-center justify-center rounded-full bg-brand px-1 text-[9px] font-bold text-white">
                  {t.dot > 99 ? "99+" : t.dot}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>
    </nav>
  );
}
