import { useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Tabs, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Animated, { FadeIn, FadeOut } from "react-native-reanimated";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { colors, font, radius, shadow, space } from "@/theme";

type IconName = keyof typeof Ionicons.glyphMap;

/**
 * 自制 TabBar 需要的 props。
 *
 * 刻意不从 @react-navigation/bottom-tabs 引类型：它只是 expo-router 的传递依赖，
 * 直接引用随时可能因为版本变动而失败。这里只声明真正用到的几个字段——
 * 如果哪天 expo-router 换了实现，这里会立刻报错，比隐式依赖一个不保证存在的包安全。
 */
interface TabBarProps {
  state: { index: number; routes: { key: string; name: string }[] };
  navigation: { navigate: (name: string) => void };
}

const ICONS: Record<string, { on: IconName; off: IconName; label: string }> = {
  index: { on: "sparkles", off: "sparkles-outline", label: "推荐" },
  plaza: { on: "grid", off: "grid-outline", label: "广场" },
  likes: { on: "heart", off: "heart-outline", label: "心动" },
  chat: { on: "chatbubble", off: "chatbubble-outline", label: "消息" },
  me: { on: "person", off: "person-outline", label: "我的" },
};

/**
 * 底部导航。
 *
 * 自己做而不是用默认 TabBar：默认的选中态只能换颜色，在浅底上不够醒目。
 * 这里给选中项加一个**柔和的胶囊底 + 图标加粗**，扫一眼就知道当前在哪。
 *
 * 角标（未读/谁喜欢我）是主要的召回钩子，切页时刷新一次 + 每 30 秒兜底轮询。
 */
export default function TabsLayout() {
  const { userId } = useAuth();
  const [badge, setBadge] = useState({ likes: 0, unread: 0 });

  useEffect(() => {
    if (!userId) return;
    let alive = true;
    const tick = () => {
      api
        .get<{ likes: number; unread: number }>("/counts")
        .then((c) => alive && setBadge({ likes: c.likes, unread: c.unread }))
        .catch(() => {});
    };
    tick();
    const t = setInterval(tick, 30000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [userId]);

  return (
    <Tabs screenOptions={{ headerShown: false }} tabBar={(props) => <TabBar {...props} badge={badge} />}>
      {Object.keys(ICONS).map((name) => (
        <Tabs.Screen key={name} name={name} options={{ title: ICONS[name].label }} />
      ))}
    </Tabs>
  );
}

function TabBar({ state, navigation, badge }: TabBarProps & { badge: { likes: number; unread: number } }) {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const lastTap = useRef(0);

  return (
    <View style={[styles.bar, { paddingBottom: Math.max(insets.bottom, space(2)) }]}>
      {state.routes.map((route: { key: string; name: string }, i: number) => {
        const on = state.index === i;
        const meta = ICONS[route.name] ?? { on: "ellipse" as IconName, off: "ellipse-outline" as IconName, label: route.name };
        const count = route.name === "likes" ? badge.likes : route.name === "chat" ? badge.unread : 0;

        return (
          <Pressable
            key={route.key}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            style={styles.item}
            onPress={() => {
              const now = Date.now();
              // 双击当前 tab 回到顶层（原生 App 的习惯，成本极低）
              if (on && now - lastTap.current < 300) {
                router.replace(`/(tabs)/${route.name}` as never);
              } else if (!on) {
                void Haptics.selectionAsync();
                navigation.navigate(route.name);
              }
              lastTap.current = now;
            }}
          >
            <View style={[styles.pill, on && styles.pillOn]}>
              <Ionicons name={on ? meta.on : meta.off} size={21} color={on ? colors.brand : colors.muted2} />
              {count > 0 ? (
                <Animated.View entering={FadeIn} exiting={FadeOut} style={styles.dot}>
                  <Text style={styles.dotText}>{count > 99 ? "99+" : count}</Text>
                </Animated.View>
              ) : null}
            </View>
            <Text style={[styles.label, on && styles.labelOn]}>{meta.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: "row",
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.line,
    backgroundColor: colors.surface,
    paddingTop: space(2),
    ...shadow.card,
  },
  item: { flex: 1, alignItems: "center", gap: space(1) },
  pill: {
    width: 48,
    height: 28,
    borderRadius: radius.pill,
    alignItems: "center",
    justifyContent: "center",
  },
  pillOn: { backgroundColor: colors.brandSoft },
  label: { fontSize: 11.5, color: colors.muted2 },
  labelOn: { color: colors.brand, fontWeight: "700" },
  dot: {
    position: "absolute",
    right: 2,
    top: -3,
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    paddingHorizontal: 4,
    backgroundColor: colors.brand,
    alignItems: "center",
    justifyContent: "center",
  },
  dotText: { color: colors.white, fontSize: 9, fontWeight: "700" },
});
