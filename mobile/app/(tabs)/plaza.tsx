import { useCallback, useEffect, useState } from "react";
import { Dimensions, FlatList, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { api } from "@/lib/api";
import { ProfileCard } from "@/components/profile-card";
import { Button } from "@/ui/button";
import { Sheet } from "@/ui/sheet";
import { Chip } from "@/ui/chip";
import { Empty, Skeleton, useToast } from "@/ui/feedback";
import { colors, font, radius, shadow, space } from "@/theme";
import { PROVINCE_NAMES, shortName } from "@/lib/data/regions";
import { plazaQuery, toggleProvince, type PlazaFilter } from "@/lib/plaza";
import type { Card } from "@/lib/types";

/** 筛选弹层最多占屏高这么多，超出的部分滚动——不加这个，34 个省标签会把面板顶出屏幕 */
const FILTER_MAX_H = Math.round(Dimensions.get("window").height * 0.62);

const AGE_BUCKETS: { label: string; min?: number; max?: number }[] = [
  { label: "不限" },
  { label: "18–25", min: 18, max: 25 },
  { label: "26–30", min: 26, max: 30 },
  { label: "31–35", min: 31, max: 35 },
  { label: "36–40", min: 36, max: 40 },
  { label: "40 以上", min: 40 },
];

const HEIGHT_BUCKETS: { label: string; min?: number; max?: number }[] = [
  { label: "不限" },
  { label: "155 以下", max: 155 },
  { label: "155–165", min: 155, max: 165 },
  { label: "165–175", min: 165, max: 175 },
  { label: "175–185", min: 175, max: 185 },
  { label: "185 以上", min: 185 },
];

const EDU = [
  { label: "不限", value: undefined },
  { label: "大专", value: 2 },
  { label: "本科", value: 3 },
  { label: "硕士", value: 4 },
  { label: "博士", value: 5 },
];

const INCOME_MIN = [
  { label: "不限", value: undefined },
  { label: "10 万以上", value: 2 },
  { label: "20 万以上", value: 3 },
  { label: "30 万以上", value: 4 },
  { label: "50 万以上", value: 5 },
];

/**
 * 恋爱广场。
 *
 * 筛选只留**能显著缩小范围**的条件：年龄、身高、学历、收入、省份（多选）。
 * 性别默认就是异性（后端硬过滤），所以没有必要再放一个筛选项。
 *
 * 分页是 **keyset 游标**（后端按 u.id 翻页，`nextCursor = 0` 表示到底了），
 * 不是 OFFSET——深分页时 OFFSET 会让 PG 扫掉并丢弃前 N 行。所以这里只需要
 * 拿着上一页的游标继续要，追加即可；换筛选条件时游标归零、整列表重取。
 */
export default function Plaza() {
  const nav = useRouter();
  const insets = useSafeAreaInsets();
  const toast = useToast();

  const [f, setF] = useState<PlazaFilter>({});
  const [open, setOpen] = useState(false);
  const [cards, setCards] = useState<Card[] | null>(null);
  /** 下一页的游标；0 = 没有更多了 */
  const [cursor, setCursor] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);

  const qs = plazaQuery(f);

  /**
   * 取一页。`next === 0` 是「从头来」（换筛选条件、首次进入），会清空列表；
   * 非 0 是「加载更多」，把新的一页接到后面。
   */
  const search = useCallback(
    async (next = 0) => {
      if (next) setLoadingMore(true);
      else setCards(null);
      try {
        const r = await api.get<{ cards: Card[]; nextCursor?: number }>(
          `/plaza?${qs}${next ? `&cursor=${next}` : ""}`
        );
        setCards((prev) => (next ? [...(prev ?? []), ...(r.cards ?? [])] : r.cards ?? []));
        setCursor(r.nextCursor ?? 0);
      } catch (e) {
        toast(e instanceof Error ? e.message : "检索失败", "error");
        // 加载更多失败时保留已有结果，别把用户已经看到的清掉
        setCards((prev) => (next ? prev : []));
      } finally {
        setLoadingMore(false);
      }
    },
    [qs, toast]
  );

  // qs 变了就整列表重取（search 的依赖里有 qs，所以换筛选会自然重置游标）
  useEffect(() => {
    void search(0);
  }, [search]);

  const activeCount =
    (f.ageMin !== undefined || f.ageMax !== undefined ? 1 : 0) +
    (f.heightMin !== undefined || f.heightMax !== undefined ? 1 : 0) +
    (f.education !== undefined ? 1 : 0) +
    (f.incomeMin !== undefined ? 1 : 0) +
    (f.provinces?.length ? 1 : 0);

  return (
    <View style={[styles.root, { paddingTop: insets.top + space(3) }]}>
      <View style={styles.header}>
        <View style={styles.titleRow}>
          <Ionicons name="storefront" size={19} color={colors.brand} />
          <Text style={styles.title}>恋爱广场</Text>
        </View>
        <Pressable
          onPress={() => setOpen(true)}
          style={[styles.filterBtn, activeCount > 0 && styles.filterBtnOn]}
          accessibilityLabel="筛选"
        >
          <Ionicons name="options-outline" size={14} color={activeCount > 0 ? colors.brand : colors.muted} />
          <Text style={[styles.filterText, activeCount > 0 && styles.filterTextOn]}>
            筛选{activeCount > 0 ? ` · ${activeCount}` : ""}
          </Text>
        </Pressable>
      </View>

      {cards === null ? (
        <View style={styles.grid}>
          {[0, 1, 2, 3].map((i) => (
            <View key={i} style={styles.cell}>
              <Skeleton height={220} />
            </View>
          ))}
        </View>
      ) : cards.length === 0 ? (
        <Empty
          icon="search-outline"
          title="没有找到符合条件的人"
          desc="试着放宽一些条件，比如去掉学历或收入的要求。"
          action={<Button label="清除筛选" variant="outline" onPress={() => setF({})} />}
        />
      ) : (
        <FlatList
          data={cards}
          numColumns={2}
          keyExtractor={(c) => String(c.userId)}
          columnWrapperStyle={{ gap: space(3) }}
          contentContainerStyle={{ padding: space(5), paddingBottom: space(10), gap: space(3) }}
          renderItem={({ item }) => (
            <Pressable style={styles.cell} onPress={() => nav.push(`/user/${item.userId}`)}>
              <View style={{ height: 240 }}>
                <ProfileCard card={item} compact />
              </View>
            </Pressable>
          )}
          // 用按钮而不是 onEndReached 自动续：游标到底时按钮消失，
          // 用户能看出"没有了"；自动续则会在快速滑动时连着打好几页
          ListFooterComponent={
            cursor > 0 ? (
              <View style={styles.moreWrap}>
                <Button label="加载更多" variant="outline" loading={loadingMore} onPress={() => void search(cursor)} />
              </View>
            ) : null
          }
        />
      )}

      {/* 筛选：底部弹层，只有能显著缩小范围的几项 */}
      <Sheet open={open} onClose={() => setOpen(false)} title="筛选" confirmText="完成" onConfirm={() => setOpen(false)}>
        {/* 内容比面板高时必须能滚：省份一格就有 34 个标签 */}
        <ScrollView style={{ maxHeight: FILTER_MAX_H }} contentContainerStyle={styles.filterBody} showsVerticalScrollIndicator={false}>
          <FilterGroup label="年龄" icon="calendar-outline">
            {AGE_BUCKETS.map((b) => {
              const on = f.ageMin === b.min && f.ageMax === b.max;
              return (
                <Chip
                  key={b.label}
                  label={b.label}
                  on={on}
                  onPress={() => setF({ ...f, ageMin: b.min, ageMax: b.max })}
                />
              );
            })}
          </FilterGroup>

          <FilterGroup label="身高" icon="resize-outline">
            {HEIGHT_BUCKETS.map((b) => {
              const on = f.heightMin === b.min && f.heightMax === b.max;
              return (
                <Chip
                  key={b.label}
                  label={b.label}
                  on={on}
                  onPress={() => setF({ ...f, heightMin: b.min, heightMax: b.max })}
                />
              );
            })}
          </FilterGroup>

          <FilterGroup label="学历" icon="school-outline">
            {EDU.map((e) => (
              <Chip key={e.label} label={e.label} on={f.education === e.value} onPress={() => setF({ ...f, education: e.value })} />
            ))}
          </FilterGroup>

          <FilterGroup label="年收入" icon="wallet-outline">
            {INCOME_MIN.map((i) => (
              <Chip key={i.label} label={i.label} on={f.incomeMin === i.value} onPress={() => setF({ ...f, incomeMin: i.value })} />
            ))}
          </FilterGroup>

          <FilterGroup
            label={f.provinces?.length ? `省份 · 已选 ${f.provinces.length}` : "省份"}
            icon="location-outline"
          >
            {PROVINCE_NAMES.map((name) => (
              <Chip
                key={name}
                // 显示用简称（浙江），存的是全名（浙江省）——后端按 city_prov 精确匹配
                label={shortName(name)}
                on={!!f.provinces?.includes(name)}
                onPress={() => setF(toggleProvince(f, name))}
              />
            ))}
          </FilterGroup>

          <Button label="清除全部筛选" variant="ghost" block onPress={() => setF({})} />
        </ScrollView>
      </Sheet>
    </View>
  );
}

