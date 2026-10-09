import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, MessageCircle, Send } from "lucide-react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Empty, ListSkeleton } from "@/components/ui/empty";
import { useToast } from "@/components/ui/toast";
import { api, ApiError, tokenStore, type Conversation, type Message } from "@/lib/api";
import { useAuth } from "@/store/auth";
import { cn } from "@/lib/utils";

const API_BASE = import.meta.env.VITE_API_BASE ?? "/api/v1";

// ============================ 会话列表 ============================

export function ChatList() {
  const nav = useNavigate();
  const [list, setList] = useState<Conversation[] | null>(null);

  useEffect(() => {
    api
      .get<{ items: Conversation[] }>("/conversations")
      .then((r) => setList(r.items ?? []))
      .catch((e) => {
        if (e instanceof ApiError && e.code === "ONBOARDING_REQUIRED") {
          nav("/onboarding", { replace: true });
          return;
        }
        setList([]);
      });
  }, [nav]);

  return (
    <div className="min-h-screen bg-paper">
      <header className="sticky top-0 z-10 border-b border-line-soft bg-paper/95 px-5 py-3 backdrop-blur">
        <span className="text-[17px] font-bold text-ink">消息</span>
      </header>

      <main className="mx-auto max-w-[520px]">
        {list === null ? (
          <ListSkeleton rows={5} />
        ) : list.length === 0 ? (
          <Empty
            icon={MessageCircle}
            title="还没有聊天"
            desc="互相喜欢之后就会自动建立会话，来打个招呼吧。"
            action={<Button variant="outline" onClick={() => nav("/")}>去划卡</Button>}
          />
        ) : (
          <div className="divide-y divide-line-soft">
            {list.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => nav(`/chat/${c.id}`)}
                className="flex w-full items-center gap-3 px-5 py-3.5 text-left transition-colors hover:bg-surface"
              >
                <div className="relative h-12 w-12 shrink-0 overflow-hidden rounded-full bg-line-soft">
                  {c.peerAvatar ? (
                    <img loading="lazy" decoding="async" src={c.peerAvatar} alt="" className="h-full w-full object-cover" />
                  ) : (
                    <span className="flex h-full items-center justify-center text-[16px] font-bold text-muted-2">
                      {c.peerNickname.slice(0, 1)}
                    </span>
                  )}
                  {c.unread > 0 && (
                    <span className="absolute -right-0.5 -top-0.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-brand px-1 text-[10px] font-bold text-white">
                      {c.unread > 99 ? "99+" : c.unread}
                    </span>
                  )}
                </div>

                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="truncate text-[14.5px] font-medium text-ink">
                      {c.peerNickname}
                    </span>
                    <span className="shrink-0 text-[11px] text-muted-2">
                      {fmtTime(c.lastMessageAt)}
                    </span>
                  </div>
                  <p className={cn("truncate text-[13px]", c.unread > 0 ? "text-ink" : "text-muted-2")}>
                    {c.status === "readonly"
                      ? "已解除配对"
                      : c.lastMessage || "配对成功，等着你先开口"}
                  </p>
                </div>
              </button>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}

// ============================ 聊天室 ============================

export function ChatRoom() {
  const { id } = useParams();
  const nav = useNavigate();
  const toast = useToast();
  const { userId: myId } = useAuth();
  const convId = Number(id);

  const [msgs, setMsgs] = useState<Message[] | null>(null);
  const [peer, setPeer] = useState<{ userId: number; nickname: string; avatarUrl: string } | null>(null);
  const [myAvatar, setMyAvatar] = useState("");
  const [text, setText] = useState("");
  const [frozen, setFrozen] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const wsRef = useRef<WebSocket | null>(null);

  const scrollToBottom = useCallback((smooth = true) => {
    requestAnimationFrame(() => {
      bottomRef.current?.scrollIntoView({ behavior: smooth ? "smooth" : "auto" });
    });
  }, []);

  const load = useCallback(async () => {
    try {
      const r = await api.get<{
        items: Message[];
        peer: { userId: number; nickname: string; avatarUrl: string };
      }>(`/conversations/${convId}/messages`);
      setMsgs(r.items ?? []);
      setPeer(r.peer ?? null);
      await api.post(`/conversations/${convId}/read`);
      scrollToBottom(false);
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "加载失败", "error");
      setMsgs([]);
    }
  }, [convId, toast, scrollToBottom]);

  useEffect(() => {
    void load();
    // 自己的头像：消息行要展示「谁发的」，左侧对方、右侧自己
    api
      .get<{ avatarUrl: string }>("/users/me")
      .then((p) => setMyAvatar(p.avatarUrl))
      .catch(() => {});
  }, [load]);

  // WebSocket：在线时对方的消息即时到达
  useEffect(() => {
    const token = tokenStore.access;
    if (!token) return;

    const url = `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}${API_BASE}/ws?token=${encodeURIComponent(token)}`;
    let ws: WebSocket | null = null;
    let retry = 0;
    let timer: number | undefined;
    let closed = false;

    const connect = () => {
      if (closed) return;
      try {
        ws = new WebSocket(url);
      } catch {
        return;
      }
      wsRef.current = ws;

      ws.onopen = () => {
        retry = 0;
      };
      ws.onmessage = (ev) => {
        try {
          const env = JSON.parse(ev.data);
          if (env.type === "message" && env.data?.conversationId === convId) {
            const m = env.data.message as Message;
            setMsgs((prev) => {
              if (!prev) return [m];
              // 幂等：同 id 或同 clientMsgId 不重复插入
              if (prev.some((x) => x.id === m.id)) return prev;
              if (m.clientMsgId && prev.some((x) => x.clientMsgId === m.clientMsgId)) return prev;
              return [...prev, m];
            });
            scrollToBottom();
            void api.post(`/conversations/${convId}/read`).catch(() => {});
          }
        } catch {
          /* 非 JSON 消息忽略 */
        }
      };
      ws.onclose = () => {
        // 指数退避重连，封顶 15 秒
        if (closed) return;
        retry += 1;
        timer = window.setTimeout(connect, Math.min(1000 * 2 ** retry, 15000));
      };
      ws.onerror = () => ws?.close();
    };

    connect();
    return () => {
      closed = true;
      if (timer) window.clearTimeout(timer);
      ws?.close();
    };
  }, [convId, scrollToBottom]);

  async function send() {
    const content = text.trim();
    if (!content) return;

    // 乐观上屏：本地先显示，带「发送中」态。失败再标红。
    const clientMsgId = `c-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const optimistic: Message = {
      id: -Date.now(),
      fromUser: myId ?? -1,
      msgType: "text",
      content,
      seq: Number.MAX_SAFE_INTEGER,
      status: "sending",
      createdAt: new Date().toISOString(),
      clientMsgId,
    };
    setMsgs((prev) => [...(prev ?? []), optimistic]);
    setText("");
    scrollToBottom();

    try {
      const saved = await api.post<Message>(`/conversations/${convId}/messages`, {
        msgType: "text",
        content,
        clientMsgId,
      });
      setMsgs((prev) =>
        (prev ?? []).map((m) => (m.clientMsgId === clientMsgId ? saved : m))
      );
    } catch (e) {
      setMsgs((prev) =>
        (prev ?? []).map((m) =>
          m.clientMsgId === clientMsgId ? { ...m, status: "failed" } : m
        )
      );
      toast(e instanceof ApiError ? e.message : "发送失败", "error");
      if (e instanceof ApiError && e.code === "CONVERSATION_CLOSED") setFrozen(true);
    }
  }

  return (
    <div className="flex h-screen flex-col bg-paper">
      <header className="flex shrink-0 items-center gap-3 border-b border-line-soft bg-paper/95 px-4 py-3 backdrop-blur">
        <button type="button" onClick={() => nav("/chat")} className="text-muted-2" aria-label="返回">
          <ArrowLeft size={22} strokeWidth={1.9} aria-hidden="true" />
        </button>
        <button
          type="button"
          onClick={() => peer && nav(`/u/${peer.userId}`)}
          disabled={!peer}
          className="flex min-w-0 flex-1 items-center gap-2.5 text-left disabled:cursor-default"
        >
          {peer?.avatarUrl ? (
            <img
              src={peer.avatarUrl}
              alt=""
              decoding="async"
              className="h-9 w-9 shrink-0 rounded-full object-cover"
            />
          ) : (
            <span className="h-9 w-9 shrink-0 rounded-full bg-line-soft" aria-hidden="true" />
          )}
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[15px] font-semibold text-ink">
              {peer?.nickname ?? "聊天"}
            </span>
            <span className="block text-[11.5px] text-muted-2">
              {frozen ? "会话已关闭" : "点这里看 TA 的资料"}
            </span>
          </span>
        </button>
      </header>

      <main className="mx-auto w-full max-w-[520px] flex-1 overflow-y-auto overscroll-contain px-4 py-4">
        {msgs === null ? (
          <ListSkeleton rows={4} />
        ) : (
          <>
            <p className="mb-4 text-center text-[11.5px] text-muted-2">
              你们互相喜欢之后开始了这段对话
            </p>
            {msgs.map((m, i) => (
              <MessageRow
                key={`${m.id}-${m.clientMsgId ?? ""}`}
                message={m}
                mine={m.fromUser === myId || m.fromUser === -1}
                myAvatar={myAvatar}
                peerAvatar={peer?.avatarUrl ?? ""}
                // 同一个人连着发的，只在第一条显示头像——每条都画会糊成一片
                showAvatar={i === 0 || msgs[i - 1].fromUser !== m.fromUser}
              />
            ))}
            <div ref={bottomRef} />
          </>
        )}
      </main>

      <footer className="shrink-0 border-t border-line-soft bg-paper/95 px-4 py-3 backdrop-blur">
        <div className="mx-auto flex max-w-[520px] items-center gap-2 pb-safe">
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void send();
              }
            }}
            disabled={frozen}
            maxLength={1000}
            placeholder={frozen ? "会话已关闭" : "说点什么…"}
            className="flex-1 rounded-full border border-line bg-surface px-4 py-2.5 text-[14px] text-ink placeholder:text-muted-2 focus:border-brand/50 focus:outline-none disabled:opacity-60"
          />
          <button
            type="button"
            onClick={send}
            disabled={!text.trim() || frozen}
            aria-label="发送"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[#EF7183] to-[#D8445C] text-white transition-transform active:scale-95 disabled:opacity-40"
          >
            <Send size={17} strokeWidth={2} aria-hidden="true" />
          </button>
        </div>
      </footer>
    </div>
  );
}

/**
 * 一条消息。
 *
 * 头像不是可有可无的装饰：只靠气泡左右分色，用户扫下来还是要在脑子里过一遍
 * 「这条是谁发的」。左右各挂一张脸之后一眼就能分清（和主流 IM 一致）。
 * 同一人连续发言时只在第一条画头像，其余留出等宽占位，纵向对齐不跳动。
 */
export function MessageRow({
  message,
  mine,
  myAvatar,
  peerAvatar,
  showAvatar,
}: {
  message: Message;
  mine: boolean;
  myAvatar: string;
  peerAvatar: string;
  showAvatar: boolean;
}) {
  const avatar = mine ? myAvatar : peerAvatar;
  return (
    <div className={cn("mb-2 flex items-end gap-2", mine && "flex-row-reverse")}>
      {showAvatar ? (
        avatar ? (
          <img
            src={avatar}
            alt=""
            decoding="async"
            className="h-8 w-8 shrink-0 rounded-full object-cover"
          />
        ) : (
          <span className="h-8 w-8 shrink-0 rounded-full bg-line-soft" aria-hidden="true" />
        )
      ) : (
        <span className="h-8 w-8 shrink-0" aria-hidden="true" />
      )}
      <div
        className={cn(
          "max-w-[76%] break-words rounded-2xl px-3.5 py-2.5 text-[14px] leading-relaxed",
          mine
            ? "rounded-br-[5px] bg-gradient-to-br from-[#EF7183] to-[#D8445C] text-white"
            : "rounded-bl-[5px] border border-line-soft bg-surface text-ink",
          message.status === "failed" && "opacity-60"
        )}
      >
        {message.content}
        {message.status === "sending" && <span className="ml-2 text-[11px] opacity-60">发送中</span>}
        {message.status === "failed" && <span className="ml-2 text-[11px] opacity-80">发送失败</span>}
      </div>
    </div>
  );
}

// ============================ 工具 ============================

function fmtTime(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) {
    return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  }
  const diffDay = Math.floor((now.getTime() - d.getTime()) / 86400000);
  if (diffDay === 1) return "昨天";
  if (diffDay < 7) return `${diffDay} 天前`;
  return `${d.getMonth() + 1}月${d.getDate()}日`;
}

/** 从配对成功跳进来时带上 peerId，这里做个转发到对应会话 */
export function ChatEntry() {
  const loc = useLocation();
  const nav = useNavigate();
  const peerId = (loc.state as { peerId?: number } | null)?.peerId;

  useEffect(() => {
    if (!peerId) {
      nav("/chat", { replace: true });
      return;
    }
    api
      .get<{ items: Conversation[] }>("/conversations")
      .then((r) => {
        const hit = (r.items ?? []).find((c) => c.peerId === peerId);
        nav(hit ? `/chat/${hit.id}` : "/chat", { replace: true });
      })
      .catch(() => nav("/chat", { replace: true }));
  }, [peerId, nav]);

  return <div className="min-h-screen bg-paper" />;
}
