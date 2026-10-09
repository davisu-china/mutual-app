import { type ReactNode, createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import Animated, { FadeInDown, FadeOut } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { colors, font, radius, shadow, space } from "@/theme";

/* ------------------------------------------------------------------ 骨架屏 */
/**
 * 骨架屏：形状与真实内容一致，避免加载完成后大幅跳动。
 * 用纯色块而不是动画渐变——首屏就那几百毫秒，闪烁反而更吵。
 */
export function Skeleton({ height, width, style }: { height: number; width?: number | `${number}%`; style?: object }) {
  return <View style={[{ height, width, borderRadius: radius.field, backgroundColor: colors.lineSoft }, style]} />;
}

/* -------------------------------------------------------------------- 空态 */
/**
 * 空态。给一句「为什么空」和「可以做什么」，不要只画一个插图。
 * 图标放在浅色圆底上，比孤零零一个灰圈有分量。
 */
export function Empty({
  icon = "sparkles-outline",
  title,
  desc,
  action,
}: {
  icon?: keyof typeof Ionicons.glyphMap;
  title: string;
  desc?: string;
  action?: ReactNode;
}) {
  return (
    <View style={styles.empty}>
      <View style={styles.emptyBadge}>
        <Ionicons name={icon} size={26} color={colors.brand} />
      </View>
      <Text style={styles.emptyTitle}>{title}</Text>
      {desc ? <Text style={styles.emptyDesc}>{desc}</Text> : null}
      {action ? <View style={{ marginTop: space(6) }}>{action}</View> : null}
    </View>
  );
}

/* ------------------------------------------------------------------- Toast */
type ToastKind = "info" | "error";
const ToastCtx = createContext<(msg: string, kind?: ToastKind) => void>(() => {});

export function ToastProvider({ children }: { children: ReactNode }) {
  const [msg, setMsg] = useState<{ text: string; kind: ToastKind; key: number } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const show = useCallback((text: string, kind: ToastKind = "info") => {
    setMsg({ text, kind, key: Date.now() });
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setMsg(null), 2600);
  }, []);

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const value = useMemo(() => show, [show]);

  return (
    <ToastCtx.Provider value={value}>
      {children}
      {msg ? (
        <Animated.View
          key={msg.key}
          entering={FadeInDown.duration(220)}
          exiting={FadeOut.duration(160)}
          style={styles.toastWrap}
          pointerEvents="none"
        >
          <View style={[styles.toast, msg.kind === "error" && styles.toastError]}>
            <Text style={styles.toastText}>{msg.text}</Text>
          </View>
        </Animated.View>
      ) : null}
    </ToastCtx.Provider>
  );
}

export function useToast() {
  return useContext(ToastCtx);
}

const styles = StyleSheet.create({
  empty: { alignItems: "center", justifyContent: "center", paddingHorizontal: space(8), paddingVertical: space(16) },
  emptyBadge: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.brandSoft,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: space(4),
  },
  emptyTitle: { fontSize: 16, fontWeight: "600", color: colors.ink },
  emptyDesc: {
    marginTop: space(2),
    maxWidth: 280,
    fontSize: 14,
    lineHeight: 21,
    color: colors.muted2,
    textAlign: "center",
  },
  toastWrap: { position: "absolute", left: 0, right: 0, top: space(14), alignItems: "center", paddingHorizontal: space(6) },
  toast: {
    backgroundColor: colors.ink,
    borderRadius: radius.pill,
    paddingHorizontal: space(4),
    paddingVertical: space(2.5),
    ...shadow.raised,
  },
  toastError: { backgroundColor: colors.brand },
  toastText: { color: colors.white, fontSize: 14 },
});
