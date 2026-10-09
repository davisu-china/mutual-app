import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { ListSkeleton, Empty } from "@/components/ui/empty";
import { useToast } from "@/components/ui/toast";
import { api, ApiError, type ActionResult, type Profile } from "@/lib/api";
import {
  EDUCATION_LABEL, INCOME_LABEL, SMOKING, DRINKING, HOUSE, DINK,
} from "@/data/options";
import { cn } from "@/lib/utils";
import { fieldIcon } from "@/components/ui/icons";
import { EyeOff } from "lucide-react";

const label = (arr: { value: number; label: string }[], v?: number) =>
  v === undefined || v === null ? "—" : arr.find((x) => x.value === v)?.label ?? "—";

export default function UserDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const toast = useToast();
  const [p, setP] = useState<Profile | null | "error">(null);
  const [busy, setBusy] = useState(false);
  // p 可能是 "error" 哨兵值，取关系前先排掉
  const rel = p && p !== "error" ? p.relation : undefined;

  useEffect(() => {
    if (!id) return;
    api
      .get<Profile>(`/users/${id}`)
      .then(setP)
      .catch(() => setP("error"));
  }, [id]);

  async function act(action: "like" | "pass") {
    if (!p || p === "error" || busy) return;
    setBusy(true);
    try {
      const res = await api.post<ActionResult>("/actions", {
        toUser: p.userId,
        action,
        source: "plaza",
      });
      // 先本地反映关系：万一 nav(-1) 无处可回（比如从链接直接进来），
      // 底部操作条也不会停在「喜欢 / 跳过」上
      setP((prev) =>
        prev && prev !== "error"
          ? {
              ...prev,
              relation: {
                liked: action === "like" || !!prev.relation?.liked,
                passed: action === "pass" || !!prev.relation?.passed,
                matched: res.matched || !!prev.relation?.matched,
              },
            }
          : prev
      );
      toast(res.matched ? `和 ${p.nickname} 配对成功` : action === "like" ? "已表达喜欢" : "已跳过");
      nav(-1);
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "操作失败", "error");
    } finally {
      setBusy(false);
    }
  }

  if (p === null) {
    return (
      <div className="min-h-screen bg-paper px-5 py-6">
        <ListSkeleton rows={3} />
      </div>
    );
  }
  if (p === "error") {
    return (
      <div className="min-h-screen bg-paper">
        <Empty icon={EyeOff} title="看不到这个人的资料" desc="对方可能已经注销，或者你们之间存在拉黑关系。" />
      </div>
    );
  }

  const photos = p.photos ?? [];
  const main = photos[0]?.url || p.avatarUrl;

  return (
    <div className="min-h-screen bg-paper pb-28">
      <button
        type="button"
        onClick={() => nav(-1)}
        className="fixed left-4 top-4 z-20 flex h-9 w-9 items-center justify-center rounded-full bg-black/35 text-white backdrop-blur"
        aria-label="返回"
      >
        ←
      </button>

      {/* 相册横向滚动 */}
      <div className="flex snap-x snap-mandatory gap-1 overflow-x-auto">
        {(photos.length ? photos : [{ id: 0, url: main, sortOrder: 1 }]).map((ph, i) => (
          <div key={ph.id ?? i} className="h-[380px] w-full shrink-0 snap-center bg-line-soft">
            {ph.url ? (
              <img
                src={ph.url}
                alt=""
                decoding="async"
                className="h-full w-full object-cover"
              />
            ) : null}
          </div>
        ))}
      </div>
      {photos.length > 1 && (
        <div className="mt-3 flex justify-center gap-1.5">
          {photos.map((ph) => (
            <span key={ph.id} className="h-1.5 w-1.5 rounded-full bg-line" />
          ))}
        </div>
      )}

      <div className="mx-auto max-w-[520px] px-5 py-5">
        <h1 className="text-[24px] font-bold text-ink">
          {p.nickname} <span className="text-[18px] font-normal text-muted">{p.age}</span>
        </h1>
        <p className="mt-1 text-[13.5px] text-muted">
          {p.cityProvince}
          {p.city} · {p.heightCm}cm · {p.occupation}
        </p>

        {p.aboutMe && (
          <Section title="关于我">
            <p className="whitespace-pre-wrap text-[14.5px] leading-[1.8] text-ink-2">{p.aboutMe}</p>
          </Section>
        )}

        {p.hobbies && p.hobbies.length > 0 && (
          <Section title="兴趣爱好">
            <div className="space-y-3">
              {p.hobbies.map((h) => (
                <div key={h.name}>
                  <span className="rounded-full border border-brand-line bg-brand-soft px-3 py-1 text-[12.5px] font-medium text-brand-dark">
                    {h.name}
                  </span>
                  <p className="mt-1.5 text-[14px] leading-relaxed text-ink-2">{h.description}</p>
                </div>
              ))}
            </div>
          </Section>
        )}

        <Section title="基本情况">
          <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-[14px]">
            <Item k="学历" v={EDUCATION_LABEL(p.education)} />
            {p.school && <Item k="学校" v={p.school} />}
            <Item k="抽烟" v={label(SMOKING, p.smoking)} />
            <Item k="喝酒" v={label(DRINKING, p.drinking)} />
            <Item k="是否独生" v={p.isOnlyChild ? "是" : "否"} />
            <Item k="是否有车" v={p.hasCar ? "有" : "无"} />
            <Item k="是否有房" v={label(HOUSE, p.hasHouse)} />
            <Item k="是否丁克" v={label(DINK, p.isDink)} />
            <Item k="MBTI" v={p.mbti === "NONE" ? "未测" : p.mbti ?? "—"} />
            {/* 对方没公开的字段显示「未公开」，而不是留空让人以为是遗漏 */}
            {p.incomeHidden && <Item k="年收入" v="未公开" muted />}
            {p.companyHidden && <Item k="公司" v="未公开" muted />}
            {p.incomeRange !== undefined && <Item k="年收入" v={INCOME_LABEL(p.incomeRange)} />}
            {p.company && <Item k="公司" v={p.company} />}
            {p.weightKg !== undefined && <Item k="体重" v={`${p.weightKg} kg`} />}
          </dl>
        </Section>

        {p.expectPartner && (
          <Section title="期待的那个他 / 她">
            <p className="whitespace-pre-wrap text-[14.5px] leading-[1.8] text-ink-2">
              {p.expectPartner}
            </p>
          </Section>
        )}
      </div>

      <RelationActions rel={rel} busy={busy} onLike={() => act("like")} onPass={() => act("pass")} onChat={() => nav("/chat")} />
    </div>
  );
}

