import { useCallback, useEffect, useRef, useState } from "react";
import {
  FlatList,
  KeyboardAvoidingView,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Image } from "expo-image";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { API_BASE, ORIGIN, api, mediaImage, tokens } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { Skeleton, useToast } from "@/ui/feedback";
import { colors, font, radius, shadow, space } from "@/theme";
import type { Message } from "@/lib/types";

/**
 * 聊天室。
 *
 * 三个决定：
 *   1. **列表倒置**（inverted）：新消息天生在底部，键盘弹起、来新消息都不用
 *      手动滚动——这是聊天界面唯一稳定的做法；
 *   2. **消息行带头像**：只靠气泡左右分色，用户扫下来还要在脑子里过一遍
 *      "这条谁发的"；同一个人连着发的只在第一条画头像；
 *   3. **发送要原子取走输入内容**：`setText("")` 是异步的，连按两次发送
 *      第二次读到的还是旧值，同一条消息会发两遍（Web 版踩过这个坑）。
 */
export default function ChatRoom() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const convId = Number(id);
  const nav = useRouter();
  const insets = useSafeAreaInsets();
  const toast = useToast();
  const { userId: myId } = useAuth();

  const [msgs, setMsgs] = useState<Message[] | null>(null);
  const [peer, setPeer] = useState<{ userId: number; nickname: string; avatarUrl: string } | null>(null);
  const [myAvatar, setMyAvatar] = useState("");
  const [text, setText] = useState("");
  const [frozen, setFrozen] = useState(false);
  const textRef = useRef("");
  const [sending, setSending] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await api.get<{
        items: Message[];
        peer: { userId: number; nickname: string; avatarUrl: string };
      }>(`/conversations/${convId}/messages`);
      setMsgs(r.items ?? []);
      setPeer(r.peer ?? null);
      await api.post(`/conversations/${convId}/read`);
    } catch (e) {
      toast(e instanceof Error ? e.message : "加载失败", "error");
      setMsgs([]);
    }
  }, [convId, toast]);

  useEffect(() => {
    void load();
    api
      .get<{ avatarUrl: string }>("/users/me")
      .then((p) => setMyAvatar(p.avatarUrl))
      .catch(() => {});
  }, [load]);

  // 实时：收到正在看的这条会话的新消息就插进列表
  useEffect(() => {
    const token = tokens.access;
    if (!token) return;
    const wsBase = ORIGIN.replace(/^http/, "ws") + API_BASE.replace(ORIGIN, "") + "/ws";
    let ws: WebSocket | null = null;
    let closed = false;
    let retry = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const connect = () => {
      if (closed) return;
      ws = new WebSocket(`${wsBase}?token=${encodeURIComponent(token)}`);
      ws.onopen = () => (retry = 0);
      ws.onmessage = (ev) => {
        try {
          const env = JSON.parse(String(ev.data));
          if (env.type === "message" && env.data?.conversationId === convId) {
            const m = env.data.message as Message;
            setMsgs((prev) => {
              const list = prev ?? [];
              if (list.some((x) => x.id === m.id)) return list;
              if (m.clientMsgId && list.some((x) => x.clientMsgId === m.clientMsgId)) return list;
              return [m, ...list];
            });
            void api.post(`/conversations/${convId}/read`).catch(() => {});
          }
        } catch {
          /* 非 JSON 忽略 */
        }
      };
      ws.onclose = () => {
        if (closed) return;
        retry += 1;
        timer = setTimeout(connect, Math.min(1000 * 2 ** retry, 15000));
      };
      ws.onerror = () => ws?.close();
    };
    connect();
    return () => {
      closed = true;
      if (timer) clearTimeout(timer);
      ws?.close();
    };
  }, [convId]);

  /**
   * 原子取走输入框内容：取过一次就为空。
   * 连按两次发送时第二次拿到空串、直接返回，不会把同一条消息发两遍。
   */
  function takeText(): string {
    const v = textRef.current.trim();
    textRef.current = "";
    setText("");
    return v;
  }

  async function send() {
    const content = takeText();
    if (!content || sending || frozen) return;
    setSending(true);

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
    setMsgs((prev) => [optimistic, ...(prev ?? [])]);

    try {
      const saved = await api.post<Message>(`/conversations/${convId}/messages`, {
        msgType: "text",
        content,
        clientMsgId,
      });
      setMsgs((prev) => (prev ?? []).map((m) => (m.clientMsgId === clientMsgId ? saved : m)));
    } catch (e) {
      setMsgs((prev) => (prev ?? []).map((m) => (m.clientMsgId === clientMsgId ? { ...m, status: "failed" } : m)));
      const msg = e instanceof Error ? e.message : "发送失败";
      if (msg.includes("关闭")) setFrozen(true);
      toast(msg, "error");
    } finally {
      setSending(false);
    }
  }

  const peerImg = mediaImage(peer?.avatarUrl ?? "");
  const myImg = mediaImage(myAvatar);

  return (
    <KeyboardAvoidingView style={styles.root} behavior="padding" keyboardVerticalOffset={0}>
      {/* behavior 两端都用 padding，原因同 login.tsx：Android 的 edge-to-edge 让
          adjustResize 失效，传 undefined 时输入条会被键盘盖住。 */}
      {/* 标题：对方头像 + 昵称，点进 TA 的主页 */}
      <View style={[styles.header, { paddingTop: insets.top + space(2) }]}>
        <Pressable onPress={() => nav.back()} hitSlop={10} accessibilityLabel="返回" style={styles.back}>
          <Ionicons name="chevron-back" size={24} color={colors.ink} />
        </Pressable>
        <Pressable
          style={styles.peer}
          disabled={!peer}
          onPress={() => peer && nav.push(`/user/${peer.userId}`)}
        >
          {peerImg ? (
            <Image source={peerImg} style={styles.peerAvatar} contentFit="cover" transition={160} />
          ) : (
            <View style={styles.peerAvatar} />
          )}
          <View style={{ flex: 1 }}>
            <Text style={styles.peerName} numberOfLines={1}>
              {peer?.nickname ?? "聊天"}
            </Text>
            <Text style={styles.peerHint}>{frozen ? "会话已关闭" : "点这里看 TA 的资料"}</Text>
          </View>
        </Pressable>
      </View>

      {msgs === null ? (
        <View style={{ padding: space(5), gap: space(3) }}>
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} height={44} />
          ))}
        </View>
      ) : (
        <FlatList
          data={msgs}
          inverted
          keyExtractor={(m) => `${m.id}-${m.clientMsgId ?? ""}`}
          contentContainerStyle={{ paddingHorizontal: space(4), paddingVertical: space(4) }}
          renderItem={({ item, index }) => {
            const mine = item.fromUser === myId || item.fromUser === -1;
            const next = msgs[index + 1]; // 倒置列表里"下一条"是更早的那条
            const showAvatar = !next || next.fromUser !== item.fromUser;
            return (
              <MessageRow
                message={item}
                mine={mine}
                myAvatar={myImg}
                peerAvatar={peerImg}
                showAvatar={showAvatar}
              />
            );
          }}
        />
      )}

      {/* 输入区 */}
      <View style={[styles.inputBar, { paddingBottom: Math.max(insets.bottom, space(2.5)) }]}>
        <TextInput
          value={text}
          onChangeText={(v) => {
            textRef.current = v;
            setText(v);
          }}
          editable={!frozen}
          multiline
          maxLength={1000}
          placeholder={frozen ? "会话已关闭" : "说点什么…"}
          placeholderTextColor={colors.muted2}
          selectionColor={colors.brand}
          style={styles.input}
        />
        <Pressable
          onPress={() => void send()}
          disabled={!text.trim() || frozen || sending}
          accessibilityLabel="发送"
          style={({ pressed }) => [styles.send, pressed && styles.sendPressed, (!text.trim() || frozen) && styles.sendOff]}
        >
          <Ionicons name="arrow-up" size={19} color={colors.white} />
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

