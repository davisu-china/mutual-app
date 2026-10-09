import { Pressable, StyleSheet, Text, View, type ViewStyle } from "react-native";
import * as Haptics from "expo-haptics";
import { colors, font, radius, space } from "@/theme";

export interface ChoiceOption<T = string | number | boolean> {
  value: T;
  label: string;
}

/**
 * 单选标签组。
 *
 * 为什么铺成标签而不是下拉：本项目的枚举都很短（3–7 个），一次点击到位
 * 比「点开 → 找 → 点」少两步；而且下拉在手机上会弹系统控件，和整体观感割裂。
 * 选中态用「浅底 + 主色描边 + 主色字」，而不是实心色块——整屏都实心会吵。
 */
export function Choice<T extends string | number | boolean>({
  label,
  options,
  value,
  onChange,
  columns,
}: {
  label?: string;
  options: ChoiceOption<T>[];
  value: T | null | undefined;
  onChange: (v: T) => void;
  /** 固定列数；不传则按内容自动换行 */
  columns?: number;
}) {
  return (
    <View>
      {label ? <Text style={styles.label}>{label}</Text> : null}
      {/*
        固定列数时，**间距走单元格的内边距，不走 gap**：
        `width: 25%` 再加 8px 的 gap，一行四个的总宽就是 `100% + 24px`，
        第四个会被挤到下一行——四列变三列。所以这里每个格子占 `100/columns%`
        并自带一圈内边距（外层用负 margin 抵消掉最左最右那一份，
        这样两边仍然和表单其它元素对齐）。
      */}
      <View style={columns ? styles.grid : styles.wrap}>
        {options.map((o) => {
          const on = value === o.value;
          const item = (
            <Pressable
              key={String(o.value)}
              accessibilityRole="button"
              accessibilityState={{ selected: on }}
              onPress={() => {
                void Haptics.selectionAsync();
                onChange(o.value);
              }}
              style={[styles.chip, on ? styles.chipOn : null]}
            >
              <Text style={[styles.chipText, on && styles.chipTextOn]} numberOfLines={1}>
                {o.label}
              </Text>
            </Pressable>
          );
          return columns ? (
            <View key={String(o.value)} style={[styles.cell, { width: `${100 / columns}%` }]}>
              {item}
            </View>
          ) : (
            item
          );
        })}
      </View>
    </View>
  );
}

/** 单颗标签（用于广场筛选这种自带排版的场景） */
export function Chip({ on, label, onPress }: { on: boolean; label: string; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: on }}
      onPress={() => {
        void Haptics.selectionAsync();
        onPress();
      }}
      style={[styles.chip, on && styles.chipOn]}
    >
      <Text style={[styles.chipText, on && styles.chipTextOn]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  label: { fontSize: font.body, color: colors.muted, marginBottom: space(2) },
  wrap: { flexDirection: "row", flexWrap: "wrap", gap: space(2) },
  // 负 margin 抵消掉最外那一份格子内边距，让两端和表单其它元素对齐
  grid: { flexDirection: "row", flexWrap: "wrap", marginHorizontal: -space(1) },
  cell: { padding: space(1) },
  chip: {
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface,
    paddingVertical: space(2),
    paddingHorizontal: space(3.5),
    alignItems: "center",
  } as ViewStyle,
  chipOn: { borderColor: colors.brand, backgroundColor: colors.brandSoft },
  chipText: { fontSize: 14, color: colors.ink },
  chipTextOn: { color: colors.brand, fontWeight: "600" },
});
