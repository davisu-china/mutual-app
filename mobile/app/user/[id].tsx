import { useCallback, useEffect, useState } from "react";
import { Dimensions, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Image } from "expo-image";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { api, mediaImage } from "@/lib/api";
import { Button } from "@/ui/button";
import { Skeleton, useToast } from "@/ui/feedback";
import { UserActionsSheet } from "@/components/user-actions";
import { DINK_LABEL, DRINKING_LABEL, EDUCATION_LABEL, HOUSE_LABEL, INCOME_LABEL, SMOKING_LABEL } from "@/lib/labels";
import { colors, font, radius, shadow, space } from "@/theme";
import type { ActionResult, Profile } from "@/lib/types";

const SCREEN_W = Dimensions.get("window").width;

/**
 * TA 的主页。
 *
 * 主图区做成**横向分页的大图**（一次一张、可左右翻），而不是九宫格：
 * 看别人的第一眼应该是"人"而不是缩略图墙；缩略图留给对方自己管理相册时看。
 *
 * 底部操作条按关系渲染四种状态——已经配对的人不该再出现「喜欢」按钮，
 * 点下去只会重复"配对成功"提示，像没生效（之前就这么被发现的）。
 */
export default function UserDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const nav = useRouter();
  const insets = useSafeAreaInsets();
  const toast = useToast();

  const [p, setP] = useState<Profile | null | "error">(null);
  const [errMsg, setErrMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [page, setPage] = useState(0);
  const [actionsOpen, setActionsOpen] = useState(false);
  const [relOverride, setRelOverride] = useState<Profile["relation"]>(undefined);

  const load = useCallback(async () => {
    try {
      setP(await api.get<Profile>(`/users/${id}`));
    } catch (e) {
      // 把服务端的话原样带出来。拉黑是**双向阻断**的（PublicProfile 里
      // isBlocked 命中就报错），所以拉黑之后自己再点进来也是这条路——
      // 只写「看不到这个人的资料」会让人以为是网络问题。
      setErrMsg(e instanceof Error ? e.message : "");
      setP("error");
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  const profile = p && p !== "error" ? p : null;
  const rel = relOverride ?? profile?.relation;
  const photos = profile?.photos?.length ? profile.photos : [];
  const fallback = mediaImage(profile?.avatarUrl ?? "");

  async function act(action: "like" | "pass") {
    if (!profile || busy) return;
    setBusy(true);
    void Haptics.impactAsync(action === "like" ? Haptics.ImpactFeedbackStyle.Medium : Haptics.ImpactFeedbackStyle.Light);
    try {
      const res = await api.post<ActionResult>("/actions", { toUser: profile.userId, action, source: "plaza" });
      setRelOverride({
        liked: action === "like" || !!rel?.liked,
        passed: action === "pass" || !!rel?.passed,
        matched: res.matched || !!rel?.matched,
      });
      toast(res.matched ? `和 ${profile.nickname} 配对成功` : action === "like" ? "已表达喜欢" : "已跳过");
      if (!res.matched) setTimeout(() => nav.back(), 600);
    } catch (e) {
      toast(e instanceof Error ? e.message : "操作失败", "error");
    } finally {
      setBusy(false);
    }
  }

  if (p === "error") {
    return (
      <View style={[styles.center, { paddingTop: insets.top }]}>
        <Text style={styles.errText}>{errMsg || "看不到这个人的资料"}</Text>
        <Button label="返回" variant="outline" onPress={() => nav.back()} />
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: space(28) }}>
        {/* 主图：横向分页 */}
        <View style={{ height: SCREEN_W * 1.25 }}>
          {photos.length > 0 ? (
            <ScrollView
              horizontal
              pagingEnabled
              showsHorizontalScrollIndicator={false}
              onMomentumScrollEnd={(e) => setPage(Math.round(e.nativeEvent.contentOffset.x / SCREEN_W))}
            >
              {photos.map((ph) => {
                const src = mediaImage(ph.url);
                return (
                  <View key={ph.id} style={{ width: SCREEN_W, height: SCREEN_W * 1.25 }}>
                    {src ? <Image source={src} style={StyleSheet.absoluteFill} contentFit="cover" transition={200} /> : null}
                  </View>
                );
              })}
            </ScrollView>
          ) : fallback ? (
            <Image source={fallback} style={StyleSheet.absoluteFill} contentFit="cover" transition={200} />
          ) : (
            <Skeleton height={SCREEN_W * 1.25} />
          )}

          <Pressable style={[styles.backBtn, { top: insets.top + space(2) }]} onPress={() => nav.back()} accessibilityLabel="返回">
            <Ionicons name="chevron-back" size={22} color={colors.white} />
          </Pressable>

          {/* 举报 / 拉黑 / 解除配对都收在这里。放在对方主页而不是聊天室里，
              是因为这一页本来就是"和这个人的关系动作"的唯一去处（喜欢/跳过/
              去聊天也都在这一页的底部），聊天室的标题栏点一下也能到这里。 */}
          {profile ? (
            <Pressable
              style={[styles.moreBtn, { top: insets.top + space(2) }]}
              onPress={() => setActionsOpen(true)}
              accessibilityLabel="更多操作"
            >
              <Ionicons name="ellipsis-horizontal" size={20} color={colors.white} />
            </Pressable>
          ) : null}

          {photos.length > 1 ? (
            <View style={styles.dots}>
              {photos.map((ph, i) => (
                <View key={ph.id} style={[styles.dot, i === page && styles.dotOn]} />
              ))}
            </View>
          ) : null}
        </View>

        {/* 名字与基本信息 */}
        <View style={styles.intro}>
          <Text style={styles.name}>
            {profile?.nickname ?? "—"} <Text style={styles.age}>{profile?.age ?? ""}</Text>
          </Text>
          <Text style={styles.meta}>
            {profile?.heightCm}cm · {profile?.cityProvince}
            {profile?.city} · {profile ? EDUCATION_LABEL(profile.education) : ""}
          </Text>
        </View>

        {profile?.aboutMe ? (
          <Section title="关于我">
            <Text style={styles.paragraph}>{profile.aboutMe}</Text>
          </Section>
        ) : null}

        {profile?.hobbies?.length ? (
          <Section title="兴趣爱好">
            {profile.hobbies.map((h) => (
              <View key={h.name} style={styles.hobby}>
                <Text style={styles.hobbyName}>{h.name}</Text>
                <Text style={styles.hobbyDesc}>{h.description}</Text>
              </View>
            ))}
          </Section>
        ) : null}

        <Section title="基本资料">
          <View style={styles.infoGrid}>
            <Info label="职业" value={profile?.occupation || "—"} />
            <Info label="学历" value={EDUCATION_LABEL(profile?.education)} />
            {profile?.school ? <Info label="学校" value={profile.school} /> : null}
            {profile?.company ? <Info label="公司" value={profile.company} /> : null}
            <Info label="MBTI" value={profile?.mbti ?? "—"} />
            <Info label="抽烟" value={SMOKING_LABEL(profile?.smoking)} />
            <Info label="喝酒" value={DRINKING_LABEL(profile?.drinking)} />
            <Info label="年收入" value={INCOME_LABEL(profile?.incomeRange)} />
            <Info label="有房" value={HOUSE_LABEL(profile?.hasHouse)} />
            <Info label="丁克" value={DINK_LABEL(profile?.isDink)} />
          </View>
        </Section>

        {profile?.expectPartner ? (
          <Section title="期待的那个他 / 她">
            <Text style={styles.paragraph}>{profile.expectPartner}</Text>
          </Section>
        ) : null}
      </ScrollView>

      {/* 底部操作条：按关系渲染 */}
      <View style={[styles.actions, { paddingBottom: Math.max(insets.bottom, space(4)) }]}>
        {rel?.matched ? (
          <>
            <Text style={styles.relHint}>你们已经配对</Text>
            <Button label="去聊天" block={false} style={{ flex: 1 }} onPress={() => nav.push("/(tabs)/chat")} />
          </>
        ) : rel?.liked ? (
          <>
            <Text style={styles.relHint}>已喜欢，等 TA 回应</Text>
            <Button label="已喜欢" variant="outline" disabled onPress={() => {}} />
          </>
        ) : rel?.passed ? (
          <>
            <Text style={styles.relHint}>你之前跳过了 TA</Text>
            <Button label="已跳过" variant="outline" disabled onPress={() => {}} />
          </>
        ) : (
          <>
            <Button label="跳过" variant="outline" size="lg" style={{ flex: 1 }} disabled={busy || !profile} onPress={() => void act("pass")} />
            <Button label="喜欢" size="lg" style={{ flex: 1.4 }} loading={busy} disabled={!profile} onPress={() => void act("like")} />
          </>
        )}
      </View>

      {profile ? (
        <UserActionsSheet
          open={actionsOpen}
          onClose={() => setActionsOpen(false)}
          userId={profile.userId}
          nickname={profile.nickname}
          matched={rel?.matched}
          // 拉黑后这一页本身也会被服务端挡掉，原地待着只会看到错误态；
          // 解配后配对已不存在，留在页面上也没有意义。
          onBlocked={() => nav.back()}
          onUnmatched={() => nav.back()}
        />
      ) : null}
    </View>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {children}
    </View>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.infoItem}>
      <Text style={styles.infoLabel}>{label}</Text>
      <Text style={styles.infoValue} numberOfLines={1}>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.paper },
  center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.paper, gap: space(4) },
  errText: { fontSize: font.body, color: colors.muted },
  backBtn: {
    position: "absolute",
    left: space(4),
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "rgba(26,21,18,.35)",
    alignItems: "center",
    justifyContent: "center",
  },
  // 压在照片上的按钮，底色必须半透明深色——照片有可能是浅色的，
  // 纯白图标直接放上去会看不见
  moreBtn: {
    position: "absolute",
    right: space(4),
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "rgba(26,21,18,.35)",
    alignItems: "center",
    justifyContent: "center",
  },
  dots: { position: "absolute", bottom: space(3), left: 0, right: 0, flexDirection: "row", justifyContent: "center", gap: space(1.5) },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: "rgba(255,255,255,.45)" },
  dotOn: { backgroundColor: colors.white, width: 18 },
  intro: { paddingHorizontal: space(5), paddingTop: space(4) },
  name: { fontSize: 24, fontWeight: "700", color: colors.ink, letterSpacing: 0.2 },
  age: { fontSize: 18, fontWeight: "500", color: colors.muted },
  meta: { marginTop: space(1.5), fontSize: 13, color: colors.muted2 },
  section: { marginTop: space(6), paddingHorizontal: space(5) },
  sectionTitle: { fontSize: font.section, fontWeight: "600", letterSpacing: 0.2, color: colors.ink, marginBottom: space(3) },
  paragraph: { fontSize: 14.5, lineHeight: 24, color: colors.ink2 },
  hobby: { marginBottom: space(3) },
  hobbyName: { fontSize: 14, fontWeight: "600", color: colors.ink },
  hobbyDesc: { marginTop: 2, fontSize: 13.5, lineHeight: 21, color: colors.muted },
  infoGrid: { flexDirection: "row", flexWrap: "wrap", rowGap: space(3) },
  infoItem: { width: "50%" },
  infoLabel: { fontSize: 12, color: colors.muted2 },
  infoValue: { marginTop: 2, fontSize: 14.5, color: colors.ink },
  actions: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: space(3),
    paddingHorizontal: space(5),
    paddingTop: space(3),
    backgroundColor: colors.paper,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.line,
  },
  relHint: { flex: 1, fontSize: 14, color: colors.muted2 },
});
