import { useState, type ReactNode } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Sheet } from "@/ui/sheet";
import { WheelPicker } from "@/ui/wheel-picker";
import { colors, font, space } from "@/theme";
import {
  MAX_AGE,
  MIN_AGE,
  birthdayText,
  calcAge,
  daysInMonth,
  yearOptions,
  type Birthday,
} from "@/onboarding/draft";

/**
 * 滚轮类选择器：生日、单值数字（身高/体重）、区间（期望身高）。
 *
 * 三个都在这个文件里，因为它们共用同一种交互与同一处容易写错的地方：
 * **草稿与确认分离**——滚轮滚动的中间过程不写回表单，点「确定」才写回，
 * 点「取消」或点遮罩则整份丢掉。所以每个都用一个只在打开时挂载的内层
 * 组件持有草稿（`{open ? <Body/> : null}`）：`useState` 的初始化函数在挂载时
 * 跑一次，天然做到"每次打开都从当前值重新开始"。
 *
 * 另一个共同点：`WheelPicker` 只在**首次挂载**时把列表滚到当前值
 * （之后外部改值不滚动，见它的 `initedRef`）。所以内层组件必须真正重新挂载，
 * 只把 `open` 传给 Modal 是留在树里不动的，滚轮会停在上次的位置。
 */

const range = (min: number, max: number) => {
  const out: { value: number; label: string }[] = [];
  for (let n = min; n <= max; n++) out.push({ value: n, label: String(n) });
  return out;
};

/** 性别只影响**默认落点**，不改变可选项范围 */
type Gender = "male" | "female";

/* ------------------------------------------------------------- 单值数字 */

export function NumberSheet({
  open,
  title,
  value,
  min,
  max,
  unit,
  fallback,
  onChange,
  onClose,
}: {
  open: boolean;
  title: string;
  value: number | null;
  min: number;
  max: number;
  unit: string;
  /** 没填过时滚轮的落点 */
  fallback: number;
  onChange: (v: number) => void;
  onClose: () => void;
}) {
  return (
    <Sheet open={open} onClose={onClose} title={title} confirmText="确定">
      {open ? (
        <NumberBody
          value={value}
          min={min}
          max={max}
          unit={unit}
          fallback={fallback}
          onChange={onChange}
          onClose={onClose}
        />
      ) : null}
    </Sheet>
  );
}

