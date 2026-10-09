import { forwardRef, useState } from "react";
import { StyleSheet, Text, TextInput, View, type TextInputProps } from "react-native";
import { colors, font, radius, space } from "@/theme";

interface Props extends TextInputProps {
  label?: string;
  error?: string;
}

/**
 * 输入框。
 *
 * 聚焦时描边变主色、并加一圈极淡的外光——这是"当前在编辑哪里"的即时反馈，
 * 比只变边框颜色更明确（尤其中文输入法弹起时屏幕已被顶上去半屏）。
 */
export const Input = forwardRef<TextInput, Props>(function Input({ label, error, style, ...rest }, ref) {
  const [focused, setFocused] = useState(false);

  return (
    <View>
      {label ? <Text style={styles.label}>{label}</Text> : null}
      <TextInput
        ref={ref}
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
        style={[
          styles.input,
          focused && styles.focused,
          !!error && styles.error,
          style,
        ]}
        {...rest}
      />
      {error ? <Text style={styles.errorText}>{error}</Text> : null}
    </View>
  );
});

const styles = StyleSheet.create({
  label: { fontSize: font.body, color: colors.muted, marginBottom: space(2) },
  input: {
    minHeight: 52,
    borderRadius: radius.field,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface,
    paddingHorizontal: space(4),
    paddingVertical: space(3),
    fontSize: font.body,
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
});
