import { useEffect, useMemo, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Sheet } from "@/ui/sheet";
import { Chip } from "@/ui/chip";
import { Input } from "@/ui/input";
import { colors, font, space } from "@/theme";
import { loadRegions, searchRegions, shortName } from "@/lib/data/regions";
import type { City, Province, RegionHit } from "@/lib/data/regions";
import { fullName } from "@/lib/data/regions";
import type { RegionValue } from "@/onboarding/draft";

/**
 * 家乡 / 现居地。
 *
 * 三级联动（省 → 市 → 区县），但**两级就走完的情况有两种**：
 *   - `withDistrict=false`（家乡）：只要省市；
 *   - 直辖市：它的「市」就是自己，中间那一级没有意义，选完省直接进区县。
 *
 * 这里用**标签网格 + 搜索**，而不是 Web 那种长滚动列表。两个原因：
 *   1. 底部弹层的拖拽手势和里面的滚动控件会抢同一个纵向手势（见 `ui/sheet`），
 *      列表越长越难滚；标签是整块铺开、点一下就选中。
 *   2. 34 个省 / ≤21 个市 / ≤20 个区县，铺开最多 7 行，本来也不需要滚。
 *   搜不到的走搜索（支持中文、全拼、首字母，如「杭州」「hangzhou」「hz」）。
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

type Stage = "province" | "city" | "district";

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
  const [stage, setStage] = useState<Stage>("province");
  const [keyword, setKeyword] = useState("");
  const [prov, setProv] = useState<Province | null>(null);
  const [city, setCity] = useState<City | null>(null);

  useEffect(() => {
    let alive = true;
    loadRegions()
      .then((list) => alive && setProvinces(list))
      .catch(() => alive && setProvinces([]));
    return () => {
      alive = false;
    };
  }, []);

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
    if (p.isMunicipality) {
      // 直辖市的市就是它自己，跳过中间一级
      const c = p.cities[0];
      if (withDistrict && c && c.districts.length > 0) {
        setProv(p);
        setCity(c);
        setStage("district");
        return;
      }
      finish({ province: p.name, city: p.name });
      return;
    }
    setProv(p);
    setCity(null);
    setStage("city");
  }

  function chooseCity(c: City) {
    setKeyword("");
    if (withDistrict && c.districts.length > 0) {
      setCity(c);
      setStage("district");
      return;
    }
    finish({ province: prov!.name, city: c.name });
  }

  function pickHit(h: RegionHit) {
    const p = provinces?.find((x) => x.name === h.province) ?? null;
    // 家乡只要到市：命中到区县时把区县丢掉，不要存进库里
    if (h.level === "district" && h.district && withDistrict) {
      finish({ province: h.province, city: h.city, district: h.district });
      return;
    }
    const c = p?.cities.find((x) => x.name === h.city) ?? null;
    if (withDistrict && c && c.districts.length > 0) {
      setProv(p);
      setCity(c);
      setKeyword("");
      setStage("district");
      return;
    }
    finish({ province: h.province, city: h.city || h.province });
  }

  function back() {
    setKeyword("");
    if (stage === "district") {
      // 直辖市没有中间一级，退回省级而不是市级
      if (prov?.isMunicipality) {
        setProv(null);
        setCity(null);
        setStage("province");
        return;
      }
      setCity(null);
      setStage("city");
      return;
    }
    setProv(null);
    setStage("province");
  }

  const crumbs =
    stage === "province"
      ? "选择省份"
      : stage === "city"
        ? shortName(prov!.name)
        : `${shortName(prov!.name)}${prov!.isMunicipality ? "" : " " + shortName(city!.name)}`;

  return (
    <View style={styles.body}>
      {stage === "province" ? (
        <Input
          value={keyword}
          onChangeText={setKeyword}
          placeholder="搜索，如「杭州」「西湖」或「hz」"
          autoCorrect={false}
          returnKeyType="search"
        />
      ) : (
        <View style={styles.crumbRow}>
          <Text accessibilityRole="button" accessibilityLabel="返回上一级" onPress={back} style={styles.back}>
            ‹ 返回
          </Text>
          <Text style={styles.crumbText} numberOfLines={1}>
            {crumbs}
          </Text>
          <View style={styles.backSpacer} />
        </View>
      )}

      {provinces === null ? (
        <Text style={styles.empty}>正在加载地名…</Text>
      ) : stage === "province" && keyword.trim() ? (
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
      ) : stage === "province" ? (
        <View style={styles.wrap}>
          {provinces.map((p) => (
            <Chip key={p.code} label={shortName(p.name)} on={false} onPress={() => chooseProvince(p)} />
          ))}
        </View>
      ) : stage === "city" ? (
        <View style={styles.wrap}>
          {(prov?.cities ?? []).map((c) => (
            <Chip key={c.code} label={shortName(c.name)} on={false} onPress={() => chooseCity(c)} />
          ))}
        </View>
      ) : (
        <View style={styles.wrap}>
          {(city?.districts ?? []).map((d) => (
            <Chip
              key={d.code}
              label={shortName(d.name)}
              on={false}
              onPress={() => finish({ province: prov!.name, city: city!.name, district: d.name })}
            />
          ))}
          {/* 少数市没有下辖区县（如部分县级市）：给一个明确的出口，别让人卡住 */}
          <Chip
            label="这个市没有下级区县，直接选定"
            on={false}
            onPress={() => finish({ province: prov!.name, city: city!.name })}
          />
        </View>
      )}

      {value ? <Text style={styles.current}>当前：{fullName(value.province, value.city, value.district)}</Text> : null}
    </View>
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
  crumbRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  back: { fontSize: font.body, color: colors.brand, paddingVertical: space(1) },
  backSpacer: { width: 44 },
  crumbText: { flex: 1, textAlign: "center", fontSize: font.body, fontWeight: "600", color: colors.ink },
  empty: { paddingVertical: space(6), textAlign: "center", fontSize: font.label, color: colors.muted2 },
  current: { paddingTop: space(1), fontSize: font.caption, color: colors.muted2 },
});
