import { useState } from "react";
import { StyleSheet, Text, TextInput, View, type TextInputProps } from "react-native";
import { colors, font, radius, space } from "@/theme";

interface Props extends Omit<TextInputProps, "multiline"> {
  label?: string;
  error?: string;
  /** 可见行数，用来定最小高度（不是硬性行高限制） */
  rows?: number;
  /** 字数上限；给了就在右下角显示计数 */
  max?: number;
  /** 计数文案里的下限提示，例如「至少 10 字」 */
  minHint?: number;
}

/**
 * 多行输入。和 Input 是同一套外观，只有三点不同：
 *
 *   1. **`textAlignVertical: "top"`**：Android 的多行输入默认**垂直居中**，
 *      打第一行时文字浮在框中间，回车后才跳上去。这是 Android 上最容易被
 *      忽略、又最像"没做完"的一处；
 *   2. 字数计数放右下角。上限是服务端定的（关于我 / 期待的他是 500），
 *      不显示计数就只能等提交时报错才知道超了；
 *   3. 默认 `autoCorrect={false}`：中文输入法下自动纠错会把已经选好的候选词
 *      改掉，英文长句里尤其烦。
 */
export function Textarea({ label, error, rows = 5, max, minHint, style, ...rest }: Props) {
  const [focused, setFocused] = useState(false);
  const len = [...(rest.value ?? "")].length;
  // 超限时把计数染成主色。不截断输入（截断会吃掉中文输入法正在拼的字），
  // 但必须让人一眼看出"已经写太多了"，否则只会看到按钮莫名点不动。
  const over = max !== undefined && len > max;

  return (
    <View>
      {label ? <Text style={styles.label}>{label}</Text> : null}
      <TextInput
        multiline
        textAlignVertical="top"
        autoCorrect={false}
        placeholderTextColor={colors.muted2}
        selectionColor={colors.brand}
        onFocus={(e) => {
          setFocused(true);
          rest.onFocus?.(e);
        }}
        onBlur={(e) => {
          setFocused(false);
          rest.onBlur?.(e);
        }}
        style={[styles.input, { minHeight: 22 * rows + space(6) }, focused && styles.focused, !!error && styles.error, style]}
        {...rest}
      />
      {error ? (
        <Text style={styles.errorText}>{error}</Text>
      ) : max ? (
        <Text style={[styles.counter, over && styles.counterOver]}>
          {len}/{max}
          {minHint ? `（至少 ${minHint} 字）` : ""}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  label: { fontSize: font.body, color: colors.muted, marginBottom: space(2) },
  input: {
    borderRadius: radius.field,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface,
    paddingHorizontal: space(4),
    paddingVertical: space(3),
    fontSize: font.body,
    lineHeight: 23,
    color: colors.ink,
  },
  focused: {
    borderColor: colors.brand,
    shadowColor: colors.brand,
    shadowOpacity: 0.12,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 0 },
  },
  error: { borderColor: colors.brand },
  errorText: { marginTop: space(1.5), paddingHorizontal: space(1), fontSize: font.label, color: colors.brand },
  counter: { marginTop: space(1.5), paddingHorizontal: space(1), fontSize: font.caption, color: colors.muted2, textAlign: "right" },
  counterOver: { color: colors.brand, fontWeight: "600" },
});
