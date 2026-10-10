import { useCallback, useEffect, useState } from "react";
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { Image } from "expo-image";
import { Ionicons } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { api, mediaImage } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { uploadPhoto } from "@/lib/upload";
import { Button } from "@/ui/button";
import { Sheet } from "@/ui/sheet";
import { Skeleton, useToast } from "@/ui/feedback";
import {
  DINK_LABEL,
  DRINKING_LABEL,
  EDUCATION_LABEL,
  ELDERCARE_LABEL,
  HOUSE_LABEL,
  INCOME_LABEL,
  SMOKING_LABEL,
} from "@/lib/labels";
import { colors, font, radius, shadow, space } from "@/theme";
import type { Profile } from "@/lib/types";

/**
 * 我的。
 *
 * 三块：顶部身份（头像/昵称/完整度）、相册（第 1 张＝头像与封面）、资料与入口。
 *
 * 相册这一块承担了「改封面」这件事——拖拽排序在 Web 上做了，这里先用
 * 「点照片 → 设为封面」的菜单式交互：手机上拖拽九宫格本来就不好点中，
 * 而且要跟页面的纵向滚动打架。
 */
export default function Me() {
  const nav = useRouter();
  const insets = useSafeAreaInsets();
  const toast = useToast();
  const { signOut } = useAuth();

  const [p, setP] = useState<Profile | null>(null);
  const [uploading, setUploading] = useState(false);
  /** 相册里被点开的那张照片的 id（null = 菜单没开） */
  const [menuPhotoId, setMenuPhotoId] = useState<number | null>(null);

  const load = useCallback(async () => {
    try {
      setP(await api.get<Profile>("/users/me"));
    } catch (e) {
      toast(e instanceof Error ? e.message : "加载失败", "error");
    }
  }, [toast]);

  // 从别的页面回来（例如刚改完资料/加了照片）要刷新，不能只在挂载时取一次
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  async function addPhotos() {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      toast("需要相册权限才能上传照片", "error");
      return;
    }
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      quality: 0.9,
      allowsMultipleSelection: true,
      selectionLimit: 9,
    });
    if (res.canceled) return;

    setUploading(true);
    try {
      for (const asset of res.assets) {
        await uploadPhoto(asset.uri, asset.mimeType ?? "image/jpeg");
      }
      await load();
      toast("照片已上传");
    } catch (e) {
      toast(e instanceof Error ? e.message : "上传失败", "error");
    } finally {
      setUploading(false);
    }
  }

  async function setCover(photoId: number) {
    if (!p?.photos) return;
    const ids = p.photos.map((x) => x.id);
    const next = [photoId, ...ids.filter((x) => x !== photoId)];
    try {
      await api.put("/users/me/photos/order", { orderedIds: next });
      await load();
      toast("已设为封面");
    } catch (e) {
      toast(e instanceof Error ? e.message : "设置失败", "error");
    }
  }

  async function deletePhoto(photoId: number) {
    try {
      await api.del(`/users/me/photos/${photoId}`);
      await load();
      // 删掉封面时服务端会把后面的顺序号往前收，所以封面会自动变成下一张
      toast("照片已删除");
    } catch (e) {
      toast(e instanceof Error ? e.message : "删除失败，请重试", "error");
    }
  }

  function confirmDeletePhoto() {
    const id = menuPhotoId;
    setMenuPhotoId(null);
    if (id === null) return;
    Alert.alert("删除这张照片？", "删掉之后不能恢复。", [
      { text: "取消", style: "cancel" },
      { text: "删除", style: "destructive", onPress: () => void deletePhoto(id) },
    ]);
  }

  const avatar = p ? mediaImage(p.avatarUrl) : null;
  const photoCount = p?.photos?.length ?? 0;

  return (
    <>
      <ScrollView
        style={styles.root}
        contentContainerStyle={{ paddingTop: insets.top + space(4), paddingBottom: space(12) }}
        showsVerticalScrollIndicator={false}
      >
        {/* 身份 */}
        <View style={styles.header}>
          <View style={styles.avatarWrap}>
            {avatar ? (
              <Image source={avatar} style={styles.avatar} contentFit="cover" transition={200} />
            ) : (
              <View style={[styles.avatar, styles.avatarEmpty]} />
            )}
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.nickname}>{p?.nickname ?? "—"}</Text>
            <View style={styles.metaRow}>
              <Text style={styles.meta}>
                {p?.age ?? "—"} 岁 · {p?.cityProvince ?? ""}
                {p?.city ?? ""}
              </Text>
            </View>
            <View style={styles.progressRow}>
              <View style={styles.progressTrack}>
                <View style={[styles.progressFill, { width: `${p?.completeness ?? 0}%` }]} />
              </View>
              <Text style={styles.progressText}>资料完成度 {p?.completeness ?? 0}%</Text>
            </View>
          </View>
        </View>

        {/* 相册：第 1 张就是头像与封面 */}
        <View style={styles.card}>
          <View style={styles.cardHead}>
            <Text style={styles.cardTitle}>我的相册</Text>
            <Text style={styles.cardHint}>第 1 张是封面 · 点一下可设为封面或删除</Text>
          </View>
          <View style={styles.grid}>
            {(p?.photos ?? []).map((photo, i) => {
              const src = mediaImage(photo.url);
              return (
                <Pressable
                  key={photo.id}
                  onPress={() => setMenuPhotoId(photo.id)}
                  onLongPress={() => setMenuPhotoId(photo.id)}
                  accessibilityLabel={`照片 ${i + 1}${i === 0 ? "（封面）" : ""}`}
                  style={styles.cell}
                >
                  {src ? <Image source={src} style={styles.cellImg} contentFit="cover" transition={160} /> : null}
                  {i === 0 ? (
                    <View style={styles.coverBadge}>
                      <Text style={styles.coverBadgeText}>封面</Text>
                    </View>
                  ) : null}
                </Pressable>
              );
            })}

            {(p?.photos?.length ?? 0) < 9 ? (
              <Pressable style={[styles.cell, styles.addCell]} onPress={() => void addPhotos()} disabled={uploading}>
                <Ionicons name={uploading ? "hourglass-outline" : "add"} size={22} color={colors.brand} />
                <Text style={styles.addText}>{uploading ? "上传中" : "添加"}</Text>
              </Pressable>
            ) : null}
          </View>
        </View>

        {/* 资料 */}
        <View style={styles.card}>
          <Text style={[styles.cardTitle, { marginBottom: space(3) }]}>基本资料</Text>
          {p === null ? (
            <Skeleton height={120} />
          ) : (
            <View style={styles.infoGrid}>
              <Info label="身高" value={`${p.heightCm} cm`} icon="resize-outline" />
              <Info label="体重" value={p.weightKg ? `${p.weightKg} kg` : "—"} icon="barbell-outline" />
              <Info label="职业" value={p.occupation || "—"} icon="briefcase-outline" />
              <Info label="学历" value={EDUCATION_LABEL(p.education)} icon="school-outline" />
              <Info label="学校" value={p.school || "—"} icon="library-outline" />
              <Info label="公司" value={p.company || "—"} icon="business-outline" />
              <Info label="MBTI" value={p.mbti ?? "—"} icon="sparkles-outline" />
              <Info label="年收入" value={INCOME_LABEL(p.incomeRange)} icon="wallet-outline" />
              <Info label="抽烟" value={SMOKING_LABEL(p.smoking)} icon="flame-outline" />
              <Info label="喝酒" value={DRINKING_LABEL(p.drinking)} icon="wine-outline" />
              <Info label="有房" value={HOUSE_LABEL(p.hasHouse)} icon="home-outline" />
              <Info label="丁克" value={DINK_LABEL(p.isDink)} icon="happy-outline" />
              <Info label="养老压力" value={ELDERCARE_LABEL(p.eldercarePressure)} icon="people-outline" />
            </View>
          )}
        </View>

        {/* 入口 */}
        <View style={styles.menu}>
          <MenuItem icon="create-outline" label="编辑资料与伴侣偏好" onPress={() => nav.push("/onboarding")} />
          <MenuItem icon="heart-outline" label="谁喜欢我 / 谁看过我" onPress={() => nav.push("/(tabs)/likes")} />
          <MenuItem icon="grid-outline" label="恋爱广场" onPress={() => nav.push("/(tabs)/plaza")} />
        </View>

        <View style={{ paddingHorizontal: space(5), marginTop: space(6) }}>
          <Button
            label="退出登录"
            variant="outline"
            block
            onPress={async () => {
              await signOut();
              nav.replace("/login");
            }}
          />
        </View>
      </ScrollView>

      <Sheet
        open={menuPhotoId !== null}
        onClose={() => setMenuPhotoId(null)}
        title="这张照片"
      >
        <View style={styles.sheetBody}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="设为封面"
            onPress={() => {
              const id = menuPhotoId;
              setMenuPhotoId(null);
              if (id !== null) void setCover(id);
            }}
            style={({ pressed }) => [styles.sheetRow, pressed && styles.menuPressed]}
          >
            <Ionicons name="image-outline" size={20} color={colors.ink} />
            <Text style={styles.menuLabel}>设为封面</Text>
          </Pressable>

          {/* 只剩一张时不给删除入口：服务端会直接拒（PHOTO_LAST_ONE），
              与其让用户点完再看报错，不如把入口收掉并说清楚 */}
          {photoCount > 1 ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="删除这张照片"
              onPress={confirmDeletePhoto}
              style={({ pressed }) => [styles.sheetRow, pressed && styles.menuPressed]}
            >
              <Ionicons name="trash-outline" size={20} color={colors.brand} />
              <Text style={[styles.menuLabel, { color: colors.brand }]}>删除</Text>
            </Pressable>
          ) : (
            <Text style={styles.sheetNote}>相册里至少保留一张照片，所以这张不能删。</Text>
          )}
        </View>
      </Sheet>
    </>
  );

}

