import { ScrollView, StyleSheet, Text, View } from "react-native";
import { Image } from "expo-image";
import { Ionicons } from "@expo/vector-icons";
import { mediaImage } from "@/lib/api";
import { colors, radius, shadow, space } from "@/theme";
import { EDUCATION_LABEL } from "@/lib/labels";
import type { Card } from "@/lib/types";

/**
 * 推荐页的卡片。
 *
 * 与广场/心动共用的 `ProfileCard` 分开，因为这一屏要多说一件事：
 * **为什么给你看这个人**。
 *
 * 版面分成两段（借鉴自主流推荐页的做法）：
 *   上半是照片，整图出血 + 底部渐层压字——我们原本的强项，保留；
 *   下半是信息区，回答"匹配在哪"：契合点、TA 符合你的哪些偏好、共同兴趣、
 *   以及 TA 自己写的那段话（当成引用展示）。
 *
 * 为什么下半段值得占这么大地方：只看一张脸就让人左滑右滑，用户其实是在盲选。
 * 把"契合点"摆出来（而且是真的算出来的，不是文案），一次划卡才是一个有依据的决定。
 * 这一屏原本的问题是它只说了"她是谁"，没回答"为什么是她"。
 *
 * ⚠️ 配色**没有照搬**参考图那套粉紫渐变：借的是结构，视觉仍然是本项目的
 * 深酒红 + 象牙白 + 香槟金（见 theme）。
 */
export function RecommendCard({ card }: { card: Card }) {
  const source = mediaImage(card.photos?.[0] || card.avatarUrl);
  const reasons = card.reasons ?? [];
  const shared = card.sharedHobbies ?? [];
  const matchTotal = reasons.length + shared.length;

  return (
    <View style={styles.card}>
      {/* ---- 照片区 ---- */}
      <View style={styles.photo}>
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

        <View style={styles.photoOverlay}>
          {/* 名字和年龄并排但要**两个 Text**：嵌套会拼成一个文本节点，
              屏幕阅读器读起来没事，但测试和 a11y 查询就再也单独定位不到名字了 */}
          <View style={styles.nameRow}>
            <Text style={styles.name} numberOfLines={1}>
              {card.nickname}
            </Text>
            <Text style={styles.age}>{card.age}</Text>
          </View>
          <Text style={styles.meta} numberOfLines={1}>
            {card.heightCm}cm · {card.cityProvince || card.city}
            {card.city && card.city !== card.cityProvince ? ` ${card.city}` : ""} · {EDUCATION_LABEL(card.education)}
          </Text>
          {card.occupation ? (
            <View style={styles.occupationRow}>
              <Ionicons name="briefcase-outline" size={12} color="rgba(255,255,255,.7)" />
              <Text style={styles.occupation} numberOfLines={1}>
                {card.occupation}
              </Text>
            </View>
          ) : null}
        </View>
      </View>

      {/* ---- 信息区：为什么推荐给你 ---- */}
      <ScrollView style={styles.panel} contentContainerStyle={styles.panelBody} nestedScrollEnabled showsVerticalScrollIndicator={false}>
        {matchTotal > 0 ? (
          <View style={styles.matchHead}>
            <Text style={styles.matchLabel}>契合点</Text>
            <Text style={styles.matchCount}>{matchTotal}</Text>
            <Text style={styles.matchUnit}>个</Text>
          </View>
        ) : (
          <Text style={styles.matchEmpty}>你们还没有共同点标记——多填几项偏好，推荐会更有依据。</Text>
        )}

        {reasons.length > 0 ? (
          <Group label={`TA 符合你的 ${reasons.length} 个偏好`} tone="brand">
            {reasons.map((r) => (
              <Pill key={r} label={r} tone="brand" />
            ))}
          </Group>
        ) : null}

        {shared.length > 0 ? (
          <Group label="你们的共同兴趣" tone="gold">
            {shared.map((h) => (
              <Pill key={h} label={h} tone="gold" />
            ))}
          </Group>
        ) : null}

        {card.aboutMe ? (
          <View style={styles.quote}>
            <Text style={styles.quoteMark}>「</Text>
            <Text style={styles.quoteText}>{card.aboutMe}</Text>
          </View>
        ) : null}

        {card.hobbies?.length ? (
          <Group label="TA 的兴趣" tone="plain">
            {card.hobbies.map((h) => (
              <Pill key={h} label={h} tone="plain" />
            ))}
          </Group>
        ) : null}

        {card.softMismatch?.length ? (
          <View style={styles.mismatch}>
            <Ionicons name="alert-circle-outline" size={13} color={colors.gold} />
            <Text style={styles.mismatchText}>部分条件不符：{card.softMismatch.join("、")}</Text>
          </View>
        ) : null}
      </ScrollView>
    </View>
  );
}

