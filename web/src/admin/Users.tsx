import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { adminApi, type AdminActionRow, type AdminUserDetail } from "./api";
import { Avatar, Card, ErrorNote, fmt, genderText, Kpi, Loading, Pager, StatusBadge, Td, Th, useAsync } from "./ui";
import { cn } from "@/lib/utils";

/* ------------------------------------------------------------------ 列表 */

export function AdminUsers() {
  const nav = useNavigate();
  const [q, setQ] = useState("");
  const [kw, setKw] = useState(""); // 提交后的关键词：输入过程中不该每敲一个字就重查
  const [gender, setGender] = useState(0);
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const pageSize = 20;

  const { data, error, loading, reload } = useAsync(
    () => adminApi.users({ q: kw, gender: gender || undefined, status: status || undefined, page, pageSize }),
    [kw, gender, status, page]
  );

  return (
    <div className="space-y-4">
      <Card>
        <form
          className="flex flex-wrap items-center gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            setPage(1);
            setKw(q.trim());
          }}
        >
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="搜昵称或手机号"
            className="h-9 w-56 rounded-field border border-line bg-surface px-3 text-[13.5px] text-ink outline-none transition-colors placeholder:text-muted-2 focus:border-brand"
          />
          <Select value={gender} onChange={(v) => { setGender(Number(v)); setPage(1); }} options={[["0", "全部性别"], ["2", "女"], ["1", "男"]]} />
          <Select
            value={status}
            onChange={(v) => { setStatus(v); setPage(1); }}
            options={[["", "全部状态"], ["active", "正常"], ["registered", "未完成资料"], ["frozen", "冻结待审"], ["banned", "已封禁"]]}
          />
          <button type="submit" className="h-9 rounded-field bg-brand px-4 text-[13.5px] font-medium text-white transition-colors hover:bg-brand-dark">
            搜索
          </button>
          {data ? <span className="text-[12.5px] text-muted-2">共 {fmt(data.total)} 个账号</span> : null}
        </form>
      </Card>

      {loading ? (
        <Loading />
      ) : error || !data ? (
        <ErrorNote msg={error ?? "取不到用户"} onRetry={reload} />
      ) : (
        <Card>
          <div className="-mx-2 overflow-x-auto">
            <table className="w-full min-w-[900px] text-[13px]">
              <thead>
                <tr className="border-b border-line">
                  <Th>账号</Th>
                  <Th>性别 · 年龄</Th>
                  <Th>城市</Th>
                  <Th right>照片</Th>
                  <Th right>发出喜欢</Th>
                  <Th right>被喜欢</Th>
                  <Th right>配对</Th>
                  <Th right>消息</Th>
                  <Th right>资料</Th>
                  <Th>状态</Th>
                  <Th>注册</Th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((u) => (
                  <tr
                    key={u.id}
                    onClick={() => nav(`/admin/users/${u.id}`)}
                    className="cursor-pointer border-b border-line-soft last:border-0 hover:bg-paper"
                  >
                    <Td>
                      <span className="flex items-center gap-2.5">
                        <Avatar name={u.nickname} size={28} />
                        <span>
                          <span className="text-ink">{u.nickname}</span>
                          {u.isAdmin ? <span className="ml-1.5 rounded-pill bg-gold-soft px-1.5 py-0.5 text-[10.5px] text-gold">管理员</span> : null}
                          <span className="block font-mono text-[11.5px] text-muted-2">
                            #{u.id} · {u.phone}
                          </span>
                        </span>
                      </span>
                    </Td>
                    <Td>{genderText(u.gender)} · {u.age}</Td>
                    <Td>{u.city || "—"}</Td>
                    <Td right>{u.photos}</Td>
                    <Td right>{u.likesSent}</Td>
                    <Td right>{u.likesReceived}</Td>
                    <Td right>{u.matches}</Td>
                    <Td right>{u.messages}</Td>
                    <Td right>{u.completeness}%</Td>
                    <Td><StatusBadge status={u.status} /></Td>
                    <Td>{u.createdAt.slice(0, 10)}</Td>
                  </tr>
                ))}
                {data.items.length === 0 ? (
                  <tr>
                    <td colSpan={11} className="py-10 text-center text-[13px] text-muted-2">
                      没有符合条件的账号
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
          <Pager page={data.page} pageSize={data.pageSize} total={data.total} onChange={setPage} />
        </Card>
      )}
    </div>
  );
}

function Select({ value, onChange, options }: { value: string | number; onChange: (v: string) => void; options: [string, string][] }) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="h-9 rounded-field border border-line bg-surface px-2.5 text-[13.5px] text-ink outline-none transition-colors focus:border-brand"
    >
      {options.map(([v, label]) => (
        <option key={v} value={v}>
          {label}
        </option>
      ))}
    </select>
  );
}