function Info({ label, value, icon }: { label: string; value: string; icon: keyof typeof Ionicons.glyphMap }) {
  return (
    <View style={styles.infoItem}>
      <View style={styles.infoLabelRow}>
        <Ionicons name={icon} size={13} color={colors.muted2} />
        <Text style={styles.infoLabel}>{label}</Text>
      </View>
      <Text style={styles.infoValue} numberOfLines={1}>
        {value}
      </Text>
    </View>
  );
}

function MenuItem({ icon, label, onPress }: { icon: keyof typeof Ionicons.glyphMap; label: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.menuItem, pressed && styles.menuPressed]}>
      <Ionicons name={icon} size={19} color={colors.brand} />
      <Text style={styles.menuLabel}>{label}</Text>
      <Ionicons name="chevron-forward" size={17} color={colors.muted2} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.paper },
  header: { flexDirection: "row", gap: space(4), paddingHorizontal: space(5), marginBottom: space(5) },
  avatarWrap: { width: 72, height: 72, borderRadius: 36, overflow: "hidden", ...shadow.card },
  avatar: { width: 72, height: 72, borderRadius: 36, backgroundColor: colors.lineSoft },
  avatarEmpty: { backgroundColor: colors.lineSoft },
  nickname: { fontSize: 20, fontWeight: "700", color: colors.ink },
  metaRow: { marginTop: space(1) },
  meta: { fontSize: font.label, color: colors.muted2 },
  progressRow: { marginTop: space(2.5), gap: space(1.5) },
  progressTrack: { height: 5, borderRadius: 3, backgroundColor: colors.lineSoft, overflow: "hidden" },
  progressFill: { height: 5, borderRadius: 3, backgroundColor: colors.brand },
  progressText: { fontSize: 11, color: colors.muted2 },
  card: { marginHorizontal: space(5), marginBottom: space(4), borderRadius: radius.card, backgroundColor: colors.surface, padding: space(4), ...shadow.card },
  cardHead: { flexDirection: "row", alignItems: "baseline", justifyContent: "space-between", marginBottom: space(3) },
  cardTitle: { fontSize: font.section, fontWeight: "600", letterSpacing: 0.2, color: colors.ink },
  cardHint: { fontSize: 11, color: colors.muted2 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: space(1.5) },
  cell: { width: "31.5%", aspectRatio: 1, borderRadius: radius.sm, overflow: "hidden", backgroundColor: colors.lineSoft },
  cellImg: { width: "100%", height: "100%" },
  coverBadge: { position: "absolute", left: space(1), top: space(1), borderRadius: 6, backgroundColor: "rgba(26,21,18,.55)", paddingHorizontal: space(1.5), paddingVertical: 1 },
  coverBadgeText: { color: colors.white, fontSize: 9 },
  addCell: { alignItems: "center", justifyContent: "center", borderWidth: 1.5, borderStyle: "dashed", borderColor: colors.line, backgroundColor: "transparent", gap: 2 },
  addText: { fontSize: 11, color: colors.brand },
  sheetBody: { paddingHorizontal: space(5), paddingBottom: space(3), gap: space(2) },
  sheetRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: space(3),
    paddingVertical: space(3.5),
    paddingHorizontal: space(4),
    borderRadius: radius.field,
    backgroundColor: colors.paper,
  },
  sheetNote: { paddingHorizontal: space(2), fontSize: font.label, lineHeight: 20, color: colors.muted2 },
  infoGrid: { flexDirection: "row", flexWrap: "wrap", rowGap: space(3) },
  infoItem: { width: "50%" },
  infoLabelRow: { flexDirection: "row", alignItems: "center", gap: space(1.5) },
  infoLabel: { fontSize: 12, color: colors.muted2 },
  infoValue: { marginTop: 2, fontSize: 14.5, color: colors.ink },
  menu: { marginHorizontal: space(5), borderRadius: radius.card, backgroundColor: colors.surface, overflow: "hidden", ...shadow.card },
  menuItem: { flexDirection: "row", alignItems: "center", gap: space(3), paddingHorizontal: space(4), paddingVertical: space(3.5), borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.lineSoft },
  menuPressed: { backgroundColor: colors.lineSoft },
  menuLabel: { flex: 1, fontSize: font.body, color: colors.ink },
});
