import { ActivityIndicator, StyleSheet, View } from "react-native";
import { Redirect } from "expo-router";
import { useAuth } from "@/lib/auth";
import { colors } from "@/theme";

/**
 * 启动分流。
 *
 * 读令牌是异步的（Keychain），所以先给一个安静的加载态——直接渲染登录页再跳走，
 * 会闪一下"刚打开就被踢出来"的错觉。
 */
export default function Index() {
  const { ready, userId, onboarded } = useAuth();

  if (!ready) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.brand} />
      </View>
    );
  }
  if (!userId) return <Redirect href="/login" />;
  // onboarded 未知（null）时先放行到主界面：首屏请求若被拦，会由
  // ONBOARDING_REQUIRED 回调把人送去向导，比在这里干等更顺
  if (onboarded === false) return <Redirect href="/onboarding" />;
  return <Redirect href="/(tabs)" />;
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.paper },
});
