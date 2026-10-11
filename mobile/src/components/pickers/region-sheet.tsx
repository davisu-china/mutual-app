import { useEffect, useMemo, useRef, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Sheet } from "@/ui/sheet";
import { Chip } from "@/ui/chip";
import { Input } from "@/ui/input";
import { colors, font, radius, space } from "@/theme";
import { fullName, loadRegions, searchRegions, shortName } from "@/lib/data/regions";
import type { City, Province, RegionHit } from "@/lib/data/regions";
import type { RegionValue } from "@/onboarding/draft";

/** 两列的行高。**滚动定位和样式共用这一个数**，别在两处各写一遍 */
const ROW_H = space(11); // 44

/**
 * 家乡 / 现居地 —— **底部弹窗 + 省市父子联动的两列选择**。
 *
 * 左边省份、右边该省的市；点省份**当场换右边那一列**（联动），点市即选定。
 * 现居地还要区县，于是右列再往里钻一层（选中某市 → 右列换成它的区县，
 * 顶上一条「‹ 杭州市」可以退回市列表）——**不铺第三列**：手机宽度分成三列，
 * 区县名（「乌兰察布」这种）就没法看了。
 *
 * 上一版是三屏平铺（省 → 市 → 区各占一屏，每屏一堆标签）。问题在于：
 * **看不到自己在哪一级、也没法回看上一步**，改一个已经填过的市要从头点三下。
 *
 * 搜索保留：366 个市、3439 个区县，靠翻列表找太慢；输入支持中文、全拼、首字母
 * （「杭州」「hangzhou」「hz」）。搜到市之后**不直接收口**，而是落进联动列表里，
 * 让人还能改主意挑区县。
 *
 * 列表可滚（最多 34 个省 / 20+ 个区县）：弹层的拖拽手势只挂在把手和标题栏上
 * （见 `ui/sheet`），所以里面的 ScrollView 不会被抢手势。
 */
export function RegionSheet({
  open,
  title,
  value,
  withDistrict,
  onChange,
  onClose,
}: {
  open: boolean;
  title: string;
  value: RegionValue | null;
  withDistrict: boolean;
  onChange: (v: RegionValue) => void;
  onClose: () => void;
}) {
  return (
    <Sheet open={open} onClose={onClose} title={title}>
      {open ? (
        <Body value={value} withDistrict={withDistrict} onChange={onChange} onClose={onClose} />
      ) : null}
    </Sheet>
  );
}

