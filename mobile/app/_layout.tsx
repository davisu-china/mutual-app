import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { AuthProvider } from "@/lib/auth";
import { ToastProvider } from "@/ui/feedback";
import { colors } from "@/theme";

/**
 * 根布局。
 *
 * 三件事都放在这里，是因为它们必须包住**所有**页面：
 *   - GestureHandlerRootView：拖拽弹层/滚轮都依赖它，少一层手势就全哑；
 *   - SafeAreaProvider：刘海/底部横条的安全区；
 *   - AuthProvider / ToastProvider：会话与全局提示。
 *
 * 默认 header 关掉：每个页面的标题栏都要按自己的内容排（比如聊天室要放对方头像），
 * 用系统默认导航栏会处处别扭。
 */
export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: colors.paper }}>
      <SafeAreaProvider>
        <AuthProvider>
          <ToastProvider>
            <StatusBar style="dark" />
            <Stack
              screenOptions={{
                headerShown: false,
                contentStyle: { backgroundColor: colors.paper },
                // 页面之间的推入用系统的左右滑动手感，别用淡入淡出——
                // 淡入淡出会让人分不清"我现在在哪一层"
                animation: "slide_from_right",
              }}
            />
          </ToastProvider>
        </AuthProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