/* ------------------------------------------------------------------ 详情 */

export function AdminUserDetail() {
  const { id } = useParams();
  const uid = Number(id);
  const { data, error, loading, reload } = useAsync(() => adminApi.user(uid), [uid]);

  if (loading) return <Loading />;
  if (error || !data) return <ErrorNote msg={error ?? "取不到这个人"} onRetry={reload} />;

  return <UserDetailBody d={data} />;
}

function UserDetailBody({ d }: { d: AdminUserDetail }) {
  const [direction, setDirection] = useState<"sent" | "received">("sent");
  const u = d.user;

  return (
    <div className="space-y-4">
      <Card>
        <div className="flex flex-wrap items-start gap-5">
          <Avatar url={d.avatarUrl} name={u.nickname} size={64} />
          <div className="min-w-[220px] flex-1">
            <div className="flex items-center gap-2">
              <h2 className="text-[20px] font-semibold text-ink">{u.nickname}</h2>
              <StatusBadge status={u.status} />
              {u.isAdmin ? <span className="rounded-pill bg-gold-soft px-2 py-0.5 text-[11px] text-gold">管理员</span> : null}
              {!u.onboarded ? <span className="rounded-pill bg-line-soft px-2 py-0.5 text-[11px] text-muted">未完成资料</span> : null}
            </div>
            <div className="mt-1.5 grid gap-x-6 gap-y-1 text-[13px] text-muted sm:grid-cols-2">
              <span>账号 ID <span className="font-mono text-ink-2">#{u.id}</span></span>
              <span>手机号 <span className="font-mono text-ink-2">{u.phone}</span></span>
              <span>{genderText(u.gender)} · {u.age} 岁</span>
              <span>注册 {u.createdAt}</span>
              <span>最后登录 {u.lastLoginAt ?? "从未"}</span>
              <span>注册 IP <span className="font-mono text-ink-2">{u.registerIp ?? "—"}</span></span>
              <span className="truncate">设备 <span className="font-mono text-[12px] text-ink-2">{u.deviceId ?? "—"}</span></span>
              {d.quotaToday ? <span>今日额度 {d.quotaToday.used} / {d.quotaToday.limit}</span> : null}
            </div>
          </div>
        </div>
      </Card>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="发出的喜欢 / 跳过" value={`${d.counts.likesSent} / ${d.counts.passesSent}`} sub={`看过主页 ${d.counts.visitsSent} 次`} />
        <Kpi label="被喜欢 / 被看过" value={`${d.counts.likesReceived} / ${d.counts.visitsReceived}`} sub={`被别人跳过 ${d.counts.passesReceived} 次`} tone="brand" />
        <Kpi label="配对（进行中）" value={`${d.counts.matches}（${d.counts.activeMatches}）`} sub={`会话 ${d.conversations} 个`} tone="gold" />
        <Kpi label="发出 / 收到消息" value={`${d.counts.messagesSent} / ${d.counts.messagesReceived}`} sub={`拉黑 ${d.counts.blocks} · 被举报 ${d.counts.reportedByOthers}`} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="资料">
          {d.profile ? (
            <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-[13px]">
              {PROFILE_FIELDS.map(([key, label, fmtFn]) => (
                <div key={key} className="flex justify-between gap-3 border-b border-line-soft pb-1.5">
                  <span className="text-muted-2">{label}</span>
                  <span className="text-right text-ink">{fmtFn ? fmtFn(d.profile![key]) : str(d.profile![key])}</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-[13px] text-muted-2">还没填本人画像。</p>
          )}
        </Card>

        <div className="space-y-4">
          <Card title="照片">
            {d.photos.length ? (
              <div className="flex flex-wrap gap-2">
                {d.photos.map((p, i) => (
                  <div key={p.id} className="relative">
                    <img src={p.url} alt="" className="h-20 w-20 rounded-field object-cover" />
                    <span className="absolute left-1 top-1 rounded bg-ink/60 px-1 text-[10px] text-white">
                      {i === 0 ? "封面" : i + 1}
                    </span>
                    {p.auditStatus !== "approved" ? (
                      <span className="absolute bottom-1 left-1 rounded bg-gold px-1 text-[10px] text-white">{p.auditStatus}</span>
                    ) : null}
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-[13px] text-muted-2">没有照片。</p>
            )}
          </Card>

          <Card title="兴趣">
            {d.hobbies.length ? (
              <ul className="space-y-2">
                {d.hobbies.map((h) => (
                  <li key={h.name} className="text-[13px]">
                    <span className="font-medium text-ink">{h.name}</span>
                    <span className="ml-2 text-muted">{h.description}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-[13px] text-muted-2">没有填兴趣。</p>
            )}
          </Card>
        </div>
      </div>

      <Card title="自述">
        <Text label="关于我" value={d.texts?.aboutMe} />
        <Text label="期待的那个他/她" value={d.texts?.expectPartner} />
      </Card>

      <Card title="伴侣偏好">
        {Object.keys(d.preference).length ? (
          <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-[13px] lg:grid-cols-3">
            {Object.entries(d.preference)
              .filter(([k]) => k !== "user_id" && k !== "updated_at")
              .map(([k, v]) => (
                <div key={k} className="flex justify-between gap-3 border-b border-line-soft pb-1.5">
                  <span className="text-muted-2">{k}</span>
                  <span className="text-right text-ink">{str(v)}</span>
                </div>
              ))}
          </div>
        ) : (
          <p className="text-[13px] text-muted-2">没有填伴侣偏好。</p>
        )}
      </Card>

      <Card
        title="划卡记录"
        extra={
          <div className="flex gap-1 rounded-pill bg-line-soft p-0.5">
            {(["sent", "received"] as const).map((dir) => (
              <button
                key={dir}
                type="button"
                onClick={() => setDirection(dir)}
                className={cn(
                  "rounded-pill px-3 py-1 text-[12.5px] transition-colors",
                  direction === dir ? "bg-surface font-medium text-brand shadow-card" : "text-muted hover:text-ink"
                )}
              >
                {dir === "sent" ? "TA 划别人" : "别人划 TA"}
              </button>
            ))}
          </div>
        }
      >
        <ActionsTable userId={u.id} direction={direction} />
      </Card>

      <UserConversations userId={u.id} />
    </div>
  );
}

const PROFILE_FIELDS: [string, string, ((v: unknown) => string)?][] = [
  ["heightCm", "身高", (v) => (v ? `${v} cm` : "—")],
  ["weightKg", "体重", (v) => (v ? `${v} kg` : "—")],
  ["hometownProv", "家乡省", undefined],
  ["hometownCity", "家乡市", undefined],
  ["cityProv", "现居省", undefined],
  ["cityCity", "现居市", undefined],
  ["cityDistrict", "区县", undefined],
  ["occupation", "职业", undefined],
  ["mbti", "MBTI", undefined],
  ["education", "学历", (v) => EDU[v as number] ?? "—"],
  ["incomeRange", "年收入", (v) => INC[v as number] ?? "—"],
  ["smoking", "抽烟", (v) => SMOKE[v as number] ?? "—"],
  ["drinking", "喝酒", (v) => SMOKE[v as number] ?? "—"],
  ["school", "学校", undefined],
  ["company", "公司", undefined],
  ["isOnlyChild", "独生", (v) => (v === null ? "—" : v ? "是" : "否")],
  ["eldercarePressure", "养老压力", (v) => (v === 1 ? "有" : v === 2 ? "无" : "—")],
  ["hasCar", "有车", (v) => (v === null ? "—" : v ? "是" : "否")],
  ["hasHouse", "有房", (v) => HOUSE[v as number] ?? "—"],
  ["isDink", "丁克", (v) => (v === 1 ? "是" : v === 2 ? "否" : "—")],
  ["completeness", "完整度", (v) => `${v}%`],
];

const EDU: Record<number, string> = { 1: "高中及以下", 2: "大专", 3: "本科", 4: "硕士", 5: "博士" };
const INC: Record<number, string> = { 1: "10 万以下", 2: "10–20 万", 3: "20–30 万", 4: "30–50 万", 5: "50–100 万", 6: "100 万以上" };
const SMOKE: Record<number, string> = { 1: "不", 2: "偶尔", 3: "经常" };
const HOUSE: Record<number, string> = { 1: "无", 2: "有", 3: "有贷款" };

function str(v: unknown): string {
  if (v === null || v === undefined || v === "") return "—";
  if (typeof v === "boolean") return v ? "是" : "否";
  if (Array.isArray(v)) return v.length ? v.join("、") : "—";
  return String(v);
}

function Text({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div className="mb-4 last:mb-0">
      <div className="mb-1 text-[12px] text-muted-2">{label}</div>
      <p className="whitespace-pre-wrap text-[13.5px] leading-relaxed text-ink-2">{value || "—"}</p>
    </div>
  );
}

/* ------------------------------------------------- 详情里的两块子表 */

function ActionsTable({ userId, direction }: { userId: number; direction: "sent" | "received" }) {
  const [action, setAction] = useState("");
  const [page, setPage] = useState(1);
  const pageSize = 20;

  const { data, error, loading, reload } = useAsync(
    () => adminApi.actions(userId, { direction, action: action || undefined, page, pageSize }),
    [userId, direction, action, page]
  );

  // 换方向/换类型要回到第一页，否则会停在一个对方没有的页码上
  const reset = (fn: () => void) => {
    fn();
    setPage(1);
  };

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        {[
          ["", "全部"],
          ["like", "喜欢"],
          ["pass", "跳过"],
          ["visit", "看过"],
        ].map(([v, label]) => (
          <button
            key={v}
            type="button"
            onClick={() => reset(() => setAction(v))}
            className={cn(
              "rounded-pill border px-3 py-1 text-[12.5px] transition-colors",
              action === v ? "border-brand bg-brand-soft font-medium text-brand-dark" : "border-line text-muted hover:border-brand/40"
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {loading ? (
        <Loading />
      ) : error || !data ? (
        <ErrorNote msg={error ?? "取不到记录"} onRetry={reload} />
      ) : data.items.length === 0 ? (
        <p className="py-8 text-center text-[13px] text-muted-2">
          {direction === "sent" ? "TA 还没划过任何人" : "还没有人划过 TA"}
        </p>
      ) : (
        <>
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-b border-line">
                <Th>动作</Th>
                <Th>{direction === "sent" ? "被划的人" : "发起的人"}</Th>
                <Th>来源</Th>
                <Th>时间</Th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((a) => (
                <tr key={a.id} className="border-b border-line-soft last:border-0">
                  <Td>
                    <ActionTag action={a.action} />
                  </Td>
                  <Td>
                    <Link to={`/admin/users/${a.peerId}`} className="flex items-center gap-2 hover:text-brand">
                      <Avatar url={a.peerAvatar} name={a.peerNickname} size={26} />
                      <span>
                        {a.peerNickname}
                        <span className="ml-1 font-mono text-[11px] text-muted-2">#{a.peerId}</span>
                      </span>
                    </Link>
                  </Td>
                  <Td>{SOURCE[a.source] ?? a.source}</Td>
                  <Td>{a.createdAt}</Td>
                </tr>
              ))}
            </tbody>
          </table>
          <Pager page={data.page} pageSize={data.pageSize} total={data.total} onChange={setPage} />
        </>
      )}
    </div>
  );
}

export function ActionTag({ action }: { action: AdminActionRow["action"] }) {
  const map = {
    like: { text: "喜欢", cls: "border-brand/30 bg-brand-soft text-brand-dark" },
    pass: { text: "跳过", cls: "border-line bg-line-soft text-muted" },
    visit: { text: "看过", cls: "border-gold-line bg-gold-soft text-gold" },
  } as const;
  const m = map[action] ?? { text: action, cls: "border-line bg-line-soft text-muted" };
  return <span className={cn("rounded-pill border px-2 py-0.5 text-[11.5px]", m.cls)}>{m.text}</span>;
}

const SOURCE: Record<string, string> = { card: "推荐卡", plaza: "恋爱广场", likes_me: "心动列表" };

/** 用户详情里的会话列表——"他们的聊天记录"从这儿进 */
function UserConversations({ userId }: { userId: number }) {
  const [page, setPage] = useState(1);
  const { data, error, loading, reload } = useAsync(() => adminApi.conversations({ userId, page, pageSize: 10 }), [userId, page]);

  return (
    <Card title="会话">
      {loading ? (
        <Loading />
      ) : error || !data ? (
        <ErrorNote msg={error ?? "取不到会话"} onRetry={reload} />
      ) : data.items.length === 0 ? (
        <p className="py-8 text-center text-[13px] text-muted-2">还没有配对产生的会话</p>
      ) : (
        <>
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-b border-line">
                <Th>会话</Th>
                <Th right>消息数</Th>
                <Th>最后一条</Th>
                <Th>最后活跃</Th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((c) => (
                <tr key={c.id} className="border-b border-line-soft last:border-0">
                  <Td>
                    <Link to={`/admin/conversations/${c.id}`} className="hover:text-brand">
                      #{c.id} {c.userA.nickname} ↔ {c.userB.nickname}
                    </Link>
                  </Td>
                  <Td right>{c.messageCount}</Td>
                  <Td>{c.lastMessage || "—"}</Td>
                  <Td>{c.lastMessageAt ?? "—"}</Td>
                </tr>
              ))}
            </tbody>
          </table>
          <Pager page={data.page} pageSize={data.pageSize} total={data.total} onChange={setPage} />
        </>
      )}
    </Card>
  );
}