function Group({ label, tone, children }: { label: string; tone: "brand" | "gold" | "plain"; children: React.ReactNode }) {
  return (
    <View style={styles.group}>
      <View style={styles.groupHead}>
        <View style={[styles.groupDot, { backgroundColor: tone === "gold" ? colors.gold : tone === "brand" ? colors.brand : colors.line }]} />
        <Text style={styles.groupLabel}>{label}</Text>
      </View>
      <View style={styles.pills}>{children}</View>
    </View>
  );
}

function Pill({ label, tone }: { label: string; tone: "brand" | "gold" | "plain" }) {
  return (
    <View style={[styles.pill, tone === "brand" && styles.pillBrand, tone === "gold" && styles.pillGold]}>
      <Text style={[styles.pillText, tone === "brand" && styles.pillTextBrand, tone === "gold" && styles.pillTextGold]}>{label}</Text>
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
  card: { flex: 1, overflow: "hidden", borderRadius: radius.card, backgroundColor: colors.surface, ...shadow.card },

  // 照片占上面一半多一点，剩下的留给信息区
  photo: { height: "54%", backgroundColor: colors.lineSoft },
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
  photoOverlay: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: space(4),
    paddingBottom: space(3),
    paddingTop: space(16),
  },
  nameRow: { flexDirection: "row", alignItems: "baseline", gap: space(2) },
  name: { flexShrink: 1, color: colors.white, fontSize: 23, fontWeight: "700", letterSpacing: 0.2 },
  age: { fontSize: 17, fontWeight: "500", color: "rgba(255,255,255,.9)" },
  meta: { marginTop: space(1), color: "rgba(255,255,255,.86)", fontSize: 12.5 },
  occupationRow: { marginTop: space(1.5), flexDirection: "row", alignItems: "center", gap: space(1.5) },
  occupation: { color: "rgba(255,255,255,.7)", fontSize: 11.5, flexShrink: 1 },

  // 信息区在浅色面上：这里读的是"为什么"，所以留白和字号都要够看
  panel: { flex: 1, backgroundColor: colors.surface },
  panelBody: { paddingHorizontal: space(4.5), paddingTop: space(3.5), paddingBottom: space(4), gap: space(3.5) },

  matchHead: { flexDirection: "row", alignItems: "baseline", gap: space(1.5) },
  matchLabel: { fontSize: 15, color: colors.muted },
  matchCount: { fontSize: 26, fontWeight: "800", color: colors.brand, fontVariant: ["tabular-nums"] },
  matchUnit: { fontSize: 13, color: colors.muted2 },
  matchEmpty: { fontSize: 12.5, lineHeight: 19, color: colors.muted2 },

  group: { gap: space(2) },
  groupHead: { flexDirection: "row", alignItems: "center", gap: space(1.5) },
  groupDot: { width: 5, height: 5, borderRadius: 2.5 },
  groupLabel: { fontSize: 12.5, color: colors.muted },
  pills: { flexDirection: "row", flexWrap: "wrap", gap: space(1.5) },
  pill: {
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.line,
    paddingHorizontal: space(2.5),
    paddingVertical: space(1),
  },
  pillBrand: { borderColor: colors.brandLine, backgroundColor: colors.brandSoft },
  pillGold: { borderColor: colors.goldLine, backgroundColor: colors.goldSoft },
  pillText: { fontSize: 12, color: colors.ink2 },
  pillTextBrand: { color: colors.brandDark, fontWeight: "500" },
  pillTextGold: { color: colors.gold, fontWeight: "500" },

  quote: { flexDirection: "row", gap: space(1.5) },
  quoteMark: { fontSize: 20, lineHeight: 24, color: colors.goldLine, fontWeight: "700" },
  quoteText: { flex: 1, fontSize: 13, lineHeight: 21, color: colors.ink2 },

  mismatch: { flexDirection: "row", alignItems: "center", gap: space(1.5) },
  mismatchText: { flex: 1, fontSize: 11.5, lineHeight: 17, color: colors.gold },
});