function Body({
  value,
  withDistrict,
  onChange,
  onClose,
}: {
  value: RegionValue | null;
  withDistrict: boolean;
  onChange: (v: RegionValue) => void;
  onClose: () => void;
}) {
  const [provinces, setProvinces] = useState<Province[] | null>(null);
  const [keyword, setKeyword] = useState("");
  /** 左列选中的省 */
  const [prov, setProv] = useState<Province | null>(null);
  /** 非空＝右列已经钻进这个市的区县 */
  const [city, setCity] = useState<City | null>(null);
  const leftRef = useRef<ScrollView>(null);

  useEffect(() => {
    let alive = true;
    loadRegions()
      .then((list) => {
        if (!alive) return;
        setProvinces(list);
        // 打开就停在当前值所在的省，而不是每次都从「北京」开始
        const hit = value ? list.find((p) => p.name === value.province) ?? null : null;
        if (hit) setProv(hit);
      })
      .catch(() => alive && setProvinces([]));
    return () => {
      alive = false;
    };
  }, [value]);

  // 同样按名字比：港澳的 code 是空串，用 code 比会同时命中好几个省
  const selectedIndex = prov && provinces ? provinces.findIndex((p) => p.name === prov.name) : -1;

  // 34 个省一屏装不下，当前这个省可能在第 10 行——不滚过去等于没选中
  useEffect(() => {
    if (selectedIndex < 0) return;
    const t = setTimeout(() => {
      leftRef.current?.scrollTo({ y: Math.max(0, selectedIndex * ROW_H - ROW_H * 2), animated: false });
    }, 50);
    return () => clearTimeout(t);
  }, [selectedIndex]);

  const hits = useMemo(
    () => (provinces && keyword.trim() ? searchRegions(provinces, keyword.trim(), 30) : []),
    [provinces, keyword]
  );

  function finish(v: RegionValue) {
    onChange(v);
    onClose();
  }

  function chooseProvince(p: Province) {
    setKeyword("");
    setProv(p);
    setCity(null);
    // 直辖市的「市」就是它自己，中间那一级没有意义：
    // 要区县就直接进区县，不要区县就当场选完（别让人再点一个只有一个选项的列表）
    if (p.isMunicipality) {
      const only = p.cities[0];
      if (withDistrict && only && only.districts.length > 0) {
        setCity(only);
        return;
      }
      finish({ province: p.name, city: p.name });
    }
  }

  function chooseCity(c: City) {
    if (withDistrict && c.districts.length > 0) {
      setCity(c);
      return;
    }
    finish({ province: prov!.name, city: c.name });
  }

  function pickHit(h: RegionHit) {
    // 家乡只要到市：命中区县时把区县丢掉，不要存进库里
    if (h.level === "district" && h.district && withDistrict) {
      finish({ province: h.province, city: h.city, district: h.district });
      return;
    }
    const p = provinces?.find((x) => x.name === h.province) ?? null;
    const c = p?.cities.find((x) => x.name === h.city) ?? null;
    if (c && withDistrict && c.districts.length > 0) {
      setProv(p);
      setCity(c);
      setKeyword("");
      return;
    }
    finish({ province: h.province, city: h.city || h.province });
  }

  return (
    <View style={styles.body}>
      <Input
        value={keyword}
        onChangeText={setKeyword}
        placeholder="搜索，如「杭州」「西湖」或「hz」"
        autoCorrect={false}
        returnKeyType="search"
      />

      {provinces === null ? (
        <Text style={styles.empty}>正在加载地名…</Text>
      ) : keyword.trim() ? (
        hits.length === 0 ? (
          <Text style={styles.empty}>没有找到「{keyword.trim()}」相关的地名</Text>
        ) : (
          <View style={styles.wrap}>
            {hits.map((h) => (
              <Chip
                key={`${h.level}-${h.province}-${h.city}-${h.district ?? ""}`}
                label={hitLabel(h)}
                on={false}
                onPress={() => pickHit(h)}
              />
            ))}
          </View>
        )
      ) : (
        <View style={styles.cols}>
          <ScrollView ref={leftRef} style={styles.colLeft} showsVerticalScrollIndicator={false}>
            {provinces.map((p) => {
              const on = prov?.name === p.name;
              return (
                <Pressable
                  // ⚠️ key 用名字不用 code：港澳的省/市/区县在统计局数据里**没有 code**
                  // （都是空串），拿 code 当 key 会一堆兄弟节点撞同一个 key
                  key={p.name}
                  accessibilityRole="button"
                  accessibilityLabel={shortName(p.name)}
                  accessibilityState={{ selected: on }}
                  onPress={() => chooseProvince(p)}
                  style={[styles.provItem, on && styles.provItemOn]}
                >
                  <Text numberOfLines={1} style={[styles.provText, on && styles.provTextOn]}>
                    {shortName(p.name)}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>

          <View style={styles.colRight}>
            {city ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="返回上一级"
                onPress={() => setCity(null)}
                style={styles.parentBar}
              >
                <Text style={styles.parentText}>‹ {shortName(city.name)}</Text>
              </Pressable>
            ) : null}
            <ScrollView showsVerticalScrollIndicator={false}>
              {city ? (
                city.districts.map((d) => (
                  <Row
                    key={d.name}
                    label={shortName(d.name)}
                    on={value?.district === d.name && value?.city === city.name}
                    onPress={() => finish({ province: prov!.name, city: city.name, district: d.name })}
                  />
                ))
              ) : prov ? (
                prov.cities.map((c) => (
                  <Row
                    key={c.name}
                    label={shortName(c.name)}
                    on={value?.city === c.name && value?.province === prov.name}
                    onPress={() => chooseCity(c)}
                  />
                ))
              ) : (
                <Text style={styles.rightHint}>先在左边选省份</Text>
              )}
            </ScrollView>
          </View>
        </View>
      )}

      {value ? <Text style={styles.current}>当前：{fullName(value.province, value.city, value.district)}</Text> : null}
    </View>
  );
}

/** 右列的一行（市或区县） */
function Row({ label, on, onPress }: { label: string; on: boolean; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: on }}
      onPress={onPress}
      style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
    >
      <Text numberOfLines={1} style={[styles.rowText, on && styles.rowTextOn]}>
        {label}
      </Text>
    </Pressable>
  );
}

/** 搜索结果里的地名：区县级挂上上级，避免只看到一堆同名「西湖区」 */
function hitLabel(h: RegionHit): string {
  if (h.level === "district" && h.district) return `${shortName(h.district)}（${shortName(h.city)}）`;
  return shortName(h.city || h.province);
}

const styles = StyleSheet.create({
  body: { paddingHorizontal: space(5), paddingBottom: space(2), gap: space(3) },
  wrap: { flexDirection: "row", flexWrap: "wrap", gap: space(2) },
  empty: { paddingVertical: space(6), textAlign: "center", fontSize: font.label, color: colors.muted2 },
  current: { paddingTop: space(1), fontSize: font.caption, color: colors.muted2 },

  cols: {
    flexDirection: "row",
    height: space(78),
    borderRadius: radius.field,
    borderWidth: 1,
    borderColor: colors.line,
    overflow: "hidden",
  },
  // 左列是"通道"：底色压暗一层，选中的省翻成白底＋主色字，位置感最强
  colLeft: { width: space(24), backgroundColor: colors.lineSoft },
  provItem: { height: ROW_H, justifyContent: "center", paddingHorizontal: space(3) },
  provItemOn: { backgroundColor: colors.surface },
  provText: { fontSize: font.label, color: colors.muted },
  provTextOn: { color: colors.brand, fontWeight: "600" },

  colRight: { flex: 1, backgroundColor: colors.surface },
  // 钻进区县后，顶上留一条"回到市列表"的路
  parentBar: {
    paddingHorizontal: space(4),
    paddingVertical: space(2),
    backgroundColor: colors.brandSoft,
  },
  parentText: { fontSize: font.label, fontWeight: "600", color: colors.brand },
  rightHint: { paddingTop: space(8), textAlign: "center", fontSize: font.label, color: colors.muted2 },
  row: {
    paddingHorizontal: space(4),
    paddingVertical: space(3.5),
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.lineSoft,
  },
  rowPressed: { backgroundColor: colors.brandSoft },
  rowText: { fontSize: font.body, color: colors.ink2 },
  rowTextOn: { color: colors.brand, fontWeight: "600" },
});
