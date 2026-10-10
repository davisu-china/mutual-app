import { useState } from "react";
import { Alert, Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { api } from "@/lib/api";
import { Sheet } from "@/ui/sheet";
import { Chip } from "@/ui/chip";
import { Textarea } from "@/ui/textarea";
import { useToast } from "@/ui/feedback";
import { colors, font, radius, space } from "@/theme";
import { REPORT_DETAIL_MAX, REPORT_REASONS, type ReportReason } from "@/lib/report";

const errText = (e: unknown, fallback: string) => (e instanceof Error ? e.message : fallback);

/**
 * 对方主页右上角「⋯」里的三个动作：举报 / 拉黑 / 解除配对。
 *
 * 三个都是「不可轻易撤回」的操作，所以都走原生 `Alert` 二次确认，而不是自己画
 * 一个确认弹层——系统弹窗在两端都是用户下意识认为"这一步真的会生效"的样子。
 * 选择类操作（选举报理由）仍用项目统一的底部弹层。
 *
 * 后端语义（都读自 server/internal/service/action.go，别凭直觉改文案）：
 *   - `Block` 是**幂等**的，会让匹配状态变 blocked、会话变 frozen；
 *   - `Unmatch` 把匹配标记为 unmatched、会话转**只读**（历史消息仍可查）；
 *   - `Unblock` **只删黑名单行，不恢复匹配和会话** —— 所以拉黑时文案要如实
 *     说"配对不会恢复"，而不是留一个做不到的"可以取消"。
 */
export function UserActionsSheet({
  open,
  onClose,
  userId,
  nickname,
  matched,
  onBlocked,
  onUnmatched,
}: {
  open: boolean;
  onClose: () => void;
  userId: number;
  nickname: string;
  /** 已配对时才显示「解除配对」 */
  matched?: boolean;
  onBlocked: () => void;
  onUnmatched: () => void;
}) {
  const toast = useToast();
  const [reportOpen, setReportOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  function confirmBlock() {
    Alert.alert(
      `拉黑 ${nickname}？`,
      "拉黑后 TA 不会再出现在你的推荐里，你们的配对和聊天会失效——配对无法恢复。",
      [
        { text: "取消", style: "cancel" },
        { text: "拉黑", style: "destructive", onPress: () => void doBlock() },
      ]
    );
  }

  async function doBlock() {
    setBusy(true);
    try {
      await api.post("/blocks", { targetUser: userId });
      onClose();
      toast(`已拉黑 ${nickname}`);
      onBlocked();
    } catch (e) {
      toast(errText(e, "拉黑失败，请重试"), "error");
    } finally {
      setBusy(false);
    }
  }

  function confirmUnmatch() {
    Alert.alert(
      `解除和 ${nickname} 的配对？`,
      "会话会变成只读，聊天记录还留着，但不能再发消息。",
      [
        { text: "取消", style: "cancel" },
        { text: "解除配对", style: "destructive", onPress: () => void doUnmatch() },
      ]
    );
  }

  async function doUnmatch() {
    setBusy(true);
    try {
      // 对方主页只带回 relation.matched，没有 matchId；解配接口要的是 matchId，
      // 所以按需查一次配对列表再按 userId 找回来。多一次请求，但只在真的点
      // 解配时才发生。
      const r = await api.get<{ items: { userId: number; matchId?: number }[] }>("/matches");
      const hit = (r.items ?? []).find((x) => x.userId === userId);
      if (!hit?.matchId) throw new Error("找不到这条配对");
      await api.del(`/matches/${hit.matchId}`);
      onClose();
      toast(`已和 ${nickname} 解除配对`);
      onUnmatched();
    } catch (e) {
      toast(errText(e, "解除失败，请重试"), "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Sheet open={open} onClose={onClose} title={`对 ${nickname} 的操作`}>
        <View style={styles.body}>
          <Row
            icon="flag-outline"
            label="举报"
            hint="色情、诈骗、骚扰等"
            disabled={busy}
            onPress={() => {
              onClose();
              // 等第一个弹层收完再开第二个，否则两个 Modal 会叠在一起
              setTimeout(() => setReportOpen(true), 260);
            }}
          />
          <Row
            icon="ban-outline"
            label="拉黑"
            hint="不再出现在推荐里，配对与聊天失效"
            tone="danger"
            disabled={busy}
            onPress={confirmBlock}
          />
          {matched ? (
            <Row
              icon="heart-dislike-outline"
              label="解除配对"
              hint="会话转为只读，聊天记录保留"
              tone="danger"
              disabled={busy}
              onPress={confirmUnmatch}
            />
          ) : null}
        </View>
      </Sheet>

      <ReportSheet
        open={reportOpen}
        onClose={() => setReportOpen(false)}
        userId={userId}
        nickname={nickname}
      />
    </>
  );
}

/** 一行动作。danger 只是把图标和文字染成主色，不填红底——弹层里整块红底会显得很吵 */
function Row({
  icon,
  label,
  hint,
  tone,
  disabled,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  hint?: string;
  tone?: "danger";
  disabled?: boolean;
  onPress: () => void;
}) {
  const tint = tone === "danger" ? colors.brand : colors.ink;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled }}
      disabled={disabled}
      onPress={() => {
        void Haptics.selectionAsync();
        onPress();
      }}
      style={({ pressed }) => [styles.row, pressed && styles.rowPressed, disabled && styles.rowOff]}
    >
      <Ionicons name={icon} size={20} color={tint} />
      <View style={{ flex: 1 }}>
        <Text style={[styles.rowLabel, { color: tint }]}>{label}</Text>
        {hint ? <Text style={styles.rowHint}>{hint}</Text> : null}
      </View>
      <Ionicons name="chevron-forward" size={16} color={colors.muted2} />
    </Pressable>
  );
}

/** 举报表单：选一个理由 + 可选补充说明 */
function ReportSheet({
  open,
  onClose,
  userId,
  nickname,
}: {
  open: boolean;
  onClose: () => void;
  userId: number;
  nickname: string;
}) {
  const toast = useToast();
  const [reason, setReason] = useState<ReportReason | null>(null);
  const [detail, setDetail] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (!reason || busy) return;
    setBusy(true);
    try {
      await api.post("/reports", {
        targetUser: userId,
        targetType: "user",
        reason,
        // detail 为空就不要传空串：服务端把 "" 当作没有补充说明
        detail: detail.trim() ? detail.trim() : undefined,
      });
      onClose();
      setReason(null);
      setDetail("");
      toast("举报已提交，我们会尽快处理");
    } catch (e) {
      toast(errText(e, "提交失败，请重试"), "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet open={open} onClose={onClose} title={`举报 ${nickname}`}>
      <View style={styles.body}>
        <Text style={styles.groupLabel}>请选择理由</Text>
        <View style={styles.wrap}>
          {REPORT_REASONS.map((r) => (
            <Chip key={r.value} label={r.label} on={reason === r.value} onPress={() => setReason(r.value)} />
          ))}
        </View>

        <Textarea
          label="补充说明（可不填）"
          value={detail}
          onChangeText={setDetail}
          placeholder="把当时的情况说清楚一点，有助于我们判断。"
          rows={4}
          max={REPORT_DETAIL_MAX}
        />

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="提交举报"
          accessibilityState={{ disabled: !reason || busy }}
          disabled={!reason || busy}
          onPress={() => void submit()}
          style={[styles.submit, (!reason || busy) && styles.submitOff]}
        >
          <Text style={styles.submitText}>{busy ? "提交中…" : "提交举报"}</Text>
        </Pressable>
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  body: { paddingHorizontal: space(5), paddingBottom: space(3), gap: space(3) },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: space(3),
    paddingVertical: space(3.5),
    paddingHorizontal: space(4),
    borderRadius: radius.field,
    backgroundColor: colors.paper,
  },
  rowPressed: { backgroundColor: colors.lineSoft },
  rowOff: { opacity: 0.5 },
  rowLabel: { fontSize: font.body, fontWeight: "600" },
  rowHint: { marginTop: 2, fontSize: font.caption, color: colors.muted2 },
  groupLabel: { fontSize: font.label, color: colors.muted },
  wrap: { flexDirection: "row", flexWrap: "wrap", gap: space(2) },
  submit: {
    marginTop: space(1),
    paddingVertical: space(3.5),
    borderRadius: 14,
    backgroundColor: colors.brand,
    alignItems: "center",
  },
  submitOff: { opacity: 0.45 },
  submitText: { fontSize: font.body, fontWeight: "700", color: colors.white },
});
