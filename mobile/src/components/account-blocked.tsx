import { useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { setAccountBlockedHandler, type AccountBlocked as BlockedInfo } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { Button } from "@/ui/button";
import { colors, font, radius, shadow, space } from "@/theme";

/**
 * 「账号已被封禁」的整屏说明。
 *
 * 为什么要有这一屏：封禁之后，后端会在**所有业务接口之前**拦下来
 * （中间件的 403），所以 App 里每一个页面都会开始报错。如果只是逐个 toast，
 * 用户看到的是"划不动、点不开、发不出去"的一堆怪现象，却不知道发生了什么。
 * 这里把管理员填的原因原话摆在最前面，并说明这里没得改、只能联系客服。
 *
 * 不做自动退出登录：一退出就回到登录页，理由也跟着消失了。
 * 让用户先看清楚，再自己决定要不要退。
 */
export function AccountBlockedScreen({ info, onSignOut }: { info: BlockedInfo; onSignOut: () => void }) {
  return (
    <View style={styles.root} accessibilityViewIsModal>
      <View style={styles.card}>
        <Ionicons name="alert-circle-outline" size={44} color={colors.brand} />
        <Text style={styles.title}>账号已被封禁</Text>
        <Text style={styles.desc}>该账号暂时无法登录和使用相悦。</Text>

        {/* 原因：管理员填的**原话**，不加工。没有原因时不编一个出来 */}
        {info.reason ? (
          <View style={styles.reasonBox}>
            <Text style={styles.reasonLabel}>封禁原因</Text>
            <Text style={styles.reason}>{info.reason}</Text>
          </View>
        ) : null}

        <Text style={styles.hint}>如果你觉得这是误判，或已按要求修改，可以联系客服申诉。</Text>
        <Button label="退出登录" variant="outline" block onPress={onSignOut} />
      </View>
    </View>
  );
}

/**
 * 把「被封禁」这件事接到 UI 上：任何接口返回 ACCOUNT_BANNED 都会把这一屏顶上来。
 * 挂在根布局里，盖住整个导航栈——它比当前页面更该被看到。
 */
export function AccountBlockedGate() {
  const { signOut } = useAuth();
  const [info, setInfo] = useState<BlockedInfo | null>(null);

  useEffect(() => {
    setAccountBlockedHandler((i) => setInfo(i));
    return () => setAccountBlockedHandler(() => {});
  }, []);

  if (!info) return null;
  return (
    <AccountBlockedScreen
      info={info}
      onSignOut={() => {
        setInfo(null);
        void signOut();
      }}
    />
  );
}

const styles = StyleSheet.create({
  // 绝对铺满：盖住导航栈，不给用户"再点点看"的机会
  root: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: colors.paper,
    alignItems: "center",
    justifyContent: "center",
    padding: space(8),
    zIndex: 100,
  },
  card: {
    width: "100%",
    maxWidth: 420,
    alignItems: "center",
    gap: space(3),
    borderRadius: radius.card,
    backgroundColor: colors.surface,
    paddingVertical: space(8),
    paddingHorizontal: space(6),
    ...shadow.card,
  },
  title: { fontSize: font.title, fontWeight: "700", color: colors.ink },
  desc: { fontSize: font.body, color: colors.muted, textAlign: "center" },
  reasonBox: {
    width: "100%",
    gap: space(1),
    borderRadius: radius.field,
    backgroundColor: colors.brandSoft,
    paddingVertical: space(3),
    paddingHorizontal: space(4),
  },
  reasonLabel: { fontSize: font.caption, fontWeight: "600", color: colors.brandDark },
  reason: { fontSize: font.body, lineHeight: 22, color: colors.brandDark },
  hint: { fontSize: font.caption, lineHeight: 19, color: colors.muted2, textAlign: "center" },
});
