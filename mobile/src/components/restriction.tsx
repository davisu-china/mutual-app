import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { Button } from "@/ui/button";
import { Sheet } from "@/ui/sheet";
import { SupportSheet, useSupportWechat } from "@/components/support";
import { useAuth } from "@/lib/auth";
import { colors, font, radius, space } from "@/theme";

/**
 * 「账号被限制」的说明。
 *
 * 口径（2026-10-11 用户明确）：**ban 不是踢人**，是限制互动——不能喜欢别人、不能发消息，
 * 但推荐照看、消息照看、资料照改。所以这里是一条**横幅**而不是整屏遮罩：
 * 上一版把整个界面盖住了，等于把人踢出去，和产品口径正好相反。
 *
 * 横幅摆在"动作会失败"的两屏（推荐、消息）顶部；真正点到被拦的动作时，
 * 服务端会把话说明白（"账号被限制：暂时不能喜欢别人"），那一句直接弹 toast。
 */
export function RestrictionBanner() {
  const { restriction } = useAuth();
  const support = useSupportWechat();
  const [open, setOpen] = useState(false);
  const [supportOpen, setSupportOpen] = useState(false);

  if (!restriction) return null;

  return (
    <>
      <Pressable
        onPress={() => setOpen(true)}
        accessibilityRole="button"
        accessibilityLabel="账号被限制，查看原因"
        style={({ pressed }) => [styles.banner, pressed && styles.bannerPressed]}
      >
        <Ionicons name="alert-circle" size={16} color={colors.brandDark} />
        <Text style={styles.bannerText} numberOfLines={2}>
          账号被限制：暂时不能喜欢别人、不能发消息
        </Text>
        <Text style={styles.bannerMore}>详情</Text>
      </Pressable>

      <Sheet open={open} onClose={() => setOpen(false)} title="账号被限制">
        <View style={styles.body}>
          <Text style={styles.lede}>
            你的账号目前只能浏览：<Text style={styles.strong}>不能喜欢别人、不能发消息</Text>。
            {"\n"}看推荐、看消息、改资料都不受影响。
          </Text>

          {/* 管理员填的原因，原话展示，不加工 */}
          {restriction.reason ? (
            <View style={styles.reasonBox}>
              <Text style={styles.reasonLabel}>限制原因</Text>
              <Text style={styles.reason}>{restriction.reason}</Text>
            </View>
          ) : null}

          <Text style={styles.hint}>如果你觉得是误判、或已经按要求修改，可以联系客服申诉。</Text>

          {support ? <Button label="联系客服" variant="outline" block onPress={() => setSupportOpen(true)} /> : null}
          <Button label="知道了" block onPress={() => setOpen(false)} />
        </View>
      </Sheet>

      {support ? (
        <SupportSheet open={supportOpen} wechat={support} onClose={() => setSupportOpen(false)} />
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: "row",
    alignItems: "center",
    gap: space(2),
    marginHorizontal: space(5),
    marginBottom: space(2),
    borderRadius: radius.field,
    backgroundColor: colors.brandSoft,
    paddingHorizontal: space(3.5),
    paddingVertical: space(2.5),
  },
  bannerPressed: { opacity: 0.8 },
  bannerText: { flex: 1, fontSize: font.label, lineHeight: 18, color: colors.brandDark },
  bannerMore: { fontSize: font.label, fontWeight: "600", color: colors.brandDark },

  body: { paddingHorizontal: space(5), paddingBottom: space(4), gap: space(4) },
  lede: { fontSize: font.body, lineHeight: 24, color: colors.ink2 },
  strong: { fontWeight: "600", color: colors.ink },
  reasonBox: {
    gap: space(1),
    borderRadius: radius.field,
    backgroundColor: colors.brandSoft,
    paddingVertical: space(3),
    paddingHorizontal: space(4),
  },
  reasonLabel: { fontSize: font.caption, fontWeight: "600", color: colors.brandDark },
  reason: { fontSize: font.body, lineHeight: 22, color: colors.brandDark },
  hint: { fontSize: font.caption, lineHeight: 19, color: colors.muted2 },
});