/**
 * 他人主页底部操作条。
 *
 * 已经配对/喜欢/跳过的人不能再给一遍按钮：后端是幂等的（不会重复配对），但用户
 * 点下去只看到重复的「配对成功」提示，像是没生效——实测就是这样被发现的。
 */
export function RelationActions({
  rel,
  busy,
  onLike,
  onPass,
  onChat,
}: {
  rel?: { liked: boolean; passed: boolean; matched: boolean };
  busy: boolean;
  onLike: () => void;
  onPass: () => void;
  onChat: () => void;
}) {
  return (
    <div className="fixed inset-x-0 bottom-0 border-t border-line-soft bg-paper/95 px-5 backdrop-blur">
      <div className="mx-auto flex max-w-[520px] items-center gap-3 py-4 pb-safe">
        {rel?.matched ? (
          <>
            <span className="flex-1 text-[14px] text-muted-2">你们已经配对</span>
            <Button size="lg" className="flex-[1.4]" onClick={onChat}>
              去聊天
            </Button>
          </>
        ) : rel?.liked ? (
          <>
            <span className="flex-1 text-[14px] text-muted-2">已喜欢，等 TA 回应</span>
            <Button size="lg" variant="outline" disabled>
              已喜欢
            </Button>
          </>
        ) : rel?.passed ? (
          <>
            <span className="flex-1 text-[14px] text-muted-2">你之前跳过了 TA</span>
            <Button size="lg" variant="outline" disabled>
              已跳过
            </Button>
          </>
        ) : (
          <>
            <Button variant="outline" size="lg" className="flex-1" disabled={busy} onClick={onPass}>
              跳过
            </Button>
            <Button size="lg" className="flex-[1.4]" loading={busy} onClick={onLike}>
              喜欢
            </Button>
          </>
        )}
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mt-7">
      <h2 className="mb-3 text-[16px] font-semibold tracking-tight text-ink">{title}</h2>
      {children}
    </div>
  );
}

function Item({ k, v, muted }: { k: string; v: string; muted?: boolean }) {
  const Icon = fieldIcon(k);
  return (
    <div>
      <dt className="flex items-center gap-1.5 text-[12px] text-muted-2">
        {Icon && <Icon size={13} strokeWidth={2} aria-hidden="true" />}
        {k}
      </dt>
      <dd className={cn("mt-0.5", muted ? "text-muted-2" : "text-ink")}>{v}</dd>
    </div>
  );
}