function FilterGroup({
  label,
  icon,
  children,
}: {
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  children: React.ReactNode;
}) {
  return (
    <View style={{ marginBottom: space(5) }}>
      <View style={styles.groupHead}>
        <Ionicons name={icon} size={14} color={colors.muted2} />
        <Text style={styles.groupLabel}>{label}</Text>
      </View>
      <View style={styles.groupBody}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.paper },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: space(5), paddingBottom: space(3) },
  titleRow: { flexDirection: "row", alignItems: "center", gap: space(2) },
  title: { fontSize: 18, fontWeight: "700", letterSpacing: 0.2, color: colors.ink },
  filterBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: space(1.5),
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.line,
    paddingHorizontal: space(3),
    paddingVertical: space(1.5),
  },
  filterBtnOn: { borderColor: colors.brand, backgroundColor: colors.brandSoft },
  filterText: { fontSize: 13, color: colors.muted },
  filterTextOn: { color: colors.brand, fontWeight: "600" },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: space(3), padding: space(5) },
  cell: { width: "47.5%", borderRadius: radius.card, overflow: "hidden", ...shadow.card },
  filterBody: { paddingHorizontal: space(5), paddingTop: space(2), paddingBottom: space(4) },
  moreWrap: { paddingTop: space(2), paddingBottom: space(6), alignItems: "center" },
  groupHead: { flexDirection: "row", alignItems: "center", gap: space(1.5), marginBottom: space(2.5) },
  groupLabel: { fontSize: 13, color: colors.muted2 },
  groupBody: { flexDirection: "row", flexWrap: "wrap", gap: space(2) },
});
