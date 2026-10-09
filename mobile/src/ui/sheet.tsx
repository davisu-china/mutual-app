import { type ReactNode, useEffect } from "react";
import { Dimensions, Modal, Pressable, StyleSheet, Text, View } from "react-native";
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { colors, font, motion, radius, shadow, space } from "@/theme";

interface Props {
  open: boolean;
  onClose: () => void;
  title?: string;
  /** 右上角确认文案；不传则只显示标题（例如单选点中即关闭） */
  confirmText?: string;
  onConfirm?: () => void;
  children: ReactNode;
}

const SCREEN_H = Dimensions.get("window").height;

/**
 * 底部弹层 —— 全站选择类操作的统一容器。
 *
 * 为什么是底部而不是居中弹窗：手机是单手操作，拇指落在屏幕下半部，
 * 底部弹层的按钮天然在热区内；居中弹窗要挪动手掌去够。
 *
 * 实现上特意做到三点（都是"顺手"与"生硬"的差别）：
 *   1. **跟手拖拽**：手指按住面板往下拖时面板跟着走，不是等松手才动；
 *   2. **松手判定**：拖过 1/4 屏或甩得够快才关，否则弹回——避免误关；
 *   3. 遮罩点击关闭，但**内容区点击不冒泡**，否则选到一半就被关掉。
 */
export function Sheet({ open, onClose, title, confirmText, onConfirm, children }: Props) {
  const insets = useSafeAreaInsets();
  const translateY = useSharedValue(SCREEN_H);
  const backdrop = useSharedValue(0);

  useEffect(() => {
    if (open) {
      translateY.value = withSpring(0, { damping: 22, stiffness: 220, mass: 0.9 });
      backdrop.value = withTiming(1, { duration: motion.quick });
    }
  }, [open, translateY, backdrop]);

  function close() {
    translateY.value = withTiming(SCREEN_H, { duration: motion.sheet });
    backdrop.value = withTiming(0, { duration: motion.quick });
    onClose();
  }

  const pan = Gesture.Pan()
    .onChange((e) => {
      // 只跟手向下拖，向上不做响应（列表还要滚）
      translateY.value = Math.max(0, translateY.value + e.changeY);
    })
    .onEnd((e) => {
      const thrownOut = e.velocityY > 900;
      const draggedFar = translateY.value > SCREEN_H / 4;
      if (thrownOut || draggedFar) {
        translateY.value = withTiming(SCREEN_H, { duration: motion.sheet });
        backdrop.value = withTiming(0, { duration: motion.quick });
        runOnJS(onClose)();
      } else {
        translateY.value = withSpring(0, { damping: 22, stiffness: 220 });
      }
    });

  const sheetStyle = useAnimatedStyle(() => ({ transform: [{ translateY: translateY.value }] }));
  const backdropStyle = useAnimatedStyle(() => ({ opacity: backdrop.value * 0.45 }));

  return (
    <Modal visible={open} transparent animationType="none" onRequestClose={close} statusBarTranslucent>
      <View style={styles.root}>
        <Animated.View style={[styles.backdrop, backdropStyle]}>
          <Pressable style={StyleSheet.absoluteFill} onPress={close} accessibilityLabel="关闭" />
        </Animated.View>

        <GestureDetector gesture={pan}>
          <Animated.View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, space(4)) }, sheetStyle]}>
            {/* 顶部拖拽把手：既是可拖的提示，也是唯一的视觉"握点" */}
            <View style={styles.handleWrap}>
              <View style={styles.handle} />
            </View>

            <View style={styles.header}>
              <Pressable onPress={close} hitSlop={10} accessibilityLabel="取消">
                <Text style={styles.cancel}>取消</Text>
              </Pressable>
              {title ? <Text style={styles.title}>{title}</Text> : <View />}
              {confirmText ? (
                <Pressable onPress={onConfirm ?? close} hitSlop={10} accessibilityLabel={confirmText}>
                  <Text style={styles.confirm}>{confirmText}</Text>
                </Pressable>
              ) : (
                <View style={styles.spacer} />
              )}
            </View>

            {children}
          </Animated.View>
        </GestureDetector>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: "flex-end" },
  backdrop: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: colors.ink },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.card + 4,
    borderTopRightRadius: radius.card + 4,
    ...shadow.raised,
  },
  handleWrap: { alignItems: "center", paddingTop: space(2.5) },
  handle: { width: 38, height: 4, borderRadius: 2, backgroundColor: colors.line },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: space(5),
    paddingTop: space(2.5),
    paddingBottom: space(1),
  },
  cancel: { fontSize: font.body, color: colors.muted2, paddingVertical: space(1) },
  title: { fontSize: font.body, fontWeight: "600", color: colors.ink },
  confirm: { fontSize: font.body, fontWeight: "700", color: colors.brand, paddingVertical: space(1) },
  spacer: { width: 32 },
});
