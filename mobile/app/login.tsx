import { useCallback, useRef, useState } from "react";
import {
  KeyboardAvoidingView,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useRouter } from "expo-router";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import Animated, {
  interpolateColor,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import * as Haptics from "expo-haptics";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { Button } from "@/ui/button";
import { Input } from "@/ui/input";
import { useToast } from "@/ui/feedback";
import { colors, font, motion, radius, space } from "@/theme";

type Mode = "login" | "register";

/**
 * 登录 / 注册。
 *
 * 这是全站第一印象，所以做得比"能用"多一点：
 *   - 顶部一层洒下来的玫瑰光，避免大面积纯色底看着像内部工具；
 *   - 登录/注册做成滑块胶囊，指示条跟着手指位置走（而不是两个按钮轮流变色）；
 *   - 校验放在**提交前本地做一遍**，错误就地显示在字段下，不弹 toast——
 *     toast 会盖住用户正在看的字段。
 *
 * 交互上的克制：不做动画炫技，键盘弹起时只保证输入框不被挡住。
 */
export default function Login() {
  const nav = useRouter();
  const insets = useSafeAreaInsets();
  const toast = useToast();
  const { signIn, signUp } = useAuth();

  const [mode, setMode] = useState<Mode>("login");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<{ field: "phone" | "password" | "confirm"; msg: string } | null>(null);
  const pwdRef = useRef<TextInput>(null);
  const confirmRef = useRef<TextInput>(null);

  // 指示条位置跟着模式走：0 = 登录，1 = 注册
  const tab = useSharedValue(0);
  const indicator = useAnimatedStyle(() => ({
    transform: [{ translateX: `${tab.value * 100}%` }],
    backgroundColor: interpolateColor(tab.value, [0, 1], [colors.brand, colors.gold]),
  }));

  const switchMode = useCallback(
    (m: Mode) => {
      if (m === mode) return;
      void Haptics.selectionAsync();
      tab.value = withTiming(m === "login" ? 0 : 1, { duration: motion.quick });
      setMode(m);
      setErr(null);
    },
    [mode, tab]
  );

  function validate(): boolean {
    if (!/^1[3-9]\d{9}$/.test(phone)) {
      setErr({ field: "phone", msg: "请输入 11 位手机号" });
      return false;
    }
    if (password.length < 8 || password.length > 20 || !/[A-Za-z]/.test(password) || !/\d/.test(password)) {
      setErr({ field: "password", msg: "密码需 8–20 位，且同时包含字母和数字" });
      return false;
    }
    if (mode === "register" && password !== confirm) {
      setErr({ field: "confirm", msg: "两次输入的密码不一致" });
      return false;
    }
    setErr(null);
    return true;
  }

  async function submit() {
    if (busy || !validate()) return;
    setBusy(true);
    try {
      if (mode === "login") await signIn(phone, password);
      else await signUp(phone, password);
      // 登录/注册成功：交给入口分流决定去向导还是主界面
      nav.replace("/");
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : "网络异常，请稍后重试";
      // 服务端已经把话写清楚了（例如"该手机号已注册"），原样告诉用户
      toast(msg, "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <KeyboardAvoidingView style={styles.root} behavior="padding">
      {/* Android 也必须显式给 behavior：Android 15 起系统强制 edge-to-edge，窗口不再
          随键盘缩放（原来的 adjustResize 失效），传 undefined 时 KAV 只渲染一个普通
          View、完全不避让，密码框就被键盘整个盖住。用 padding 两端都安全——它按自身
          frame 算重叠高度，窗口若真被系统缩了，这个值会算成 0，不会重复避让。 */}
      {/* 顶部氛围光：径向光在 RN 里没有原生等价物，用一个大圆 + 低透明度近似 */}
      <View pointerEvents="none" style={styles.glow} />
      <View pointerEvents="none" style={styles.glowCore} />

      <ScrollView
        contentContainerStyle={[styles.content, { paddingTop: insets.top + space(16) }]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.brandBlock}>
          {/* 图形直接落在纸面上，不套色块。两个原因：这一版的取向是减法（不堆材质），
              而且 mark.png 是"酒红图形 + 透明底"，套上酒红色块反而看不见。
              资源由 scripts/gen-icons 生成——这台机器跑不了设计软件，图标是代码画的 */}
          <Image source={require("../assets/mark.png")} style={styles.brandLogo} contentFit="contain" />
          <Text style={styles.brandName}>相悦</Text>
          {/* 名字与口号之间一道金色细线：中文排版的高级感很大程度来自这种"分层"，
              直接两行字堆在一起会显得随意 */}
          <View style={styles.brandRule} />
          <Text style={styles.slogan}>两情相悦，才值得开始</Text>
        </View>

        {/* 登录 / 注册 */}
        <View style={styles.switcher}>
          <Animated.View style={[styles.indicator, indicator]} />
          {(["login", "register"] as Mode[]).map((m) => (
            <Pressable key={m} style={styles.switchItem} onPress={() => switchMode(m)} accessibilityRole="button">
              <Text style={[styles.switchText, mode === m && styles.switchTextOn]}>
                {m === "login" ? "登录" : "注册"}
              </Text>
            </Pressable>
          ))}
        </View>

        <View style={styles.form}>
          <Input
            label="手机号"
            value={phone}
            onChangeText={setPhone}
            placeholder="请输入 11 位手机号"
            keyboardType="number-pad"
            maxLength={11}
            textContentType="telephoneNumber"
            returnKeyType="next"
            onSubmitEditing={() => pwdRef.current?.focus()}
            error={err?.field === "phone" ? err.msg : undefined}
          />

          <Input
            ref={pwdRef}
            label="密码"
            value={password}
            onChangeText={setPassword}
            placeholder={mode === "register" ? "8–20 位，含字母和数字" : "请输入密码"}
            secureTextEntry
            textContentType={mode === "register" ? "newPassword" : "password"}
            returnKeyType={mode === "register" ? "next" : "go"}
            onSubmitEditing={() => (mode === "register" ? confirmRef.current?.focus() : void submit())}
            error={err?.field === "password" ? err.msg : undefined}
          />

          {mode === "register" ? (
            <Input
              ref={confirmRef}
              label="确认密码"
              value={confirm}
              onChangeText={setConfirm}
              placeholder="再输一次"
              secureTextEntry
              returnKeyType="go"
              onSubmitEditing={() => void submit()}
              error={err?.field === "confirm" ? err.msg : undefined}
            />
          ) : null}

          <Button label={mode === "login" ? "登录" : "注册并开始"} onPress={submit} loading={busy} size="lg" block />

          <Text style={styles.agree}>
            {mode === "register"
              ? "注册即表示同意《用户协议》与《隐私政策》"
              : "手机号只是账号名，不会向任何人展示"}
          </Text>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.paper },
  glow: {
    position: "absolute",
    top: -220,
    alignSelf: "center",
    width: 520,
    height: 520,
    borderRadius: 260,
    backgroundColor: colors.brand,
    opacity: 0.08,
  },
  glowCore: {
    position: "absolute",
    top: -120,
    alignSelf: "center",
    width: 300,
    height: 300,
    borderRadius: 150,
    backgroundColor: colors.brand,
    opacity: 0.06,
  },
  content: { paddingHorizontal: space(6), paddingBottom: space(12), flexGrow: 1, justifyContent: "center" },
  brandBlock: { alignItems: "center", marginBottom: space(10) },
  // 图形的实际墨迹只占方形画布的约 61%（宽高比 1:0.61），所以显示尺寸要比"看起来"的大
  brandLogo: { width: 96, height: 96, marginBottom: space(4) },
  // letterSpacing 会在**每个字**后面留出空隙，包括最后一个——两个字看起来就整体偏左。
  // 补一个等量的 paddingLeft 把它推回视觉中心。
  brandName: { fontSize: 33, fontWeight: "700", letterSpacing: 8, paddingLeft: 8, color: colors.ink },
  brandRule: { width: 26, height: 1, marginTop: space(3), backgroundColor: colors.goldLine },
  slogan: { marginTop: space(3), fontSize: 13, letterSpacing: 1.5, paddingLeft: 1.5, color: colors.muted2 },
  switcher: {
    flexDirection: "row",
    backgroundColor: colors.lineSoft,
    borderRadius: radius.field,
    padding: 4,
    position: "relative",
  },
  indicator: {
    position: "absolute",
    top: 4,
    left: 4,
    bottom: 4,
    width: "50%",
    borderRadius: radius.sm,
  },
  switchItem: { flex: 1, paddingVertical: space(2.5), alignItems: "center", zIndex: 1 },
  switchText: { fontSize: 15, color: colors.muted },
  switchTextOn: { color: colors.white, fontWeight: "700" },
  form: { marginTop: space(6), gap: space(4) },
  agree: { textAlign: "center", fontSize: font.caption, color: colors.muted2, lineHeight: 18 },
});
