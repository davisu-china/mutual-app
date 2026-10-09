import { useCallback, useEffect, useRef } from "react";
import { FlatList, StyleSheet, Text, View, type NativeScrollEvent, type NativeSyntheticEvent } from "react-native";
import * as Haptics from "expo-haptics";
import { colors, font, space } from "@/theme";

export interface WheelOption {
  value: number | string;
  label: string;
}

interface Props {
  options: WheelOption[];
  value: number | string;
  onChange: (v: number | string) => void;
  /** 滚动过程中实时回调（驱动大号数字跟手），不等停稳 */
  onLiveIndexChange?: (index: number) => void;
  /** 可见行数，奇数；默认 5 行 */
  visibleRows?: number;
  ariaLabel?: string;
}

const ITEM_H = 44;

/**
 * 滚轮选择器。
 *
 * 做这件事的"手感"由三个细节决定，缺一个就会显得廉价：
 *   1. **吸附**：靠 `snapToInterval` + `decelerationRate="fast"`，松手后一定停在一格上，
 *      不会停在两格之间；
 *   2. **跟手**：滚动中就回调当前索引（onLiveIndexChange），大号数字实时变，
 *      而不是松手才跳一下；
 *   3. **顿挫**：每跨过一格给一次极轻的触觉反馈——这是"轮子有挡位"的错觉来源。
 *
 * 用 FlatList 而不是自己算 transform：惯性、回弹、低端机掉帧都交给原生，
 * 自己写只会更差。
 */
export function WheelPicker({ options, value, onChange, onLiveIndexChange, visibleRows = 5, ariaLabel }: Props) {
  const listRef = useRef<FlatList<WheelOption>>(null);
  const padding = ((visibleRows - 1) / 2) * ITEM_H;
  const lastTickRef = useRef<number>(-1);
  const initedRef = useRef(false);

  const indexOf = useCallback(
    (v: number | string) => Math.max(0, options.findIndex((o) => o.value === v)),
    [options]
  );

  // 外部改值时把列表滚过去（例如点了快捷档位），不要动画，避免"飞过去"的廉价感
  useEffect(() => {
    if (!initedRef.current) {
      initedRef.current = true;
      const i = indexOf(value);
      if (i > 0) {
        requestAnimationFrame(() => listRef.current?.scrollToOffset({ offset: i * ITEM_H, animated: false }));
      }
    }
  }, [value, indexOf]);

  function handleScroll(e: NativeSyntheticEvent<NativeScrollEvent>) {
    const offset = e.nativeEvent.contentOffset.y;
    const i = Math.round(offset / ITEM_H);
    if (i < 0 || i >= options.length) return;
    onLiveIndexChange?.(i);
    if (i !== lastTickRef.current) {
      lastTickRef.current = i;
      void Haptics.selectionAsync();
    }
  }

  function handleEnd(e: NativeSyntheticEvent<NativeScrollEvent>) {
    const i = Math.round(e.nativeEvent.contentOffset.y / ITEM_H);
    const clamped = Math.min(Math.max(i, 0), options.length - 1);
    const next = options[clamped];
    if (next && next.value !== value) onChange(next.value);
  }

  const selectedIndex = indexOf(value);

  return (
    <View style={{ height: ITEM_H * visibleRows }} accessibilityLabel={ariaLabel}>
      {/* 中间高亮带：告诉用户"停在这里的才是选中的" */}
      <View pointerEvents="none" style={[styles.band, { top: padding }]} />

      <FlatList
        ref={listRef}
        data={options}
        keyExtractor={(o) => String(o.value)}
        showsVerticalScrollIndicator={false}
        snapToInterval={ITEM_H}
        decelerationRate="fast"
        bounces={false}
        onScroll={handleScroll}
        scrollEventThrottle={16}
        onMomentumScrollEnd={handleEnd}
        onScrollEndDrag={handleEnd}
        getItemLayout={(_, i) => ({ length: ITEM_H, offset: ITEM_H * i, index: i })}
        contentContainerStyle={{ paddingVertical: padding }}
        renderItem={({ item, index }) => {
          const active = index === selectedIndex;
          return (
            <View style={styles.row}>
              <Text style={[styles.label, active && styles.labelActive]}>{item.label}</Text>
            </View>
          );
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  band: {
    position: "absolute",
    left: space(4),
    right: space(4),
    height: ITEM_H,
    borderRadius: 10,
    backgroundColor: colors.brandSoft,
  },
  row: { height: ITEM_H, alignItems: "center", justifyContent: "center" },
  label: { fontSize: 17, color: colors.muted2 },
  labelActive: { fontSize: 19, fontWeight: "700", color: colors.ink },
});