/** 一条消息：左侧对方、右侧自己，各挂头像；连续发言只在第一条画 */
function MessageRow({
  message,
  mine,
  myAvatar,
  peerAvatar,
  showAvatar,
}: {
  message: Message;
  mine: boolean;
  myAvatar: ReturnType<typeof mediaImage>;
  peerAvatar: ReturnType<typeof mediaImage>;
  showAvatar: boolean;
}) {
  const avatar = mine ? myAvatar : peerAvatar;
  return (
    <View style={[styles.row, mine && styles.rowMine]}>
      {showAvatar ? (
        avatar ? (
          <Image source={avatar} style={styles.msgAvatar} contentFit="cover" transition={140} />
        ) : (
          <View style={styles.msgAvatar} />
        )
      ) : (
        <View style={styles.msgAvatarSpacer} />
      )}
      <View style={[styles.bubble, mine ? styles.bubbleMine : styles.bubblePeer, message.status === "failed" && styles.bubbleFailed]}>
        <Text style={mine ? styles.bubbleTextMine : styles.bubbleTextPeer}>{message.content}</Text>
        {message.status === "sending" ? <Text style={[styles.state, mine && styles.stateMine]}>发送中</Text> : null}
        {message.status === "failed" ? <Text style={styles.stateFail}>发送失败</Text> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.paper },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: space(2),
    paddingHorizontal: space(3),
    paddingBottom: space(3),
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.line,
    backgroundColor: colors.surface,
  },
  back: { padding: space(1) },
  peer: { flex: 1, flexDirection: "row", alignItems: "center", gap: space(2.5) },
  peerAvatar: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.lineSoft },
  peerName: { fontSize: font.body, fontWeight: "600", color: colors.ink },
  peerHint: { fontSize: 11.5, color: colors.muted2 },
  row: { flexDirection: "row", alignItems: "flex-end", gap: space(2), marginBottom: space(2) },
  rowMine: { flexDirection: "row-reverse" },
  msgAvatar: { width: 32, height: 32, borderRadius: 16, backgroundColor: colors.lineSoft },
  msgAvatarSpacer: { width: 32, height: 32 },
  bubble: { maxWidth: "76%", borderRadius: 18, paddingHorizontal: space(3.5), paddingVertical: space(2.5) },
  bubbleMine: { backgroundColor: colors.brand, borderBottomRightRadius: 5, ...shadow.brand },
  bubblePeer: { backgroundColor: colors.surface, borderBottomLeftRadius: 5, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.line },
  bubbleFailed: { opacity: 0.6 },
  bubbleTextMine: { color: colors.white, fontSize: font.body, lineHeight: 21 },
  bubbleTextPeer: { color: colors.ink, fontSize: font.body, lineHeight: 21 },
  state: { marginTop: 2, fontSize: 10.5, color: colors.muted2 },
  stateMine: { color: "rgba(255,255,255,.65)" },
  stateFail: { marginTop: 2, fontSize: 10.5, color: colors.brand },
  inputBar: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: space(2),
    paddingHorizontal: space(4),
    paddingTop: space(2.5),
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.line,
    backgroundColor: colors.surface,
  },
  input: {
    flex: 1,
    maxHeight: 120,
    minHeight: 42,
    borderRadius: 21,
    borderWidth: 1,
    borderColor: colors.line,
    paddingHorizontal: space(4),
    paddingVertical: space(2.5),
    fontSize: font.body,
    color: colors.ink,
    backgroundColor: colors.paper,
  },
  send: { width: 38, height: 38, borderRadius: 19, backgroundColor: colors.brand, alignItems: "center", justifyContent: "center" },
  sendPressed: { transform: [{ scale: 0.94 }] },
  sendOff: { opacity: 0.4 },
});
