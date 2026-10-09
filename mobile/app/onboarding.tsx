import { Linking, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ORIGIN } from "@/lib/api";
import { Button } from "@/ui/button";
import { colors, font, radius, shadow, space } from "@/theme";

/**
 * 资料向导（占位）。
 *
 * **这一屏还没做完，先如实告诉用户**，而不是给一个走不到底的半成品向导——
 * 那种"填了三步发现最后一步不能用"的体验比直接说清楚糟糕得多。
 *
 * 现在的做法：引导到网页版完成（两端同一个账号，资料互通），
 * 完成后再回 App 就一切正常。
 *
 * 待做（按优先级）：
 *   1. 本人画像（性别/生日滚轮/身高体重滚轮/家乡现居地 两级选择/职业 行业·岗位）
 *   2. 三个兴趣爱好 + 关于我
 *   3. 伴侣画像（区间用双滑块、省份多选）
 *   4. 期待的他 + 照片上传
 */
export default function Onboarding() {
  const nav = useRouter();
  const insets = useSafeAreaInsets();

  return (
    <View style={[styles.root, { paddingTop: insets.top + space(16) }]}>
      <View style={styles.card}>
        <View style={styles.badge}>
          <Ionicons name="construct-outline" size={26} color={colors.brand} />
        </View>
        <Text style={styles.title}>资料向导还在做</Text>
        <Text style={styles.desc}>
          App 里的资料向导（五步）正在开发中。你可以先在**网页版**把资料填完——
          两端是同一个账号，填完回到 App 就能正常划卡、聊天了。
        </Text>

        <Button
          label="打开网页版填写"
          block
          onPress={() => void Linking.openURL(ORIGIN)}
        />
        <Button label="先返回" variant="ghost" block onPress={() => nav.back()} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.paper, paddingHorizontal: space(6) },
  card: { borderRadius: radius.card, backgroundColor: colors.surface, padding: space(6), gap: space(4), ...shadow.card },
  badge: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.brandSoft,
    alignItems: "center",
    justifyContent: "center",
  },
  title: { fontSize: 20, fontWeight: "700", color: colors.ink },
  desc: { fontSize: 14.5, lineHeight: 23, color: colors.muted },
});
