import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { adminApi } from "./api";
import { Avatar, Card, ErrorNote, fmt, Loading, Pager, Td, Th, useAsync } from "./ui";

/* ------------------------------------------------------------------ 列表 */

export function AdminConversations() {
  const nav = useNavigate();
  const [q, setQ] = useState("");
  const [kw, setKw] = useState("");
  const [page, setPage] = useState(1);
  const pageSize = 20;

  const { data, error, loading, reload } = useAsync(() => adminApi.conversations({ q: kw, page, pageSize }), [kw, page]);

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
            placeholder="搜任意一方的昵称"
            className="h-9 w-56 rounded-field border border-line bg-surface px-3 text-[13.5px] text-ink outline-none transition-colors placeholder:text-muted-2 focus:border-brand"
          />
          <button type="submit" className="h-9 rounded-field bg-brand px-4 text-[13.5px] font-medium text-white transition-colors hover:bg-brand-dark">
            搜索
          </button>
          {data ? <span className="text-[12.5px] text-muted-2">共 {fmt(data.total)} 个会话</span> : null}
        </form>
      </Card>

      {loading ? (
        <Loading />
      ) : error || !data ? (
        <ErrorNote msg={error ?? "取不到会话"} onRetry={reload} />
      ) : (
        <Card>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-[13px]">
              <thead>
                <tr className="border-b border-line">
                  <Th>会话</Th>
                  <Th right>消息数</Th>
                  <Th>最后一条</Th>
                  <Th>最后活跃</Th>
                  <Th>状态</Th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((c) => (
                  <tr
                    key={c.id}
                    onClick={() => nav(`/admin/conversations/${c.id}`)}
                    className="cursor-pointer border-b border-line-soft last:border-0 hover:bg-paper"
                  >
                    <Td>
                      <span className="flex items-center gap-2">
                        <span className="flex -space-x-2">
                          <Avatar url={c.userA.avatarUrl} name={c.userA.nickname} size={26} />
                          <Avatar url={c.userB.avatarUrl} name={c.userB.nickname} size={26} />
                        </span>
                        <span className="text-ink">
                          {c.userA.nickname} ↔ {c.userB.nickname}
                        </span>
                        <span className="font-mono text-[11.5px] text-muted-2">#{c.id}</span>
                      </span>
                    </Td>
                    <Td right>{c.messageCount}</Td>
                    <Td>{c.lastMessage || <span className="text-muted-2">（还没有人开口）</span>}</Td>
                    <Td>{c.lastMessageAt ?? <span className="text-muted-2">—</span>}</Td>
                    <Td>{CONV_STATUS[c.status] ?? c.status}</Td>
                  </tr>
                ))}
                {data.items.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="py-10 text-center text-[13px] text-muted-2">
                      还没有会话
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

const CONV_STATUS: Record<string, string> = {
  active: "正常",
  frozen: "已冻结（拉黑）",
  readonly: "只读（已解除配对）",
};

/* ------------------------------------------------------------------ 详情 */

export function AdminConversationDetail() {
  const { id } = useParams();
  const cid = Number(id);
  const { data, error, loading, reload } = useAsync(() => adminApi.conversation(cid), [cid]);

  if (loading) return <Loading />;
  if (error || !data) return <ErrorNote msg={error ?? "取不到会话"} onRetry={reload} />;

  const [a, b] = data.users;
  // 左边固定是 id 小的那一方：谁在左谁在右如果随视角变，读起来要一直重新认人
  const leftId = a?.id ?? 0;

  return (
    <div className="space-y-4">
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <span className="flex -space-x-2">
              {data.users.map((u) => (
                <Avatar key={u.id} url={u.avatarUrl} name={u.nickname} size={40} />
              ))}
            </span>
            <div>
              <div className="flex items-center gap-2 text-[16px] font-semibold text-ink">
                <Link to={`/admin/users/${a?.id}`} className="hover:text-brand">
                  {a?.nickname}
                </Link>
                <span className="text-muted-2">↔</span>
                <Link to={`/admin/users/${b?.id}`} className="hover:text-brand">
                  {b?.nickname}
                </Link>
              </div>
              <div className="mt-0.5 text-[12.5px] text-muted">
                会话 <span className="font-mono">#{data.id}</span> · {CONV_STATUS[data.status] ?? data.status} · 共 {fmt(data.messages.length)} 条消息
              </div>
            </div>
          </div>
          <Link
            to="/admin/conversations"
            className="rounded-field border border-line px-3 py-1.5 text-[12.5px] text-muted transition-colors hover:border-brand/40 hover:text-ink"
          >
            返回会话列表
          </Link>
        </div>
      </Card>

      <Card title="聊天记录">
        {data.truncated ? (
          <p className="mb-3 rounded-field bg-gold-soft px-3 py-2 text-[12.5px] text-gold">
            这个会话很长，这里只显示最早的 500 条。
          </p>
        ) : null}
        {data.messages.length === 0 ? (
          <p className="py-10 text-center text-[13px] text-muted-2">配对了但还没有人开口。</p>
        ) : (
          <ul className="space-y-3">
            {data.messages.map((m) => {
              const mine = m.fromUser === leftId;
              const who = data.users.find((u) => u.id === m.fromUser);
              return (
                <li key={m.id} className={mine ? "flex gap-2.5" : "flex flex-row-reverse gap-2.5"}>
                  <Avatar url={who?.avatarUrl} name={who?.nickname ?? "?"} size={28} />
                  <div className={mine ? "max-w-[72%]" : "max-w-[72%] text-right"}>
                    <div className="mb-0.5 text-[11.5px] text-muted-2">
                      {who?.nickname ?? `#${m.fromUser}`} · {m.createdAt}
                    </div>
                    <div
                      className={
                        mine
                          ? "inline-block whitespace-pre-wrap rounded-card rounded-tl-sm bg-paper px-3 py-2 text-left text-[13.5px] leading-relaxed text-ink-2"
                          : "inline-block whitespace-pre-wrap rounded-card rounded-tr-sm bg-brand-soft px-3 py-2 text-left text-[13.5px] leading-relaxed text-brand-dark"
                      }
                    >
                      {m.content || <span className="text-muted-2">（空消息 · {m.msgType}）</span>}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </div>
  );
}
