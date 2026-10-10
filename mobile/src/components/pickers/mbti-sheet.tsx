import { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import * as Haptics from "expo-haptics";
import { Sheet } from "@/ui/sheet";
import { colors, font, radius, space } from "@/theme";
import { MBTI_DIMS, dimsToMbti, missingDims, splitMbti, type MbtiDims } from "@/lib/mbti";

/**
 * MBTI 选择器 —— 借鉴 Web 版（`components/profile/mbti-slider.tsx`）的做法：
 * **不铺 16 个类型，按四个维度各自答一次。**
 *
 * Web 上每维度是一根 `range`（三档：左 / 未选 / 右）。App 里**不用滑的，用点的**：
 * 底部弹层的拖拽手势和里面的横向拖拽/纵向滚动会互相抢（这个坑在滚轮选择器上
 * 已经踩过一次），而手感类问题我在本机没有真机可验，所以这里只做点击——
 * 三段式（左 / 未选 / 右）保留 Web 的三档语义，中间那档就是"这个维度先空着"。
 *
 * 和身高、生日、省市一样是"点一行 → 底部弹出 → 选完收起"，五步向导里的
 * 交互语言保持一致。
 */
export function MbtiSheet({
  open,
  value,
  onChange,
  onClose,
}: {
  open: boolean;
  value: string | null;
  onChange: (v: string) => void;
  onClose: () => void;
}) {
  const [dims, setDims] = useState<MbtiDims>(() => splitMbti(value));

  // 每次打开都从**当前已填的值**重新开始，而不是接着上次没答完的草稿
  // （和 Web 的 openSheet 一致；滚轮弹层踩过"只切 visible 不重置"的坑）
  useEffect(() => {
    if (open) setDims(splitMbti(value));
  }, [open, value]);

  const type = dimsToMbti(dims);

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="MBTI"
      // 没答完就不给确认：半成品不该写进资料（Web 版也是答完才出现确认按钮）
      confirmText={type ? "确认" : undefined}
      onConfirm={() => {
        if (!type) return;
        onChange(type);
        onClose();
      }}
    >
      {open ? <MbtiBody dims={dims} onChange={setDims} /> : null}
    </Sheet>
  );
}

function MbtiBody({ dims, onChange }: { dims: MbtiDims; onChange: (d: MbtiDims) => void }) {
  const type = dimsToMbti(dims);
  const missing = missingDims(dims);

  function pick(i: number, v: string | null) {
    void Haptics.selectionAsync();
    const next = [...dims];
    next[i] = v;
    onChange(next);
  }

  return (
    <View style={styles.body}>
      <Text style={styles.hint}>
        按四个维度各答一次就行，不必先知道自己属于哪一型。答完会自动拼出你的类型。
      </Text>

      {MBTI_DIMS.map((dim, i) => (
        <View key={dim.left} style={styles.track}>
          <Segment
            label={`${dim.left} ${dim.leftHint}`}
            on={dims[i] === dim.left}
            onPress={() => pick(i, dim.left)}
          />
          {/* 中间这档是"先不选"。它是未答状态，所以选中时用中性色，
              不用主色——主色只表示"真的答了一个字母" */}
          <Segment label="未选" muted on={dims[i] === null} onPress={() => pick(i, null)} />
          <Segment
            label={`${dim.right} ${dim.rightHint}`}
            on={dims[i] === dim.right}
            onPress={() => pick(i, dim.right)}
          />
        </View>
      ))}

      <Text style={styles.readout}>
        {type ? (
          <>
            你的类型：<Text style={styles.type}>{type}</Text>
          </>
        ) : (
          `还差 ${missing} 个维度`
        )}
      </Text>
    </View>
  );
}

function Segment({
  label,
  on,
  muted,
  onPress,
}: {
  label: string;
  on: boolean;
  /** "未选"那一档：选中时用中性色，不抢主色 */
  muted?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: on }}
      onPress={onPress}
      style={[styles.seg, on && (muted ? styles.segOnMuted : styles.segOn)]}
    >
      <Text
        numberOfLines={1}
        style={[styles.segText, on && (muted ? styles.segTextOnMuted : styles.segTextOn)]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  body: { paddingHorizontal: space(5), paddingBottom: space(3), gap: space(2.5) },
  hint: { fontSize: font.label, lineHeight: 19, color: colors.muted2 },

  // 轨道底色 + 三段：读起来像一根三档的滑杆，但操作全是点击
  track: {
    flexDirection: "row",
    gap: 3,
    padding: 3,
    borderRadius: radius.field,
    backgroundColor: colors.lineSoft,
  },
  seg: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: space(2.5),
    borderRadius: radius.sm,
  },
  segOn: { backgroundColor: colors.brandSoft, borderWidth: 1, borderColor: colors.brandLine },
  segOnMuted: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line },
  segText: { fontSize: font.label, color: colors.muted2 },
  segTextOn: { color: colors.brand, fontWeight: "600" },
  segTextOnMuted: { color: colors.muted },

  readout: { marginTop: space(1), textAlign: "center", fontSize: font.label, color: colors.muted2 },
  type: { fontSize: font.section, fontWeight: "700", letterSpacing: 1, color: colors.ink },
});
