import { Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { colors, font, radius, space } from "@/theme";

interface Props {
  label: string;
  /** 已填的值；为空时显示占位文案 */
  value?: string | null;
  placeholder?: string;
  hint?: string;
  onPress: () => void;
  /** 行首图标；不传则只显示文字 */
  icon?: keyof typeof Ionicons.glyphMap;
  /** 校验未通过时描边变主色 */
  error?: boolean;
}

/**
 * 表单字段的触发行 —— 全站所有选择器共用同一个外观。
 *
 * 这样用户在五步向导里看到的是**同一种交互语言**：点一行 → 底部弹出 → 选完收起。
 * 用行而不是原生 <Select>/<Picker>：原生控件在两端长相完全不同、无法统一风格。
 *
 * 细节：已填时行首图标变成主色——扫一眼就知道哪些填过了，不用逐行读文字。
 */
export function FieldRow({ label, value, placeholder = "请选择", hint, onPress, icon, error }: Props) {
  const filled = value !== undefined && value !== null && value !== "";

  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.row, error && styles.rowError, pressed && styles.pressed]}
    >
      <View style={styles.left}>
        {icon ? (
          <Ionicons name={icon} size={18} color={filled ? colors.brand : colors.muted2} />
        ) : null}
        <Text style={styles.label}>{label}</Text>
      </View>

      <View style={styles.right}>
        <Text style={[styles.value, !filled && styles.placeholder]} numberOfLines={1}>
          {filled ? value : placeholder}
        </Text>
        {filled && hint ? <Text style={styles.hint}>{hint}</Text> : null}
        <Ionicons name="chevron-forward" size={16} color={colors.muted2} />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: space(3),
    minHeight: 54,
    paddingHorizontal: space(4),
    paddingVertical: space(3),
    borderRadius: radius.field,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface,
  },
  rowError: { borderColor: colors.brand },
  pressed: { backgroundColor: colors.lineSoft },
  left: { flexDirection: "row", alignItems: "center", gap: space(2.5) },
  label: { fontSize: font.body, color: colors.muted },
  right: { flexDirection: "row", alignItems: "center", gap: space(2), flexShrink: 1 },
  value: { fontSize: font.body, color: colors.ink, fontWeight: "500", flexShrink: 1 },
  placeholder: { color: colors.muted2, fontWeight: "400" },
  hint: { fontSize: font.label, color: colors.muted2 },
});
