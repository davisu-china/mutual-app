import { useEffect } from "react";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import Animated, {
  FadeIn,
  FadeInDown,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import * as Haptics from "expo-haptics";
import { mediaImage } from "@/lib/api";
import { colors, font, radius, space } from "@/theme";

/**
 * 配对成功。
 *
 * 这是全产品情感浓度最高的一屏——用户花了额度、等了回应，终于双向确认。
 * 值得单独设计：深色底把用户从浏览状态里抽离出来形成仪式感，两个头像从左右
 * 飞入相撞，撞出一圈**玫瑰 → 香槟金**的光晕（金色只在这种时刻出现）。
 *
 * 但**刻意克制**：不撒花瓣、不放烟花、不循环播放。一次清脆的相遇，
 * 比一场嘈杂的庆典更符合"认真交往"的定位。
 */
export function MatchOverlay({
  visible,
  myAvatar,
  peerAvatar,
  peerNickname,
  onChat,
  onClose,
}: {
  visible: boolean;
  myAvatar: string;
  peerAvatar: string;
  peerNickname: string;
  onChat: () => void;
  onClose: () => void;
}) {
  const myX = useSharedValue(-140);
  const peerX = useSharedValue(140);
  const glow = useSharedValue(0.2);
  const heart = useSharedValue(0);

  useEffect(() => {
    if (!visible) return;
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    myX.value = withSpring(0, { damping: 16, stiffness: 180 });
    peerX.value = withSpring(0, { damping: 16, stiffness: 180 });
    glow.value = withDelay(260, withTiming(0.5, { duration: 700 }));
    heart.value = withDelay(340, withSpring(1, { damping: 12 }));
  }, [visible, myX, peerX, glow, heart]);

  const myStyle = useAnimatedStyle(() => ({ transform: [{ translateX: myX.value }] }));
  const peerStyle = useAnimatedStyle(() => ({ transform: [{ translateX: peerX.value }] }));
  const glowStyle = useAnimatedStyle(() => ({ opacity: glow.value, transform: [{ scale: 0.6 + glow.value }] }));
  const heartStyle = useAnimatedStyle(() => ({ transform: [{ scale: heart.value }], opacity: heart.value }));

  const mine = mediaImage(myAvatar);
  const peer = mediaImage(peerAvatar);

  return (
    <Modal visible={visible} transparent animationType="fade" statusBarTranslucent onRequestClose={onClose}>
      <View style={styles.root}>
        {/* 光晕：玫瑰核心 + 香槟金外圈 */}
        <Animated.View style={[styles.glow, glowStyle]} pointerEvents="none">
          <LinearGradient
            colors={[`${colors.brand}66`, `${colors.gold}55`, "transparent"]}
            style={StyleSheet.absoluteFill}
          />
        </Animated.View>

        <View style={styles.avatars}>
          <Animated.View style={[styles.avatarRing, styles.avatarLeft, myStyle]}>
            {mine ? <Image source={mine} style={styles.avatar} contentFit="cover" /> : <View style={styles.avatar} />}
          </Animated.View>
          <Animated.View style={[styles.heart]} >
            <Animated.View style={heartStyle}>
              <Ionicons name="heart" size={26} color={colors.gold} />
            </Animated.View>
          </Animated.View>
          <Animated.View style={[styles.avatarRing, styles.avatarRight, peerStyle]}>
            {peer ? <Image source={peer} style={styles.avatar} contentFit="cover" /> : <View style={styles.avatar} />}
          </Animated.View>
        </View>

        <Animated.Text entering={FadeInDown.delay(420).duration(280)} style={styles.title}>
          你们互相喜欢
        </Animated.Text>
        <Animated.Text entering={FadeInDown.delay(500).duration(280)} style={styles.subtitle}>
          你和 {peerNickname} 都对彼此表达了心意
        </Animated.Text>

        <Animated.View entering={FadeIn.delay(580).duration(300)} style={styles.actions}>
          <Pressable style={styles.primary} onPress={onChat} accessibilityRole="button">
            <Text style={styles.primaryText}>去打个招呼</Text>
          </Pressable>
          <Pressable style={styles.secondary} onPress={onClose} accessibilityRole="button">
            <Text style={styles.secondaryText}>继续看看</Text>
          </Pressable>
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.ink, paddingHorizontal: space(8) },
  glow: { position: "absolute", width: 420, height: 420, borderRadius: 210, overflow: "hidden" },
  avatars: { flexDirection: "row", alignItems: "center", marginBottom: space(7) },
  avatarRing: { borderWidth: 2.5, borderColor: colors.ink, borderRadius: 40 },
  avatarLeft: { marginRight: -14, zIndex: 2 },
  avatarRight: { marginLeft: -14 },
  avatar: { width: 76, height: 76, borderRadius: 38, backgroundColor: colors.lineSoft },
  heart: { position: "absolute", left: 0, right: 0, alignItems: "center", zIndex: 3 },
  title: { color: colors.white, fontSize: 19, fontWeight: "700" },
  subtitle: { marginTop: space(1.5), marginBottom: space(8), color: "rgba(255,255,255,.55)", fontSize: 12.5 },
  actions: { width: 210, gap: space(2.5) },
  primary: { borderRadius: radius.pill, backgroundColor: colors.brand, paddingVertical: space(3), alignItems: "center" },
  primaryText: { color: colors.white, fontSize: 14, fontWeight: "700" },
  secondary: { borderRadius: radius.pill, borderWidth: 1, borderColor: "rgba(255,255,255,.18)", paddingVertical: space(3), alignItems: "center" },
  secondaryText: { color: "rgba(255,255,255,.7)", fontSize: 14 },
});
