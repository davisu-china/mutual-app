import { StyleSheet, Text, View } from "react-native";
import { Image } from "expo-image";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { mediaImage } from "@/lib/api";
import { colors, radius, shadow, space } from "@/theme";
import { EDUCATION_LABEL } from "@/lib/labels";
import type { Card } from "@/lib/types";

/**
 * 推荐页的卡片：**照片铺满整张卡**，信息压在照片下缘的渐层上。
 *
 * 上一版把卡片切成"上面照片 54% + 下面一块白底信息区"，看着像一篇图文长条，
 * 不像一张可以划的卡——照片也不当主角了。现在回到整图出血（这本来就是
 * 我们原本的做法），信息用渐层承载压在上面。
 *
 * "契合点"那一块保留，但改成**紧凑的浮层**：一行标题 + 几个标签 + 两行引用。
 * ⚠️ 这里**刻意不做滚动**：卡片里套一个纵向滚动区会和外层的滑动手势抢手势，
 * 加了 failOffsetY 去挡又会让横向滑动时不时判负（上一版就是这么坏的）。
 * 内容超长一律截断——划卡这一屏要的是"一眼看懂"，不是读完。
 *
 * 按钮不在这里：它们由页面渲染在**手势之外**（见 app/(tabs)/index.tsx），
 * 视觉上仍然浮在这张卡上。原因见那边的注释。
 */
export function RecommendCard({ card }: { card: Card }) {
  const source = mediaImage(card.photos?.[0] || card.avatarUrl);
  const reasons = card.reasons ?? [];
  const shared = card.sharedHobbies ?? [];
  const matchTotal = reasons.length + shared.length;
  // 只显示前几个：这一屏是"扫一眼"，不是看清单。剩下的在对方主页里
  const topTags = [...shared.map((h) => ({ label: h, gold: true })), ...reasons.map((r) => ({ label: r, gold: false }))].slice(0, 4);

  return (
    <View style={styles.card}>
      {source ? (
        <Image source={source} style={StyleSheet.absoluteFill} contentFit="cover" transition={220} cachePolicy="memory-disk" />
      ) : (
        <View style={[StyleSheet.absoluteFill, { backgroundColor: colors.lineSoft }]} />
      )}

      {card.hasDistance ? (
        <View style={styles.distance}>
          <Ionicons name="location-sharp" size={10} color={colors.white} />
          <Text style={styles.distanceText}>{distanceText(card.distanceKm)}</Text>
        </View>
      ) : null}

      {/* 从下往上的渐层：文字要在任何照片上都读得清。用 theme 里那一套，别自己调 */}
      <LinearGradient
        colors={["transparent", "rgba(26,21,18,.38)", "rgba(26,21,18,.94)"]}
        locations={[0, 0.42, 1]}
        style={styles.scrim}
      >
        <View style={styles.nameRow}>
          <Text style={styles.name} numberOfLines={1}>
            {card.nickname}
          </Text>
          <Text style={styles.age}>{card.age}</Text>
        </View>
        <Text style={styles.meta} numberOfLines={1}>
          {card.heightCm}cm · {card.cityProvince || card.city}
          {card.city && card.city !== card.cityProvince ? ` ${card.city}` : ""} · {EDUCATION_LABEL(card.education)}
          {card.occupation ? ` · ${card.occupation}` : ""}
        </Text>

        {matchTotal > 0 ? (
          <View style={styles.matchRow}>
            <Text style={styles.matchLabel}>契合点</Text>
            <Text style={styles.matchCount}>{matchTotal}</Text>
            <View style={styles.matchTags}>
              {topTags.map((t) => (
                <View key={t.label} style={[styles.tag, t.gold && styles.tagGold]}>
                  <Text style={styles.tagText}>{t.label}</Text>
                </View>
              ))}
            </View>
          </View>
        ) : null}

        {/* 自述压成两行。这一段比一串标签更能让人做决定，但也最容易长 */}
        {card.aboutMe ? (
          <Text style={styles.quote} numberOfLines={2}>
            {card.aboutMe}
          </Text>
        ) : null}
      </LinearGradient>
    </View>
  );
}

/** 距离按区间展示，不给精确值——既诚实，也保护隐私（PRD 第 15 章） */
function distanceText(km: number): string {
  if (km <= 1) return "1 km 内";
  if (km <= 3) return "1–3 km";
  if (km <= 5) return "3–5 km";
  if (km <= 10) return "5–10 km";
  if (km <= 50) return `${Math.round(km / 10) * 10} km 左右`;
  return "50 km 以上";
}

const styles = StyleSheet.create({
  // 照片铺满整张卡；圆角只在最外层裁一次
  card: { flex: 1, overflow: "hidden", borderRadius: radius.card, backgroundColor: colors.lineSoft, ...shadow.card },
  distance: {
    position: "absolute",
    right: space(4),
    top: space(4),
    flexDirection: "row",
    alignItems: "center",
    gap: space(1),
    paddingHorizontal: space(2.5),
    paddingVertical: space(1),
    borderRadius: radius.pill,
    backgroundColor: "rgba(26,21,18,.45)",
  },
  distanceText: { color: colors.white, fontSize: 10 },

  // 底部渐层承载全部文字。paddingBottom 留出按钮的位置（按钮由页面浮在上面）
  scrim: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: space(5),
    paddingBottom: space(28),
    paddingTop: space(24),
    gap: space(2),
  },
  nameRow: { flexDirection: "row", alignItems: "baseline", gap: space(2) },
  name: { flexShrink: 1, color: colors.white, fontSize: 25, fontWeight: "700", letterSpacing: 0.2 },
  age: { fontSize: 18, fontWeight: "500", color: "rgba(255,255,255,.92)" },
  meta: { color: "rgba(255,255,255,.82)", fontSize: 12.5 },

  matchRow: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: space(2), marginTop: space(1) },
  matchLabel: { color: "rgba(255,255,255,.72)", fontSize: 12.5 },
  matchCount: { color: colors.goldSoft, fontSize: 17, fontWeight: "800", fontVariant: ["tabular-nums"] },
  matchTags: { flexDirection: "row", flexWrap: "wrap", gap: space(1.5), flexShrink: 1 },
  // 压在照片上，所以用半透明玻璃片而不是实心底（和整图出血的卡片同一套做法）
  tag: {
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,.3)",
    backgroundColor: "rgba(255,255,255,.16)",
    paddingHorizontal: space(2.5),
    paddingVertical: 3,
  },
  tagGold: { borderColor: "rgba(230,214,190,.55)", backgroundColor: "rgba(168,118,62,.28)" },
  tagText: { color: colors.white, fontSize: 10.5, fontWeight: "500" },

  quote: { marginTop: space(1), color: "rgba(255,255,255,.78)", fontSize: 12.5, lineHeight: 19 },
});
