import { useCallback, useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { api, ApiError } from "@/lib/api";
import { RecommendCard } from "@/components/recommend-card";
import { MatchOverlay } from "@/components/match-overlay";
import { Button } from "@/ui/button";
import { Empty, Skeleton, useToast } from "@/ui/feedback";
import { colors, radius, shadow, space } from "@/theme";
import type { ActionResult, Card } from "@/lib/types";
import { DEPTH_FADE, DEPTH_SCALE, DEPTH_Y, EXIT_MS, SPRING, decideSwipe, type Dir } from "@/lib/swipe";

const BATCH = 10;

/**
 * 推荐（划卡）。
 *
 * 交互：**左滑跳过、右滑喜欢，同时也保留底部按钮**（按钮是无障碍与可达性的
 * 兜底——屏幕阅读器用户、桌面端、误触都靠它）。滑动手势和按钮走的是同一条
 * 决策路径 `act()`，不存在两套状态机。
 *
 * 三个手感细节：
 *   1. **乐观更新**：松手瞬间卡片就飞走、额度就减，请求在后台跑。
 *      用户感知到的延迟是 0；失败再把卡片放回来并说明原因。
 *   2. **飞出去的那张不在这里做动画**：手势只负责报一个"从哪飞"的坐标，
 *      交接给 FlyingCard 从当前位置接着走。否则两张卡会同时在场，
 *      或者动画接不上、出现一次可见的回弹。
 *   3. 卡栈按 depth 缩小／下沉／降透明度，depth 由弹簧驱动——下面那张升上来
 *      时长上去，而不是"啪"地跳一下。
 */
export default function Recommend() {
  const nav = useRouter();
  const insets = useSafeAreaInsets();
  const toast = useToast();
  const { width } = useWindowDimensions();
  /** 卡片的实际宽度 = stage 可用宽（左右各 space(3)）——滑动阈值按它的比例算，改边距时这里要一起改 */
  const cardW = width - space(3) * 2;

  const [cards, setCards] = useState<Card[] | null>(null);
  const [quota, setQuota] = useState({ used: 0, limit: 10, remain: 10 });
  const [busy, setBusy] = useState(false);
  const [exiting, setExiting] = useState<{ card: Card; dir: Dir; fromX: number } | null>(null);
  const [match, setMatch] = useState<{ nickname: string; avatar: string } | null>(null);
  /** 滑过一次就不再提示了——提示是给第一次来的人看的 */
  const [hinted, setHinted] = useState(false);
  const myAvatar = useRef("");
  const exitTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (exitTimer.current) clearTimeout(exitTimer.current);
  }, []);

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

  const exhausted = quota.remain <= 0;

  const act = useCallback(
    async (action: Dir, fromX = 0) => {
      const cur = cards?.[0];
      if (!cur || busy) return;
      setBusy(true);
      setHinted(true);
      void Haptics.impactAsync(action === "like" ? Haptics.ImpactFeedbackStyle.Medium : Haptics.ImpactFeedbackStyle.Light);

      // 乐观：先让它飞走
      setExiting({ card: cur, dir: action, fromX });
      const snapshot = cards ?? [];
      setCards((prev) => (prev ? prev.slice(1) : prev));
      if (action === "like") setQuota((q) => ({ ...q, used: q.used + 1, remain: Math.max(0, q.remain - 1) }));
      // 必须先清掉上一个：接口回得比动画快时，连点两下会让旧的定时器
      // 提前把第二次飞出给掐掉（覆盖 ref 并不会取消已经排上的那个 timeout）
      if (exitTimer.current) clearTimeout(exitTimer.current);
      exitTimer.current = setTimeout(() => setExiting(null), EXIT_MS);

      try {
        const res = await api.post<ActionResult>("/actions", { toUser: cur.userId, action, source: "card" });
        setQuota((q) => ({ ...q, used: res.quotaUsed, limit: res.quotaLimit, remain: res.quotaRemain }));
        if (res.matched) setMatch({ nickname: cur.nickname, avatar: cur.avatarUrl });
      } catch (e) {
        // 失败：把卡片放回去，并如实说明原因（额度用完 / 网络）
        if (exitTimer.current) clearTimeout(exitTimer.current);
        setCards(snapshot);
        setExiting(null);
        toast(e instanceof ApiError ? e.message : "操作失败，请重试", "error");
        void load();
      } finally {
        setBusy(false);
      }
    },
    [cards, busy, toast, load]
  );

  /** 额度用完还右滑：卡片弹回去并说清楚，不要让它飞出去再被 API 打回来 */
  const onBlocked = useCallback(() => {
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    toast("今日喜欢额度已用完，明天 00:00 恢复", "error");
  }, [toast]);

  const top = cards?.[0];
  // 飞走的那张仍然占着栈顶，下面两张是新队列的头部——这样飞行途中
  // 露在后面的是"下一张"，而不是跳过去的一张。
  const stack = exiting ? [exiting.card, ...(cards ?? []).slice(0, 2)] : (cards ?? []).slice(0, 3);

  return (
    <View style={[styles.root, { paddingTop: insets.top + space(2) }]}>
      <View style={styles.header}>
        <Text style={styles.title}>推荐</Text>
        {/* 额度只在快用完（≤3）时才冒出来。平时头部就一个标题——主流划卡页都是这样，
            常驻一个「今日还可喜欢 N 人」会把界面变成记账本。
            规则与「心动」页一致。 */}
        {quota.remain <= 3 ? (
          <View style={[styles.quota, exhausted && styles.quotaOff]}>
            <Ionicons name="flame" size={13} color={exhausted ? colors.muted2 : colors.brand} />
            <Text style={[styles.quotaText, exhausted && styles.quotaTextOff]}>
              {exhausted ? "今日额度已用完" : `今日还可喜欢 ${quota.remain} 人`}
            </Text>
          </View>
        ) : null}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="换一批"
          hitSlop={10}
          onPress={() => void load()}
          style={({ pressed }) => [styles.iconBtn, pressed && styles.iconBtnPressed]}
        >
          <Ionicons name="refresh" size={19} color={colors.muted} />
        </Pressable>
      </View>

      {/* testID 是给渲染测试用的：下面两处版面约定（卡片两侧留边距、按钮浮层压在卡上）
          靠肉眼看不住，都是用户实机报过一次才知道坏的 */}
      <View style={styles.stage} testID="deck-stage">
        {cards === null ? (
          <Skeleton height={420} style={styles.skeleton} />
        ) : !top && !exiting ? (
          <Empty
            icon={exhausted ? "time-outline" : "sparkles-outline"}
            title={exhausted ? "今日额度已用完" : "这一批看完了"}
            desc={
              exhausted
                ? "明天 00:00 恢复。也可以去恋爱广场主动找人——浏览不消耗额度。"
                : "还有别人在等你，再取一批。"
            }
            action={
              <View style={styles.emptyActions}>
                {/* 一次只取 10 张（服务端也是这个上限），所以划完必须能主动再取。
                    没有这个按钮就只能退出重进 App——而且这一页不像其它三个 tab
                    那样 useFocusEffect 重拉，切走再切回来并不会刷新。 */}
                {!exhausted ? <Button label="再看一批" onPress={() => void load()} /> : null}
                <Button label="去广场" variant="outline" onPress={() => nav.push("/(tabs)/plaza")} />
              </View>
            }
          />
        ) : (
          <View style={styles.deck}>
            {stack.map((c, i) =>
              i === 0 && exiting ? (
                <FlyingCard
                  key={c.userId}
                  card={c}
                  dir={exiting.dir}
                  fromX={exiting.fromX}
                />
              ) : (
                <DeckCard
                  key={c.userId}
                  card={c}
                  depth={i}
                  width={cardW}
                  interactive={i === 0}
                  canLike={!exhausted}
                  onDecide={act}
                  onBlocked={onBlocked}
                  onOpen={(uid) => nav.push(`/user/${uid}`)}
                />
              )
            )}

            {/*
              按钮浮在卡片上，但**放在手势之外**：
              它们是普通的 Pressable，如果塞进卡片的 GestureDetector 里，
              点一下会同时触发"按钮"和"点开资料"两件事。放在这里视觉上仍然
              叠在卡上，行为上互不干扰。
              左边跳过、右边喜欢——和左右滑的方向一一对应。
            */}
            <View style={styles.actionsOverlay} pointerEvents="box-none" testID="card-actions">
              {top && !hinted ? (
                <View style={styles.hintPill} pointerEvents="none">
                  <Text style={styles.hintText}>左滑跳过 · 右滑喜欢</Text>
                </View>
              ) : null}
              {/* box-none：这一行铺满整宽，如果它自己吃掉触摸，
                  卡片下半部分就再也划不动了（按钮仍然照常响应） */}
              <View style={styles.actionsRow} pointerEvents="box-none">
                <Pressable
                  accessibilityLabel="跳过"
                  disabled={!top || busy}
                  onPress={() => void act("pass")}
                  style={({ pressed }) => [styles.pass, pressed && styles.pressed, (!top || busy) && styles.off]}
                >
                  <Ionicons name="close" size={27} color={colors.muted} />
                </Pressable>

                <Pressable
                  accessibilityLabel="喜欢"
                  disabled={!top || busy || exhausted}
                  onPress={() => void act("like")}
                  style={({ pressed }) => [styles.like, pressed && styles.pressed, (!top || busy || exhausted) && styles.off]}
                >
                  <Ionicons name="heart" size={33} color={colors.white} />
                </Pressable>
              </View>
            </View>
          </View>
        )}
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

interface DeckCardProps {
  card: Card;
  /** 0 = 最上面那张（唯一接收手势的），1/2 = 后面的预览 */
  depth: number;
  /** 卡片宽度，滑动阈值按它算 */
  width: number;
  interactive: boolean;
  canLike: boolean;
  onDecide: (dir: Dir, fromX: number) => void;
  onBlocked: () => void;
  /** 轻点卡片 = 打开 TA 的主页（只有最上面那张会触发） */
  onOpen: (userId: number) => void;
}

/**
 * 卡栈里的一张。
 *
 * 三张卡全部绝对定位叠在同一块区域上，靠 scale／translateY／opacity 分纵深。
 * depth 是弹簧驱动的：某张卡从第 1 层升到第 0 层会长上去，不是跳一下。
 * （React 按 key 复用实例，所以 shift 之后同一个组件只是换了 depth 这个 prop，
 * 动画才能接上。）
 */
function DeckCard({ card, depth, width, interactive, canLike, onDecide, onBlocked, onOpen }: DeckCardProps) {
  const d = useSharedValue(depth);
  const x = useSharedValue(0);
  useEffect(() => {
    d.value = withSpring(depth, SPRING);
  }, [depth, d]);

  const pan = Gesture.Pan()
    .enabled(interactive)
    // **别加 failOffsetY**：横向滑动时手腕是带弧线的，纵向很容易先超过十几像素，
    // 那样手势会直接判负——表现就是"左滑有时候划不过去"（上一版就这么坏的）。
    // 只要求横向动一点点就认，纵向位移一律忽略（卡片不做上下跟手）。
    .activeOffsetX([-8, 8])
    .onUpdate((e) => {
      x.value = e.translationX;
    })
    .onEnd((e) => {
      const dir = decideSwipe(x.value, e.velocityX, width);
      if (dir && !(dir === "like" && !canLike)) {
        // 不在这里做飞出去的动画：交给 FlyingCard 从当前位置接着走。
        // 否则两张卡会同时在场，或者动画接不上、出现一次可见的回弹。
        runOnJS(onDecide)(dir, x.value);
        return;
      }
      x.value = withSpring(0, SPRING);
      // 额度用完还右滑：弹回去并说清楚，别让它飞出去再被接口打回来
      if (dir === "like") runOnJS(onBlocked)();
    });

  /**
   * 轻点 = 看资料。和拖拽用 `Race` 组合：谁先成立谁生效——
   * 手指移动超过阈值时 Pan 先激活（Tap 随之取消），原地抬手时才是 Tap。
   * 普通的 `Exclusive` 在这里不适用：它让 Pan 有绝对优先权，而 Pan 在
   * "没移动" 的情况下要等手指抬起才失败，Tap 会白白多等一拍。
   */
  const tap = Gesture.Tap()
    .enabled(interactive)
    .onEnd((_e, success) => {
      if (success) runOnJS(onOpen)(card.userId);
    });

  const gesture = Gesture.Race(tap, pan);

  const style = useAnimatedStyle(() => ({
    transform: [
      { translateX: x.value },
      { translateY: d.value * DEPTH_Y },
      { scale: 1 - d.value * DEPTH_SCALE },
      { rotate: `${x.value / 40}deg` },
    ],
    opacity: Math.max(0.2, 1 - Math.min(d.value, 2) * DEPTH_FADE),
  }));

  // 提示章：右滑渐显"喜欢"、左滑渐显"跳过"，跟着拖动距离出现。
  // 倾斜角必须写在动画样式里——RN 的 transform 是整体替换而不是合并，
  // 写在静态样式里会被这个 scale 顶掉。
  const likeStamp = useAnimatedStyle(() => {
    const p = Math.max(0, Math.min(1, x.value / (width * 0.14)));
    return { opacity: p, transform: [{ rotate: "-12deg" }, { scale: 0.86 + 0.14 * p }] };
  });
  const passStamp = useAnimatedStyle(() => {
    const p = Math.max(0, Math.min(1, -x.value / (width * 0.14)));
    return { opacity: p, transform: [{ rotate: "12deg" }, { scale: 0.86 + 0.14 * p }] };
  });

  return (
    <GestureDetector gesture={gesture}>
      <Animated.View
        style={[StyleSheet.absoluteFill, style, { zIndex: 10 - depth }]}
        pointerEvents={interactive ? "auto" : "none"}
        accessibilityRole={interactive ? "button" : undefined}
        accessibilityHint={interactive ? "打开 TA 的主页" : undefined}
        accessibilityElementsHidden={!interactive}
        importantForAccessibility={interactive ? "auto" : "no-hide-descendants"}
      >
        <RecommendCard card={card} />

        <Animated.View style={[styles.stamp, styles.stampLike, likeStamp]} pointerEvents="none">
          <Text style={styles.stampLikeText}>喜欢</Text>
        </Animated.View>
        <Animated.View style={[styles.stamp, styles.stampPass, passStamp]} pointerEvents="none">
          <Text style={styles.stampPassText}>跳过</Text>
        </Animated.View>
      </Animated.View>
    </GestureDetector>
  );
}

/**
 * 飞出去的那张卡。
 *
 * 起始位置由手势交接过来（fromX），所以松手那一刻不会有位移跳变；
 * 斜率和 DeckCard 用的是同一个 `x / 40`，角度也能接上。
 */
function FlyingCard({ card, dir, fromX }: { card: Card; dir: Dir; fromX: number }) {
  const { width } = useWindowDimensions();
  const x = useSharedValue(fromX);
  const opacity = useSharedValue(1);

  useEffect(() => {
    x.value = withTiming(dir === "like" ? width * 1.1 : -width * 1.1, { duration: EXIT_MS });
    opacity.value = withTiming(0, { duration: EXIT_MS + 60 });
  }, [dir, width, x, opacity]);

  const style = useAnimatedStyle(() => ({
    transform: [{ translateX: x.value }, { translateY: -60 }, { rotate: `${x.value / 40}deg` }],
    opacity: opacity.value,
  }));

  return (
    <Animated.View style={[StyleSheet.absoluteFill, style, styles.flying]} pointerEvents="none">
      <RecommendCard card={card} />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.paper },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: space(5), paddingBottom: space(2) },
  title: { fontSize: 18, fontWeight: "700", letterSpacing: 0.2, color: colors.ink },
  iconBtn: { width: 34, height: 34, borderRadius: 17, alignItems: "center", justifyContent: "center" },
  iconBtnPressed: { backgroundColor: colors.lineSoft },
  quota: { flexDirection: "row", alignItems: "center", gap: space(1.5), borderRadius: radius.pill, backgroundColor: colors.brandSoft, paddingHorizontal: space(3), paddingVertical: space(1.5) },
  quotaOff: { backgroundColor: colors.lineSoft },
  quotaText: { fontSize: 12, fontWeight: "600", color: colors.brand, fontVariant: ["tabular-nums"] },
  quotaTextOff: { color: colors.muted2 },
  // 左右留 12、底部留 8。
  // ⚠️ 试过留 0（"卡片铺满"字面意义上的全屏）——很难看：圆角正好落在屏幕边缘上，
  // 看着不像一张卡，像整屏贴了一张图。**留一点缝，卡片才成其为卡片。**
  stage: { flex: 1, paddingHorizontal: space(3), paddingBottom: space(2) },
  // 卡栈的定位基准：绝对定位的子元素按这一层算，才能正好等于卡片的可视区域
  deck: { flex: 1 },
  skeleton: { borderRadius: radius.card },
  flying: { zIndex: 20 },
  stamp: {
    position: "absolute",
    top: space(7),
    borderRadius: radius.sm,
    borderWidth: 2,
    paddingHorizontal: space(3),
    paddingVertical: space(1.5),
    backgroundColor: "rgba(255,255,255,.92)",
  },
  stampLike: { left: space(4), borderColor: colors.brand },
  stampPass: { right: space(4), borderColor: colors.muted2 },
  stampLikeText: { color: colors.brand, fontSize: 16, fontWeight: "800", letterSpacing: 2 },
  stampPassText: { color: colors.muted, fontSize: 16, fontWeight: "800", letterSpacing: 2 },
  hintPill: {
    borderRadius: radius.pill,
    backgroundColor: "rgba(26,21,18,.62)",
    paddingHorizontal: space(3.5),
    paddingVertical: space(1.5),
  },
  emptyActions: { flexDirection: "row", alignItems: "center", gap: space(3) },
  hintText: { fontSize: 12, color: colors.white },
  // 按钮浮层：绝对定位在卡栈之上，但在手势之外（见 JSX 里的注释）。
  // ⚠️ **必须有 zIndex**：卡片自己是 `zIndex: 10`、飞出去那张是 20，
  // 而同级元素不写 zIndex 时算 0 ⇒ 卡片会盖在按钮上面。症状是"按钮不见了"
  // （其实还在，只是被照片挡住了）。这个坑只在真机上看得见。
  actionsOverlay: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: space(2),
    zIndex: 30,
    // Android 上 elevation 也参与绘制顺序，而卡片带 elevation:3、这层是 0——
    // 只写 zIndex 不敢打包票，所以一并抬起来。背景是透明的，不会画出阴影来。
    elevation: 12,
    alignItems: "center",
    paddingBottom: space(6),
    gap: space(3),
  },
  // 左右分开摆：位置和滑动方向一一对应（左边跳过、右边喜欢）
  actionsRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    alignSelf: "stretch",
    paddingHorizontal: space(9),
  },
  pass: {
    width: 58,
    height: 58,
    borderRadius: 29,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface,
    alignItems: "center",
    justifyContent: "center",
    ...shadow.card,
  },
  like: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: colors.brand,
    alignItems: "center",
    justifyContent: "center",
    ...shadow.brand,
  },
  pressed: { transform: [{ scale: 0.95 }] },
  off: { opacity: 0.4 },
});
