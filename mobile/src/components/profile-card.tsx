import { StyleSheet, Text, View } from "react-native";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import { colors, font, overlayGradient, radius, shadow, space } from "@/theme";
import { mediaImage } from "@/lib/api";
import type { Card } from "@/lib/types";
import { EDUCATION_LABEL } from "@/lib/labels";

/**
 * 资料卡片 —— 划卡与广场共用，也是全 App 最该「有质感」的一屏。
 *
 * 设计上是**整图出血**：照片铺满整张卡，文字压在图上、只留一层从下往上的
 * 渐层做承载。上一版（Web）是"上面一张图 + 下面一块白底信息区"，看着像资料表；
 * 照片类产品的档次感来自让照片当主角。
 *
 * 性能上两件事：expo-image 自带磁盘缓存与淡入（弱网下不会白块乱跳）；
 * 卡片上的标签用半透明玻璃片而不是纯色块，压在照片上更干净。
 */
export function ProfileCard({ card, compact }: { card: Card; compact?: boolean }) {
  const source = mediaImage(card.photos?.[0] || card.avatarUrl);

  return (
    <View style={styles.card}>
      {source ? (
        <Image
          source={source}
          style={StyleSheet.absoluteFill}
          contentFit="cover"
          transition={220}
          cachePolicy="memory-disk"
        />
      ) : (
        <LinearGradient colors={[colors.brandSoft, colors.goldSoft]} style={StyleSheet.absoluteFill} />
      )}

      {/* 距离：右上角小圆标，压在照片上 */}
      {card.hasDistance ? (
        <View style={styles.distance}>
          <Ionicons name="location-sharp" size={10} color={colors.white} />
          <Text style={styles.distanceText}>{distanceText(card.distanceKm)}</Text>
        </View>
      ) : null}

      {/* 文字承载层 */}
      <LinearGradient
        colors={overlayGradient as unknown as [string, string, ...string[]]}
        locations={[0, 0.45, 1]}
        style={[styles.bottom, compact ? styles.bottomCompact : null]}
      >
        <Text style={[styles.name, compact && styles.nameCompact]} numberOfLines={1}>
          {card.nickname}
        </Text>
        <Text style={styles.meta} numberOfLines={1}>
          {card.age} 岁 · {card.city} · {card.heightCm}cm
        </Text>
        {card.occupation ? (
          <View style={styles.occupationRow}>
            <Ionicons name="briefcase-outline" size={12} color="rgba(255,255,255,.7)" />
            <Text style={styles.occupation} numberOfLines={1}>
              {card.occupation}
              {card.education ? ` · ${EDUCATION_LABEL(card.education)}` : ""}
            </Text>
          </View>
        ) : null}

        <View style={styles.tags}>
          {(card.hobbies ?? []).slice(0, 3).map((h) => (
            <View key={h} style={styles.tag}>
              <Text style={styles.tagText}>{h}</Text>
            </View>
          ))}
        </View>

        {card.softMismatch && card.softMismatch.length > 0 ? (
          <View style={styles.mismatch}>
            <Text style={styles.mismatchText}>部分条件不符</Text>
          </View>
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
  card: { flex: 1, overflow: "hidden", borderRadius: radius.card, backgroundColor: colors.lineSoft, ...shadow.card },
  distance: {
    position: "absolute",
    right: space(3),
    top: space(3),
    flexDirection: "row",
    alignItems: "center",
    gap: space(1),
    paddingHorizontal: space(2.5),
    paddingVertical: space(1),
    borderRadius: radius.pill,
    backgroundColor: "rgba(26,21,18,.45)",
  },
  distanceText: { color: colors.white, fontSize: 10 },
  bottom: { position: "absolute", left: 0, right: 0, bottom: 0, paddingHorizontal: space(4), paddingBottom: space(4), paddingTop: space(24) },
  bottomCompact: { paddingHorizontal: space(3.5), paddingBottom: space(3), paddingTop: space(16) },
  name: { color: colors.white, fontSize: 21, fontWeight: "700", letterSpacing: 0.2 },
  nameCompact: { fontSize: 17 },
  meta: { marginTop: space(1), color: "rgba(255,255,255,.86)", fontSize: 13 },
  occupationRow: { marginTop: space(1.5), flexDirection: "row", alignItems: "center", gap: space(1.5) },
  occupation: { color: "rgba(255,255,255,.7)", fontSize: 12, flexShrink: 1 },
  tags: { marginTop: space(2.5), flexDirection: "row", flexWrap: "wrap", gap: space(1.5) },
  tag: {
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,.22)",
    backgroundColor: "rgba(255,255,255,.16)",
    paddingHorizontal: space(2.5),
    paddingVertical: 3,
  },
  tagText: { color: colors.white, fontSize: 10.5, fontWeight: "500" },
  mismatch: { marginTop: space(2), alignSelf: "flex-start", borderRadius: radius.pill, backgroundColor: "rgba(168,118,62,.28)", paddingHorizontal: space(2.5), paddingVertical: 3 },
  mismatchText: { color: colors.goldSoft, fontSize: 10.5 },
});
