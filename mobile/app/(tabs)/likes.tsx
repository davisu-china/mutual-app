import { useCallback, useState } from "react";
import { FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { Image } from "expo-image";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { api, mediaImage } from "@/lib/api";
import { Button } from "@/ui/button";
import { Empty, Skeleton, useToast } from "@/ui/feedback";
import { colors, font, radius, shadow, space } from "@/theme";
import type { Interactor } from "@/lib/types";

type Tab = "likes" | "visits";

/**
 * 心动：谁喜欢我 / 谁看过我。
 *
 * 「回喜欢」是这个页面的一级动作——对方已经表达过兴趣，回应不该再多绕一步。
 * 但回 Like 会消耗每日额度（PRD 已定），所以顶部常驻剩余额度提示，
 * 免得用户点到第 8 个人才发现点不动了。
 */
export default function Likes() {
  const nav = useRouter();
  const insets = useSafeAreaInsets();
  const toast = useToast();

  const [tab, setTab] = useState<Tab>("likes");
  const [list, setList] = useState<Interactor[] | null>(null);
  const [quotaRemain, setQuotaRemain] = useState<number | null>(null);

  const load = useCallback(async () => {
    setList(null);
    try {
      if (tab === "likes") {
        const r = await api.get<{ items: Interactor[] }>("/likes-me");
        setList(r.items ?? []);
      } else {
        const r = await api.get<{ items: Interactor[] }>("/visits-me");
        setList(r.items ?? []);
      }
      const q = await api.get<{ remain: number }>("/quota");
      setQuotaRemain(q.remain);
    } catch (e) {
      toast(e instanceof Error ? e.message : "加载失败", "error");
      setList([]);
    }
  }, [tab, toast]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  async function likeBack(u: Interactor) {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    // 乐观移除：回应了就从列表里消失，不用等请求回来
    setList((prev) => (prev ? prev.filter((x) => x.userId !== u.userId) : prev));
    try {
      const res = await api.post<{ matched: boolean; quotaRemain: number }>("/actions", {
        toUser: u.userId,
        action: "like",
        source: "likes_me",
      });
      setQuotaRemain(res.quotaRemain);
      toast(res.matched ? `和 ${u.nickname} 配对成功` : "已表达喜欢");
    } catch (e) {
      void load();
      toast(e instanceof Error ? e.message : "操作失败", "error");
    }
  }

  async function pass(u: Interactor) {
    setList((prev) => (prev ? prev.filter((x) => x.userId !== u.userId) : prev));
    try {
      await api.post("/actions", { toUser: u.userId, action: "pass", source: "likes_me" });
    } catch {
      void load();
    }
  }

  return (
    <View style={[styles.root, { paddingTop: insets.top + space(3) }]}>
      <View style={styles.tabs}>
        <TabBtn on={tab === "likes"} icon="heart" label="喜欢我" onPress={() => setTab("likes")} />
        <TabBtn on={tab === "visits"} icon="eye" label="看过我" onPress={() => setTab("visits")} />
      </View>

      {tab === "likes" && quotaRemain !== null && quotaRemain <= 3 ? (
        <View style={styles.quotaHint}>
          <Text style={styles.quotaText}>
            回喜欢会消耗额度，今天还剩 <Text style={styles.quotaNum}>{quotaRemain}</Text> 次
          </Text>
        </View>
      ) : null}

      {list === null ? (
        <View style={{ padding: space(5), gap: space(3) }}>
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} height={72} />
          ))}
        </View>
      ) : list.length === 0 ? (
        <Empty
          icon={tab === "likes" ? "heart-outline" : "eye-outline"}
          title={tab === "likes" ? "还没有人喜欢你" : "还没有人看过你"}
          desc={
            tab === "likes"
              ? "完善资料、多上传几张照片，会明显提高被喜欢的概率。"
              : "去广场多露个脸，看的人自然就多了。"
          }
        />
      ) : (
        <FlatList
          data={list}
          keyExtractor={(x) => String(x.userId)}
          contentContainerStyle={{ padding: space(5), paddingBottom: space(10) }}
          ItemSeparatorComponent={() => <View style={{ height: space(3) }} />}
          renderItem={({ item }) => {
            const avatar = mediaImage(item.avatarUrl);
            return (
              <View style={styles.row}>
                <Pressable style={styles.rowMain} onPress={() => nav.push(`/user/${item.userId}`)}>
                  {avatar ? (
                    <Image source={avatar} style={styles.avatar} contentFit="cover" transition={180} />
                  ) : (
                    <View style={styles.avatar} />
                  )}
                  <View style={{ flex: 1 }}>
                    <Text style={styles.name}>{item.nickname}</Text>
                    <Text style={styles.sub} numberOfLines={1}>
                      {item.age} 岁 · {item.heightCm}cm · {item.cityCity}
                    </Text>
                    <Text style={styles.sub2} numberOfLines={1}>
                      {item.occupation}
                    </Text>
                  </View>
                </Pressable>

                <View style={styles.rowActions}>
                  <Button label="跳过" variant="outline" size="sm" onPress={() => void pass(item)} />
                  <Button label="回喜欢" size="sm" onPress={() => void likeBack(item)} />
                </View>
              </View>
            );
          }}
        />
      )}
    </View>
  );
}

function TabBtn({
  on,
  label,
  icon,
  onPress,
}: {
  on: boolean;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  onPress: () => void;
}) {
  return (
    <Pressable onPress={onPress} style={styles.tabBtn} accessibilityRole="tab" accessibilityState={{ selected: on }}>
      <View style={styles.tabInner}>
        <Ionicons name={icon} size={17} color={on ? colors.brand : colors.muted2} />
        <Text style={[styles.tabLabel, on && styles.tabLabelOn]}>{label}</Text>
      </View>
      <View style={[styles.tabUnderline, on && styles.tabUnderlineOn]} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.paper },
  tabs: { flexDirection: "row", gap: space(5), paddingHorizontal: space(5), borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.line },
  tabBtn: { alignItems: "center" },
  tabInner: { flexDirection: "row", alignItems: "center", gap: space(1.5), paddingBottom: space(2.5) },
  tabLabel: { fontSize: 14.5, color: colors.muted2 },
  tabLabelOn: { color: colors.brand, fontWeight: "700" },
  tabUnderline: { height: 2, width: "100%", borderRadius: 1, backgroundColor: "transparent" },
  tabUnderlineOn: { backgroundColor: colors.brand },
  quotaHint: { marginHorizontal: space(5), marginTop: space(3), borderRadius: radius.field, backgroundColor: colors.brandSoft, paddingHorizontal: space(3.5), paddingVertical: space(2.5) },
  quotaText: { fontSize: 12.5, color: colors.brand },
  quotaNum: { fontWeight: "700" },
  row: { flexDirection: "row", alignItems: "center", borderRadius: radius.card, backgroundColor: colors.surface, padding: space(3), gap: space(3), ...shadow.card },
  rowMain: { flex: 1, flexDirection: "row", alignItems: "center", gap: space(3) },
  avatar: { width: 52, height: 52, borderRadius: 26, backgroundColor: colors.lineSoft },
  name: { fontSize: font.body, fontWeight: "600", color: colors.ink },
  sub: { marginTop: 2, fontSize: 12, color: colors.muted2 },
  sub2: { marginTop: 1, fontSize: 11.5, color: colors.muted2 },
  rowActions: { gap: space(1.5) },
});
