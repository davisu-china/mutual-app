import { useCallback, useState } from "react";
import { FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { Image } from "expo-image";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { api, mediaImage } from "@/lib/api";
import { Button } from "@/ui/button";
import { Empty, Skeleton, useToast } from "@/ui/feedback";
import { colors, font, radius, shadow, space } from "@/theme";
import type { Conversation } from "@/lib/types";

/**
 * 消息列表。
 *
 * 每次回到这一页都重新拉一次（useFocusEffect）：刚在聊天室里说完话返回时，
 * 列表上的「最后一条」必须是新的，否则用户会以为没发出去。
 */
export default function ChatList() {
  const nav = useRouter();
  const insets = useSafeAreaInsets();
  const toast = useToast();
  const [list, setList] = useState<Conversation[] | null>(null);

  useFocusEffect(
    useCallback(() => {
      let alive = true;
      api
        .get<{ items: Conversation[] }>("/conversations")
        .then((r) => alive && setList(r.items ?? []))
        .catch((e) => {
          if (!alive) return;
          toast(e instanceof Error ? e.message : "加载失败", "error");
          setList([]);
        });
      return () => {
        alive = false;
      };
    }, [toast])
  );

  return (
    <View style={[styles.root, { paddingTop: insets.top + space(3) }]}>
      <View style={styles.header}>
        <Text style={styles.title}>消息</Text>
      </View>

      {list === null ? (
        <View style={{ padding: space(5), gap: space(3) }}>
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} height={68} />
          ))}
        </View>
      ) : list.length === 0 ? (
        <Empty
          icon="chatbubble-ellipses-outline"
          title="还没有聊天"
          desc="互相喜欢之后就会自动建立会话，来打个招呼吧。"
          action={<Button label="去划卡" variant="outline" onPress={() => nav.push("/(tabs)")} />}
        />
      ) : (
        <FlatList
          data={list}
          keyExtractor={(c) => String(c.id)}
          contentContainerStyle={{ paddingHorizontal: space(5), paddingBottom: space(10) }}
          ItemSeparatorComponent={() => <View style={{ height: space(2.5) }} />}
          renderItem={({ item }) => {
            const avatar = mediaImage(item.peerAvatar);
            return (
              <Pressable
                style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
                onPress={() => nav.push(`/chat/${item.id}`)}
              >
                {avatar ? (
                  <Image source={avatar} style={styles.avatar} contentFit="cover" transition={180} />
                ) : (
                  <View style={styles.avatar} />
                )}
                <View style={{ flex: 1 }}>
                  <View style={styles.rowTop}>
                    <Text style={styles.name} numberOfLines={1}>
                      {item.peerNickname}
                    </Text>
                    <Text style={styles.time}>{fmtTime(item.lastMessageAt)}</Text>
                  </View>
                  <View style={styles.rowBottom}>
                    <Text style={[styles.preview, item.unread > 0 && styles.previewUnread]} numberOfLines={1}>
                      {item.lastMessage || "你们已经配对，打个招呼吧"}
                    </Text>
                    {item.unread > 0 ? (
                      <View style={styles.badge}>
                        <Text style={styles.badgeText}>{item.unread > 99 ? "99+" : item.unread}</Text>
                      </View>
                    ) : null}
                  </View>
                </View>
              </Pressable>
            );
          }}
        />
      )}
    </View>
  );
}

/** 会话列表的时间按会话习惯简写：今天给时刻，昨天给「昨天」，更早给日期 */
function fmtTime(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  const yesterday = new Date(now.getTime() - 86400000);
  if (d.toDateString() === yesterday.toDateString()) return "昨天";
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.paper },
  header: { paddingHorizontal: space(5), paddingBottom: space(3) },
  title: { fontSize: 18, fontWeight: "700", letterSpacing: 0.2, color: colors.ink },
  row: { flexDirection: "row", alignItems: "center", gap: space(3), borderRadius: radius.card, backgroundColor: colors.surface, padding: space(3), ...shadow.card },
  rowPressed: { backgroundColor: colors.lineSoft },
  avatar: { width: 54, height: 54, borderRadius: 27, backgroundColor: colors.lineSoft },
  rowTop: { flexDirection: "row", alignItems: "baseline", justifyContent: "space-between", gap: space(2) },
  name: { flex: 1, fontSize: font.body, fontWeight: "600", color: colors.ink },
  time: { fontSize: 11.5, color: colors.muted2 },
  rowBottom: { marginTop: space(1), flexDirection: "row", alignItems: "center", gap: space(2) },
  preview: { flex: 1, fontSize: 13, color: colors.muted2 },
  previewUnread: { color: colors.ink, fontWeight: "500" },
  badge: { minWidth: 18, height: 18, borderRadius: 9, paddingHorizontal: 5, backgroundColor: colors.brand, alignItems: "center", justifyContent: "center" },
  badgeText: { color: colors.white, fontSize: 10, fontWeight: "700" },
});
