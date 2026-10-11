import { useEffect, useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Sheet } from "@/ui/sheet";
import { Chip, Choice } from "@/ui/chip";
import { Input } from "@/ui/input";
import { colors, font, radius, space } from "@/theme";
import { INDUSTRIES, occupationValue, parseOccupation } from "@/lib/data/occupation";
import {
  OTHER_SCHOOL,
  levelLabel,
  loadUniversities,
  searchSchools,
} from "@/lib/data/universities";
import type { UniProvince } from "@/lib/data/universities";

/**
 * 三个"列表类"选择器：职业（行业→岗位）、院校、多选（期待家乡）。
 *
 * 职业、院校都用**标签网格 + 搜索**。院校有三千多所，所以它以搜索为**唯一**入口：
 * 曾经铺过一排"按省份找"的标签（点了把省名填进搜索框），但那本身就是一次多余的
 * 跳转——想找浙大的人会直接打「浙大/zj」，不会先想"它在浙江"。省份名仍然能在
 * 搜索里匹配到（`searchSchools` 会把省名当关键词），所以去掉那排标签只是**少一层**。
 *
 * 这里的标签是整块铺开、点一下就选中，不依赖纵向滚动（弹层的拖拽手势只挂在把手和
 * 标题栏上，滚动本身没问题，但短列表没必要滚）。
 */

/* ----------------------------------------------------------------- 职业 */

export function OccupationSheet({
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
  return (
    <Sheet open={open} onClose={onClose} title="职业">
      {open ? <OccupationBody value={value} onChange={onChange} onClose={onClose} /> : null}
    </Sheet>
  );
}

function OccupationBody({
  value,
  onChange,
  onClose,
}: {
  value: string | null;
  onChange: (v: string) => void;
  onClose: () => void;
}) {
  // 打开时就停在上次选的那一行，而不是每次都回到顶部
  const parsed = useMemo(() => parseOccupation(value ?? ""), [value]);
  const [industry, setIndustry] = useState<string | null>(parsed.industry);

  function finish(v: string) {
    onChange(v);
    onClose();
  }

  const current = industry ? INDUSTRIES.find((i) => i.name === industry) ?? null : null;

  if (current && current.roles.length > 0) {
    return (
      <View style={styles.body}>
        <View style={styles.crumbRow}>
          <Text accessibilityRole="button" accessibilityLabel="返回行业列表" onPress={() => setIndustry(null)} style={styles.back}>
            ‹ 返回
          </Text>
          <Text style={styles.crumbText}>{current.name}</Text>
          <View style={styles.backSpacer} />
        </View>
        <View style={styles.wrap}>
          {current.roles.map((r) => (
            <Chip
              key={r}
              label={r}
              on={parsed.industry === current.name && parsed.role === r}
              onPress={() => finish(occupationValue(current.name, r))}
            />
          ))}
        </View>
      </View>
    );
  }

  return (
    <View style={styles.body}>
      <Text style={styles.hint}>先选行业，再选具体岗位</Text>
      <Choice
        options={INDUSTRIES.map((i) => ({ value: i.name, label: i.name }))}
        value={industry}
        columns={2}
        onChange={(name) => {
          const ind = INDUSTRIES.find((i) => i.name === name);
          // 「学生」「其他」没有二级岗位，点一下就算选完
          if (!ind || ind.roles.length === 0) {
            finish(occupationValue(String(name)));
            return;
          }
          setIndustry(String(name));
        }}
      />
    </View>
  );
}

/* ----------------------------------------------------------------- 院校 */

/** 一次最多铺这么多所学校；再多就该让用户补几个字，而不是继续往下铺 */
const SCHOOL_LIMIT = 30;

export function UniversitySheet({
  open,
  value,
  onChange,
  onClose,
}: {
  open: boolean;
  value: string;
  onChange: (v: string) => void;
  onClose: () => void;
}) {
  return (
    <Sheet open={open} onClose={onClose} title="学校">
      {open ? <UniversityBody value={value} onChange={onChange} onClose={onClose} /> : null}
    </Sheet>
  );
}

function UniversityBody({
  value,
  onChange,
  onClose,
}: {
  value: string;
  onChange: (v: string) => void;
  onClose: () => void;
}) {
  const [unis, setUnis] = useState<UniProvince[] | null>(null);
  const [keyword, setKeyword] = useState("");

  useEffect(() => {
    let alive = true;
    loadUniversities()
      .then((d) => alive && setUnis(d))
      .catch(() => alive && setUnis([]));
    return () => {
      alive = false;
    };
  }, []);

  const hits = useMemo(
    () => (unis && keyword.trim() ? searchSchools(unis, keyword.trim(), SCHOOL_LIMIT) : []),
    [unis, keyword]
  );

  function finish(v: string) {
    onChange(v);
    onClose();
  }

  return (
    <View style={styles.body}>
      <Input
        value={keyword}
        onChangeText={setKeyword}
        placeholder="搜学校，支持拼音（如 zj / zhejiang / 浙大）"
        autoCorrect={false}
        returnKeyType="search"
      />

      {unis === null ? (
        <Text style={styles.hint}>正在加载院校…</Text>
      ) : keyword.trim() ? (
        hits.length === 0 ? (
          <Text style={styles.hint}>没找到。可以换个写法，或选下面的「其他院校」。</Text>
        ) : (
          <>
            <View style={styles.wrap}>
              {hits.map((h) => (
                <Chip
                  key={`${h.province}-${h.school.name}`}
                  label={h.school.name}
                  on={value === h.school.name}
                  onPress={() => finish(h.school.name)}
                />
              ))}
            </View>
            {hits.length >= SCHOOL_LIMIT ? (
              <Text style={styles.hint}>结果较多，再输入几个字缩小范围</Text>
            ) : null}
          </>
        )
      ) : (
        <Text style={styles.hint}>
          直接输入学校名搜索（支持拼音，如 zju / 浙江）。三千多所，搜比翻快。
        </Text>
      )}

      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`选择${OTHER_SCHOOL}`}
        onPress={() => finish(OTHER_SCHOOL)}
        style={styles.otherRow}
      >
        <Text style={styles.otherText}>找不到？选「{OTHER_SCHOOL}」（含海外院校）</Text>
      </Pressable>
    </View>
  );
}

