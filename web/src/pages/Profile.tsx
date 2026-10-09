import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { ListSkeleton } from "@/components/ui/empty";
import { PhotoGrid } from "@/components/profile/photo-grid";
import { useToast } from "@/components/ui/toast";
import { api, ApiError, type Photo, type Profile as ProfileT } from "@/lib/api";
import { useAuth } from "@/store/auth";
import {
  EDUCATION_LABEL, INCOME_LABEL, SMOKING, DRINKING, HOUSE, DINK,
} from "@/data/options";

const lbl = (arr: { value: number; label: string }[], v?: number) =>
  v === undefined || v === null ? "—" : arr.find((x) => x.value === v)?.label ?? "—";

export default function Profile() {
  const nav = useNavigate();
  const toast = useToast();
  const { logout } = useAuth();
  const [p, setP] = useState<ProfileT | null>(null);
  const [photos, setPhotos] = useState<Photo[]>([]);

  useEffect(() => {
    api
      .get<ProfileT>("/users/me")
      .then(setP)
      .catch((e) => {
        if (e instanceof ApiError && e.code === "ONBOARDING_REQUIRED") {
          nav("/onboarding", { replace: true });
        }
      });
    api
      .get<{ items: Photo[] }>("/users/me/photos")
      .then((r) => setPhotos(r.items ?? []))
      .catch(() => {});
  }, [nav]);

  if (!p) {
    return (
      <div className="min-h-screen bg-paper px-5 py-6">
        <ListSkeleton rows={4} />
      </div>
    );
  }

  const light = p.completeness >= 90 ? "很完整" : p.completeness >= 85 ? "基本完整" : "还能再补";

  return (
    <div className="min-h-screen bg-paper pb-24">
      <header className="px-5 pb-4 pt-6">
        <div className="flex items-center gap-4">
          <div className="h-16 w-16 shrink-0 overflow-hidden rounded-full bg-line-soft">
            {p.avatarUrl ? (
              <img src={p.avatarUrl} alt="" className="h-full w-full object-cover" />
            ) : (
              <span className="flex h-full items-center justify-center text-[20px] font-bold text-muted-2">
                {p.nickname.slice(0, 1)}
              </span>
            )}
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[18px] font-bold text-ink">{p.nickname}</p>
            <p className="mt-0.5 text-[13px] text-muted-2">
              {p.age} 岁 · {p.city || "—"}
              {p.heightCm ? ` · ${p.heightCm}cm` : ""}
            </p>
          </div>
          <Button size="sm" variant="outline" onClick={() => nav("/onboarding")}>
            编辑
          </Button>
        </div>

        {/* 完整度：顺带告诉用户「补什么能提升曝光」 */}
        <div className="mt-4">
          <div className="mb-1.5 flex items-center justify-between text-[12px]">
            <span className="text-muted-2">
              资料完整度 <span className="text-brand">{p.completeness}%</span>
              <span className="ml-1.5 text-muted-2">（{light}）</span>
            </span>
            {p.completeness < 100 && (
              <button
                type="button"
                onClick={() => nav("/onboarding")}
                className="text-brand"
              >
                去补充
              </button>
            )}
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-line-soft">
            <div
              className="h-full rounded-full bg-brand transition-[width] duration-500 ease-out"
              style={{ width: `${p.completeness}%` }}
            />
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[520px] space-y-6 px-5">
        <div className="rounded-card border border-line bg-surface p-4">
          <PhotoGrid photos={photos} onChange={setPhotos} />
        </div>

        {p.aboutMe && (
          <div className="rounded-card border border-line bg-surface p-4">
            <p className="mb-2 text-[13px] text-muted-2">关于我</p>
            <p className="whitespace-pre-wrap text-[14px] leading-[1.8] text-ink-2">{p.aboutMe}</p>
          </div>
        )}

        <div className="rounded-card border border-line bg-surface p-4">
          <p className="mb-3 text-[13px] text-muted-2">基本资料</p>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-[14px]">
            <Row k="家乡" v={`${p.hometownProvince}${p.hometownCity}`} />
            <Row k="现居" v={`${p.cityProvince}${p.city}`} />
            <Row k="职业" v={p.occupation} />
            <Row k="学历" v={EDUCATION_LABEL(p.education)} />
            <Row k="MBTI" v={p.mbti === "NONE" ? "未测" : p.mbti ?? "—"} />
            <Row k="抽烟" v={lbl(SMOKING, p.smoking)} />
            <Row k="喝酒" v={lbl(DRINKING, p.drinking)} />
            <Row k="年收入" v={INCOME_LABEL(p.incomeRange) + (p.incomePublic ? "" : "（仅匹配用）")} />
            <Row k="是否有房" v={lbl(HOUSE, p.hasHouse)} />
            <Row k="是否丁克" v={lbl(DINK, p.isDink)} />
            {p.school && <Row k="学校" v={p.school} />}
            {p.company && <Row k="公司" v={p.company + (p.companyPublic ? "" : "（仅自己可见）")} />}
          </dl>
        </div>

        <div className="rounded-card border border-line bg-surface">
          <MenuItem onClick={() => nav("/onboarding")}>编辑资料与伴侣偏好</MenuItem>
          <MenuItem onClick={() => nav("/likes")}>谁喜欢我 / 谁看过我</MenuItem>
          <MenuItem onClick={() => nav("/plaza")}>恋爱广场</MenuItem>
        </div>

        <button
          type="button"
          onClick={() => {
            logout();
            toast("已退出登录");
          }}
          className="w-full rounded-card border border-line bg-surface py-3.5 text-[15px] text-brand transition-colors hover:bg-brand-soft"
        >
          退出登录
        </button>
      </main>
    </div>
  );
}

function Row({ k, v, muted }: { k: string; v: string; muted?: boolean }) {
  return (
    <div>
      <dt className="text-[12px] text-muted-2">{k}</dt>
      <dd className={muted ? "mt-0.5 text-muted-2" : "mt-0.5 text-ink"}>{v}</dd>
    </div>
  );
}

function MenuItem({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center justify-between border-b border-line-soft px-4 py-3.5 text-left text-[15px] text-ink last:border-b-0 hover:bg-paper"
    >
      {children}
      <span className="text-muted-2">›</span>
    </button>
  );
}
