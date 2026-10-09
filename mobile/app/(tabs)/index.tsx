import { useCallback, useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { api, ApiError } from "@/lib/api";
import { ProfileCard } from "@/components/profile-card";
import { MatchOverlay } from "@/components/match-overlay";
import { Button } from "@/ui/button";
import { Empty, Skeleton, useToast } from "@/ui/feedback";
import { colors, font, radius, shadow, space } from "@/theme";
import type { ActionResult, Card } from "@/lib/types";

const BATCH = 10;

/**
 * 发现（划卡）。
 *
 * 交互上的两个决定：
 *   1. **只用按钮，不做左右滑动手势**。这是产品早先定下的：桌面/平板可用、
 *      误触率低、可访问、可测试；两套交互并存会把状态机搞复杂。
 *      所以"丝滑"要做在别处：按下即有反馈、卡片带方向飞出、失败能撤回。
 *   2. **乐观更新**：点下去卡片立刻飞走、额度立刻减，请求在后台跑。
 *      用户感知到的延迟是 0——这是"顺"的关键；失败再滑回来并说明原因。
 */
export default function Discover() {
  const nav = useRouter();
  const insets = useSafeAreaInsets();
  const toast = useToast();

  const [cards, setCards] = useState<Card[] | null>(null);
  const [quota, setQuota] = useState({ used: 0, limit: 10, remain: 10 });
  const [busy, setBusy] = useState(false);
  const [flyOut, setFlyOut] = useState<{ card: Card; dir: "like" | "pass" } | null>(null);
  const [match, setMatch] = useState<{ nickname: string; avatar: string } | null>(null);
  const myAvatar = useRef("");

  const load = useCallback(async () => {
    try {
      const r = await api.get<{ cards: Card[]; quota?: typeof quota }>(`/cards?limit=${BATCH}`);
      setCards(r.cards ?? []);
      // 兜底：主屏不该因为响应里少一个字段就白屏（冒烟测试实测撞到过）
      setQuota(r.quota ?? { used: 0, limit: 10, remain: 10 });
    } catch (e) {
      if (e instanceof ApiError && e.code === "ONBOARDING_REQUIRED") return; // 由全局回调送人去向导
      toast(e instanceof ApiError ? e.message : "加载失败", "error");
      setCards([]);
    }
  }, [toast]);

  useEffect(() => {
    void load();
    api
      .get<{ avatarUrl: string }>("/users/me")
      .then((p) => (myAvatar.current = p.avatarUrl))
      .catch(() => {});
  }, [load]);

  const top = cards?.[0];

  const act = useCallback(
    async (action: "like" | "pass") => {
      if (!top || busy) return;
      setBusy(true);
      void Haptics.impactAsync(action === "like" ? Haptics.ImpactFeedbackStyle.Medium : Haptics.ImpactFeedbackStyle.Light);

      // 乐观：先让它飞走
      setFlyOut({ card: top, dir: action });
      const snapshot = cards ?? [];
      setCards((prev) => (prev ? prev.slice(1) : prev));
      if (action === "like") setQuota((q) => ({ ...q, used: q.used + 1, remain: Math.max(0, q.remain - 1) }));
      setTimeout(() => setFlyOut(null), 420);

      try {
        const res = await api.post<ActionResult>("/actions", { toUser: top.userId, action, source: "card" });
        setQuota((q) => ({ ...q, used: res.quotaUsed, limit: res.quotaLimit, remain: res.quotaRemain }));
        if (res.matched) setMatch({ nickname: top.nickname, avatar: top.avatarUrl });
      } catch (e) {
        // 失败：把卡片放回去，并如实说明原因（额度用完 / 网络）
        setCards(snapshot);
        setFlyOut(null);
        toast(e instanceof ApiError ? e.message : "操作失败，请重试", "error");
        void load();
      } finally {
        setBusy(false);
      }
    },
    [top, busy, cards, toast, load]
  );

  const exhausted = quota.remain <= 0;

  return (
    <View style={[styles.root, { paddingTop: insets.top + space(2) }]}>
      <View style={styles.header}>
        <Text style={styles.title}>发现</Text>
        <View style={[styles.quota, exhausted && styles.quotaOff]}>
          <Ionicons name="flame" size={13} color={exhausted ? colors.muted2 : colors.brand} />
          <Text style={[styles.quotaText, exhausted && styles.quotaTextOff]}>
            今日还可喜欢 {quota.remain} 人
          </Text>
        </View>
      </View>

      <View style={styles.stage}>
        {cards === null ? (
          <Skeleton height={420} style={styles.skeleton} />
        ) : !top && !flyOut ? (
          <Empty
            icon={exhausted ? "time-outline" : "compass-outline"}
            title={exhausted ? "今日额度已用完" : "暂时没有新的推荐"}
            desc={
              exhausted
                ? "明天 00:00 恢复。也可以去恋爱广场主动找人——浏览不消耗额度。"
                : "过一会儿再来，或者去广场看看。"
            }
            action={<Button label="去广场" variant="outline" onPress={() => nav.push("/(tabs)/plaza")} />}
          />
        ) : (
          <>
            {/* 后面两张露出一点点，制造"还有下一张"的纵深 */}
            {cards && cards[2] ? <View style={[styles.behind, styles.behind2]} /> : null}
            {cards && cards[1] ? <View style={[styles.behind, styles.behind1]} /> : null}

            {cards && cards[1] ? (
              <View style={styles.cardWrap}>
                <ProfileCard card={cards[1]} />
              </View>
            ) : null}

            {flyOut ? (
              <FlyingCard card={flyOut.card} dir={flyOut.dir} />
            ) : top ? (
              <Animated.View key={top.userId} style={styles.cardWrap} entering={undefined}>
                <ProfileCard card={top} />
              </Animated.View>
            ) : null}
          </>
        )}
      </View>

      <View style={[styles.actions, { paddingBottom: Math.max(insets.bottom, space(4)) }]}>
        <Pressable
          accessibilityLabel="跳过"
          disabled={!top || busy}
          onPress={() => void act("pass")}
          style={({ pressed }) => [styles.pass, pressed && styles.pressed, (!top || busy) && styles.off]}
        >
          <Ionicons name="close" size={26} color={colors.muted} />
        </Pressable>

        <Pressable
          accessibilityLabel="喜欢"
          disabled={!top || busy || exhausted}
          onPress={() => void act("like")}
          style={({ pressed }) => [styles.like, pressed && styles.pressed, (!top || busy || exhausted) && styles.off]}
        >
          <Ionicons name="heart" size={30} color={colors.white} />
        </Pressable>
      </View>

      <MatchOverlay
        visible={!!match}
        myAvatar={myAvatar.current}
        peerAvatar={match?.avatar ?? ""}
        peerNickname={match?.nickname ?? ""}
        onChat={() => {
          const n = match;
          setMatch(null);
          if (n) nav.push("/(tabs)/chat");
        }}
        onClose={() => setMatch(null)}
      />
    </View>
  );
}

/** 飞出去的那张卡：按方向平移 + 轻微旋转 + 淡出，然后被卸载 */
function FlyingCard({ card, dir }: { card: Card; dir: "like" | "pass" }) {
  const x = useSharedValue(0);
  const opacity = useSharedValue(1);

  useEffect(() => {
    x.value = withTiming(dir === "like" ? 460 : -460, { duration: 360 });
    opacity.value = withTiming(0, { duration: 380 });
  }, [dir, x, opacity]);

  const style = useAnimatedStyle(() => ({
    transform: [{ translateX: x.value }, { rotate: `${x.value / 40}deg` }],
    opacity: opacity.value,
  }));

  return (
    <Animated.View style={[styles.cardWrap, style]} pointerEvents="none">
      <ProfileCard card={card} />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.paper },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: space(5), paddingBottom: space(3) },
  title: { fontSize: 18, fontWeight: "700", letterSpacing: 0.2, color: colors.ink },
  quota: { flexDirection: "row", alignItems: "center", gap: space(1.5), borderRadius: radius.pill, backgroundColor: colors.brandSoft, paddingHorizontal: space(3), paddingVertical: space(1.5) },
  quotaOff: { backgroundColor: colors.lineSoft },
  quotaText: { fontSize: 12, fontWeight: "600", color: colors.brand, fontVariant: ["tabular-nums"] },
  quotaTextOff: { color: colors.muted2 },
  stage: { flex: 1, paddingHorizontal: space(5), paddingBottom: space(2), justifyContent: "center" },
  skeleton: { borderRadius: radius.card },
  behind: { position: "absolute", left: space(5), right: space(5), borderRadius: radius.card, backgroundColor: colors.surface, ...shadow.card },
  behind1: { top: space(5), bottom: space(2), transform: [{ scale: 0.97 }], opacity: 0.7 },
  behind2: { top: space(6), bottom: space(3), transform: [{ scale: 0.94 }], opacity: 0.4 },
  cardWrap: { flex: 1, borderRadius: radius.card },
  actions: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: space(7), paddingTop: space(4) },
  pass: {
    width: 56,
    height: 56,
    borderRadius: 28,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface,
    alignItems: "center",
    justifyContent: "center",
    ...shadow.card,
  },
  like: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: colors.brand,
    alignItems: "center",
    justifyContent: "center",
    ...shadow.brand,
  },
  pressed: { transform: [{ scale: 0.95 }] },
  off: { opacity: 0.4 },
});