function NumberBody({
  value,
  min,
  max,
  unit,
  fallback,
  onChange,
  onClose,
}: {
  value: number | null;
  min: number;
  max: number;
  unit: string;
  fallback: number;
  onChange: (v: number) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<number>(value ?? fallback);
  const [live, setLive] = useState<number>(value ?? fallback);

  return (
    <>
      <Unit unit={unit} value={live} />
      <View style={styles.wheels}>
        <Wheel unit={unit}>
          <WheelPicker
            options={range(min, max)}
            value={draft}
            onChange={(v) => setDraft(v as number)}
            onLiveIndexChange={(i) => setLive(min + i)}
            ariaLabel={unit}
          />
        </Wheel>
      </View>
      <Confirm onPress={() => { onChange(draft); onClose(); }} />
    </>
  );
}

/* ----------------------------------------------------------------- 生日 */

const DEFAULT_AGE: Record<Gender, number> = { male: 28, female: 26 };

export function DateSheet({
  open,
  value,
  gender,
  onChange,
  onClose,
}: {
  open: boolean;
  value: Birthday | null;
  gender: Gender;
  onChange: (v: Birthday) => void;
  onClose: () => void;
}) {
  return (
    <Sheet open={open} onClose={onClose} title="出生年月日" confirmText="确定">
      {open ? (
        <DateBody value={value} gender={gender} onChange={onChange} onClose={onClose} />
      ) : null}
    </Sheet>
  );
}

function DateBody({
  value,
  gender,
  onChange,
  onClose,
}: {
  value: Birthday | null;
  gender: Gender;
  onChange: (v: Birthday) => void;
  onClose: () => void;
}) {
  // 年份列表本身就已经从「刚满 18 岁」那年起，选不到更晚的年份。
  // 但边界那一年仍可能落到 18 岁生日之前（比如今天 10 月，选了 12 月），
  // 所以下面还要按精确年龄再拦一次。
  const years = yearOptions();
  const init: Birthday = value ?? { year: new Date().getFullYear() - DEFAULT_AGE[gender], month: 6, day: 15 };
  const [draft, setDraft] = useState<Birthday>(init);

  const dayCount = daysInMonth(draft.year, draft.month);
  const age = calcAge(draft);
  const ok = age >= MIN_AGE && age <= MAX_AGE;

  /** 年或月一变，日要先收敛到当月合法范围，不然会出现「2 月 30 日」 */
  function setYearMonth(year: number, month: number) {
    setDraft((d) => ({ year, month, day: Math.min(d.day, daysInMonth(year, month)) }));
  }

  return (
    <>
      <View style={styles.liveWrap}>
        <Text style={styles.liveText}>{birthdayText(draft)}</Text>
        <Text style={[styles.liveSub, !ok && styles.liveWarn]}>
          {ok ? `${age} 岁` : `相悦仅面向 ${MIN_AGE} 岁以上用户，请检查出生年份`}
        </Text>
      </View>

      <View style={styles.wheels}>
        <Wheel flex={1.4} unit="年">
          <WheelPicker
            options={years.map((y) => ({ value: y, label: `${y} 年` }))}
            value={draft.year}
            onChange={(v) => setYearMonth(v as number, draft.month)}
            ariaLabel="出生年份"
          />
        </Wheel>
        <Wheel unit="月">
          <WheelPicker
            options={range(1, 12).map((m) => ({ value: m.value, label: `${m.value} 月` }))}
            value={draft.month}
            onChange={(v) => setYearMonth(draft.year, v as number)}
            ariaLabel="出生月份"
          />
        </Wheel>
        <Wheel unit="日">
          <WheelPicker
            options={range(1, dayCount)}
            value={Math.min(draft.day, dayCount)}
            onChange={(v) => setDraft((d) => ({ ...d, day: v as number }))}
            ariaLabel="出生日期"
          />
        </Wheel>
      </View>

      {/* 不满 18 岁时不显示「确定」——只把按钮置灰用户会一直点 */}
      {ok ? (
        <Confirm onPress={() => { onChange(draft); onClose(); }} />
      ) : (
        <View style={styles.confirmPlaceholder} />
      )}
    </>
  );
}

/* ----------------------------------------------------------------- 区间 */

/**
 * 双滚轮的区间选择。
 *
 * Web 版这里用的是双滑块（`gap` 表示两端之间必须保留的最小距离）。移动端没有
 * 滑杆组件，手搓一个双滑块手势在这个环境里既没法目视验证、收益也不大，
 * 所以改成两个滚轮——同样保留 `gap` 的语义（拖一端会顶住另一端），
 * 落库的值和 Web 完全一致。
 */
export function RangeSheet({
  open,
  title,
  min,
  max,
  gap,
  valueMin,
  valueMax,
  unit,
  onChange,
  onClose,
}: {
  open: boolean;
  title: string;
  min: number;
  max: number;
  gap: number;
  valueMin: number;
  valueMax: number;
  unit: string;
  onChange: (lo: number, hi: number) => void;
  onClose: () => void;
}) {
  return (
    <Sheet open={open} onClose={onClose} title={title} confirmText="确定">
      {open ? (
        <RangeBody
          min={min}
          max={max}
          gap={gap}
          valueMin={valueMin}
          valueMax={valueMax}
          unit={unit}
          onChange={onChange}
          onClose={onClose}
        />
      ) : null}
    </Sheet>
  );
}

function RangeBody({
  min,
  max,
  gap,
  valueMin,
  valueMax,
  unit,
  onChange,
  onClose,
}: {
  min: number;
  max: number;
  gap: number;
  valueMin: number;
  valueMax: number;
  unit: string;
  onChange: (lo: number, hi: number) => void;
  onClose: () => void;
}) {
  const [lo, setLo] = useState(valueMin);
  const [hi, setHi] = useState(valueMax);

  function pickLo(v: number) {
    setLo(v);
    // 下限顶到上限时把上限一起抬走，保证区间不被压反
    if (hi < v + gap) setHi(Math.min(max, v + gap));
  }
  function pickHi(v: number) {
    setHi(v);
    if (lo > v - gap) setLo(Math.max(min, v - gap));
  }

  return (
    <>
      <View style={styles.liveWrap}>
        <Text style={styles.liveText}>
          {lo} – {hi} {unit}
        </Text>
      </View>

      <View style={styles.wheels}>
        <Wheel unit="最低">
          <WheelPicker
            options={range(min, max - gap)}
            value={lo}
            onChange={(v) => pickLo(v as number)}
            ariaLabel="下限"
          />
        </Wheel>
        <Wheel unit="最高">
          <WheelPicker
            options={range(min + gap, max)}
            value={hi}
            onChange={(v) => pickHi(v as number)}
            ariaLabel="上限"
          />
        </Wheel>
      </View>

      <Confirm onPress={() => { onChange(lo, hi); onClose(); }} />
    </>
  );
}

/* ----------------------------------------------------------------- 小件 */

/** 滚轮的左右分栏容器：多列时每列等宽（年份长一点，给它 1.4 倍） */
function Wheel({ children, flex = 1, unit }: { children: ReactNode; flex?: number; unit?: string }) {
  return (
    <View style={{ flex, alignItems: "center" }}>
      {unit ? <Text style={styles.colUnit}>{unit}</Text> : null}
      {children}
    </View>
  );
}

/** 单列滚轮上方的大号读数——滚动过程中实时变，不用等停稳 */
function Unit({ unit, value }: { unit: string; value: number }) {
  return (
    <View style={styles.liveWrap}>
      <Text style={styles.liveText}>
        {value} <Text style={styles.liveUnit}>{unit}</Text>
      </Text>
    </View>
  );
}

/**
 * 确定按钮。
 *
 * 没有复用 `ui/button`：这里是弹层里的「完成」动作，要和右上角的文字按钮
 * 拉开层级，用整行主色块最省事；而 Button 的按压动画在这个高度上并不明显。
 */
function Confirm({ onPress }: { onPress: () => void }) {
  return (
    <View style={styles.confirmWrap}>
      <Text accessibilityRole="button" accessibilityLabel="确定" onPress={onPress} style={styles.confirmBlock}>
        确定
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  liveWrap: { alignItems: "center", paddingTop: space(3), paddingBottom: space(1) },
  liveText: { fontSize: 24, fontWeight: "700", color: colors.ink, fontVariant: ["tabular-nums"] },
  liveUnit: { fontSize: 15, fontWeight: "600", color: colors.muted2 },
  liveSub: { marginTop: space(1), fontSize: font.label, color: colors.muted2 },
  liveWarn: { color: colors.brand, fontWeight: "600" },
  wheels: { flexDirection: "row", paddingHorizontal: space(4), paddingBottom: space(2) },
  colUnit: { fontSize: font.caption, color: colors.muted2, paddingBottom: space(1) },
  confirmWrap: { paddingHorizontal: space(5), paddingTop: space(2) },
  confirmBlock: {
    textAlign: "center",
    paddingVertical: space(3.5),
    borderRadius: 14,
    backgroundColor: colors.brand,
    color: colors.white,
    fontSize: font.body,
    fontWeight: "700",
    overflow: "hidden",
  },
  // 不满 18 岁时不放确定按钮，但保留同样的高度，避免弹层高度跳一下
  confirmPlaceholder: { height: 50 + space(2) },
});
