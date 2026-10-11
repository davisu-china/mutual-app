import { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import * as Clipboard from "expo-clipboard";
import * as SecureStore from "expo-secure-store";
import Ionicons from "@expo/vector-icons/Ionicons";
import { api } from "@/lib/api";
import { useToast } from "@/ui/feedback";
import { Sheet } from "@/ui/sheet";
import { colors, font, radius, space } from "@/theme";

/**
 * 「加我微信，直接提建议」。
 *
 * 两个落点，是刻意的：
 *   1. **注册完成后自动弹一次**（`app/onboarding.tsx`）——用户刚填完资料，是
 *      最容易对产品有话说、也最有耐心加个微信的时候；
 *   2. **「我的」页常驻一行**——真正的反馈往往发生在用的过程中（"这里怎么点不动"），
 *      那时候他不会再回到注册那一屏，得有个随时找得到的地方。
 *
 * 微信号由服务端给（`GET /support`）：联系方式会变，写死在客户端就得重新发版。
 * **没配就整个入口都不显示**——宁可没有，也别摆一个假的微信号。
 */

let cache: string | null | undefined; // undefined=还没问过, null=问过但没配, string=有
let inflight: Promise<string | null> | null = null;

/** 取客服微信号。空串/未配置 → null（调用方据此隐藏入口） */
export function loadSupportWechat(): Promise<string | null> {
  if (cache !== undefined) return Promise.resolve(cache);
  if (inflight) return inflight;
  inflight = api
    .get<{ wechat?: string }>("/support")
    .then((r) => {
      const v = (r.wechat ?? "").trim();
      cache = v === "" ? null : v;
      return cache;
    })
    .catch(() => null) // 拿不到就当没配：不能因为一个联系方式把页面搞挂
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

/** 组件里用：返回微信号（null = 还没拿到或没配） */
export function useSupportWechat(): string | null {
  const [v, setV] = useState<string | null>(cache ?? null);
  useEffect(() => {
    let alive = true;
    void loadSupportWechat().then((x) => alive && setV(x));
    return () => {
      alive = false;
    };
  }, []);
  return v;
}

// ---------------------------------------------------------------- 只弹一次

const SEEN_KEY = "support_prompt_seen_v1";

/**
 * 注册后那次提示"看过没有"。
 *
 * 存在本机（SecureStore）而不是服务端：这只是"别再自动弹了"，换个手机再弹一次
 * 也没什么损失，不值得为它在用户资料里加一位。Web 预览里 SecureStore 不可用，
 * 读写都失败——失败就当"没看过/记不住"，行为上等于每次都弹（能接受）。
 */
export async function supportPromptSeen(): Promise<boolean> {
  try {
    return (await SecureStore.getItemAsync(SEEN_KEY)) === "1";
  } catch {
    return false;
  }
}

export async function markSupportPromptSeen(): Promise<void> {
  try {
    await SecureStore.setItemAsync(SEEN_KEY, "1");
  } catch {
    /* 记不住就算了 */
  }
}

// ---------------------------------------------------------------- UI

/** 「我的」页里的那一行 */
export function SupportEntry({ onPress }: { onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.entry, pressed && styles.entryPressed]}>
      <Ionicons name="chatbubble-ellipses-outline" size={19} color={colors.brand} />
      <View style={styles.entryText}>
        <Text style={styles.entryLabel}>提建议 · 加我微信</Text>
        <Text style={styles.entryHint}>想要什么功能、哪里别扭，直接说</Text>
      </View>
      <Ionicons name="chevron-forward" size={17} color={colors.muted2} />
    </Pressable>
  );
}

/** 弹层本体：注册后自动弹的那次和「我的」里点开的是同一个 */
export function SupportSheet({ open, wechat, onClose }: { open: boolean; wechat: string; onClose: () => void }) {
  const toast = useToast();

  async function copy() {
    await Clipboard.setStringAsync(wechat);
    toast("微信号已复制，去微信里搜索添加");
    onClose();
  }

  return (
    <Sheet open={open} onClose={onClose} title="有问题随时找我">
      <View style={styles.body}>
        <Text style={styles.lede}>
          这是一个小团队做的产品，你的每条建议我们都会看。
          {"\n"}用着别扭的地方、想要的功能、遇到的 bug——加我微信直接说。
        </Text>

        <View style={styles.wechatBox}>
          <Text style={styles.wechatLabel}>我的微信</Text>
          <Text style={styles.wechat} selectable>
            {wechat}
          </Text>
        </View>

        <Pressable onPress={() => void copy()} style={styles.copyBtn} accessibilityRole="button">
          <Ionicons name="copy-outline" size={17} color={colors.white} />
          <Text style={styles.copyText}>复制微信号</Text>
        </Pressable>

        <Pressable onPress={onClose} style={styles.later} accessibilityRole="button">
          <Text style={styles.laterText}>以后再说</Text>
        </Pressable>
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  body: { paddingHorizontal: space(5), paddingBottom: space(4), gap: space(4) },
  lede: { fontSize: font.body, lineHeight: 24, color: colors.ink2 },

  wechatBox: {
    alignItems: "center",
    gap: space(1),
    borderRadius: radius.field,
    backgroundColor: colors.brandSoft,
    paddingVertical: space(4),
  },
  wechatLabel: { fontSize: font.caption, color: colors.brandDark },
  // 等宽 + 大字：微信号里常有字母数字，让人一眼看清、手输也不容易错
  wechat: { fontSize: font.title, fontWeight: "700", letterSpacing: 1, color: colors.brandDark },

  copyBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: space(2),
    borderRadius: 14,
    backgroundColor: colors.brand,
    paddingVertical: space(3.5),
  },
  copyText: { fontSize: font.body, fontWeight: "600", color: colors.white },
  later: { alignItems: "center", paddingVertical: space(1) },
  laterText: { fontSize: font.label, color: colors.muted2 },

  entry: {
    flexDirection: "row",
    alignItems: "center",
    gap: space(3),
    borderRadius: radius.card,
    backgroundColor: colors.surface,
    paddingHorizontal: space(4),
    paddingVertical: space(3.5),
  },
  entryPressed: { opacity: 0.7 },
  entryText: { flex: 1, gap: 2 },
  entryLabel: { fontSize: font.body, color: colors.ink },
  entryHint: { fontSize: font.caption, color: colors.muted2 },
});