/* ----------------------------------------------------------------- 多选 */

/**
 * 通用多选（目前用于「期待家乡」）。
 *
 * 草稿 + 确定：多选时每点一下都实时写回表单会让用户没法"反悔到一半取消"，
 * 和另外几个选择器的行为也不一致。
 */
export function MultiChoiceSheet({
  open,
  title,
  hint,
  options,
  value,
  onChange,
  onClose,
}: {
  open: boolean;
  title: string;
  hint?: string;
  options: string[];
  value: string[];
  onChange: (v: string[]) => void;
  onClose: () => void;
}) {
  return (
    <Sheet open={open} onClose={onClose} title={title} confirmText="确定">
      {open ? (
        <MultiChoiceBody hint={hint} options={options} value={value} onChange={onChange} onClose={onClose} />
      ) : null}
    </Sheet>
  );
}

function MultiChoiceBody({
  hint,
  options,
  value,
  onChange,
  onClose,
}: {
  hint?: string;
  options: string[];
  value: string[];
  onChange: (v: string[]) => void;
  onClose: () => void;
}) {
  const [picked, setPicked] = useState<string[]>(value);

  function toggle(name: string) {
    setPicked((prev) => (prev.includes(name) ? prev.filter((x) => x !== name) : [...prev, name]));
  }

  return (
    <View style={styles.body}>
      {hint ? <Text style={styles.hint}>{hint}</Text> : null}
      <View style={styles.wrap}>
        {options.map((o) => (
          <Chip key={o} label={o} on={picked.includes(o)} onPress={() => toggle(o)} />
        ))}
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="确定"
        onPress={() => {
          onChange(picked);
          onClose();
        }}
        style={styles.confirmRow}
      >
        <Text style={styles.confirmText}>确定</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  body: { paddingHorizontal: space(5), paddingBottom: space(2), gap: space(3) },
  wrap: { flexDirection: "row", flexWrap: "wrap", gap: space(2) },
  hint: { fontSize: font.label, color: colors.muted2 },
  crumbRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  back: { fontSize: font.body, color: colors.brand, paddingVertical: space(1) },
  backSpacer: { width: 44 },
  crumbText: { flex: 1, textAlign: "center", fontSize: font.body, fontWeight: "600", color: colors.ink },
  otherRow: {
    paddingVertical: space(3),
    borderRadius: radius.field,
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: colors.line,
    alignItems: "center",
  },
  otherText: { fontSize: font.label, color: colors.muted },
  confirmRow: {
    paddingVertical: space(3.5),
    borderRadius: 14,
    backgroundColor: colors.brand,
    alignItems: "center",
  },
  confirmText: { fontSize: font.body, fontWeight: "700", color: colors.white },
});
