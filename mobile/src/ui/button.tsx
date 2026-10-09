import { ActivityIndicator, Pressable, StyleSheet, Text, View, type ViewStyle } from "react-native";
import * as Haptics from "expo-haptics";
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import { colors, font, motion, radius, shadow, space } from "@/theme";

type Variant = "primary" | "outline" | "ghost" | "danger";
type Size = "md" | "lg" | "sm";

interface Props {
  label: string;
  onPress: () => void;
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  disabled?: boolean;
  /** 占满整行（底部主操作常用） */
  block?: boolean;
  style?: ViewStyle;
}

/**
 * 按钮。
 *
 * 交互细节（这几处决定了"像不像原生"）：
 *   - 按下**立刻**缩放（140ms），松手弹回；不是等 onPress 才给反馈；
 *   - Android 的波纹交给 Pressable 的 android_ripple，iOS 用缩放——
 *     两端各自的习惯手势，不要强行统一；
 *   - 触发一次轻触觉反馈。手感很轻，但没有它就会觉得"软"。
 */
export function Button({
  label,
  onPress,
  variant = "primary",
  size = "md",
  loading,
  disabled,
  block,
  style,
}: Props) {
  const scale = useSharedValue(1);
  const animated = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  const off = disabled || loading;

  return (
    <Animated.View style={[block && styles.block, animated, style]}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ disabled: !!off, busy: !!loading }}
        disabled={off}
        onPressIn={() => {
          scale.value = withTiming(0.97, { duration: motion.instant });
        }}
        onPressOut={() => {
          scale.value = withTiming(1, { duration: motion.instant });
        }}
        onPress={() => {
          // 轻触反馈：不依赖它传达信息，只是让"按到了"更确定
          void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          onPress();
        }}
        android_ripple={{ color: "rgba(255,255,255,.18)" }}
        style={[styles.base, sizes[size], variants[variant], off && styles.off]}
      >
        <View style={styles.inner}>
          {loading && (
            <ActivityIndicator
              size="small"
              color={variant === "primary" ? colors.white : colors.brand}
            />
          )}
          <Text style={[styles.label, labelSizes[size], variantText[variant]]}>{label}</Text>
        </View>
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  block: { width: "100%" },
  base: {
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.field,
    overflow: "hidden",
  },
  inner: { flexDirection: "row", alignItems: "center", gap: space(2) },
  off: { opacity: 0.45 },
  label: { fontWeight: "600", letterSpacing: 0.2 },
});

const sizes = StyleSheet.create({
  sm: { paddingVertical: space(2), paddingHorizontal: space(3), borderRadius: radius.sm },
  md: { paddingVertical: space(3), paddingHorizontal: space(4) },
  lg: { paddingVertical: space(3.5), paddingHorizontal: space(5) },
});

const labelSizes = StyleSheet.create({
  sm: { fontSize: font.label },
  md: { fontSize: font.body },
  lg: { fontSize: 16 },
});

const variants = StyleSheet.create({
  primary: { backgroundColor: colors.brand, ...shadow.brand },
  outline: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line },
  ghost: { backgroundColor: "transparent" },
  danger: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.brandLine },
});

const variantText = StyleSheet.create({
  primary: { color: colors.white },
  outline: { color: colors.ink },
  ghost: { color: colors.ink },
  danger: { color: colors.brand },
});
