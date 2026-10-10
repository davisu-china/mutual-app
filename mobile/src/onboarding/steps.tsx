import { useState, type Dispatch, type SetStateAction } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { Image } from "expo-image";
import { Ionicons } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import { ApiError, mediaImage } from "@/lib/api";
import { uploadPhoto } from "@/lib/upload";
import { Choice } from "@/ui/chip";
import { FieldRow } from "@/ui/field-row";
import { Input } from "@/ui/input";
import { Textarea } from "@/ui/textarea";
import { Sheet } from "@/ui/sheet";
import { useToast } from "@/ui/feedback";
import { colors, font, radius, shadow, space } from "@/theme";
import {
  ACCEPT_3,
  CAR_PREFER,
  DINK,
  DINK_ACCEPT,
  DRINKING,
  EDUCATION,
  EDUCATION_MIN,
  ELDERCARE,
  GENDER,
  HOBBIES,
  HOUSE,
  HOUSE_PREFER,
  INCOME,
  INCOME_LABEL_RANGE,
  INCOME_MAX_CHOICES,
  INCOME_MIN_CHOICES,
  PARTNER_TAGS,
  SMOKING,
  YES_NO,
} from "@/lib/labels";
import { INDUSTRIES, occupationValue } from "@/lib/data/occupation";
import { PROVINCE_NAMES, fullName } from "@/lib/data/regions";
import { DateSheet, NumberSheet, RangeSheet } from "@/components/pickers/wheel-sheets";
import { MbtiSheet } from "@/components/pickers/mbti-sheet";
import { RegionSheet } from "@/components/pickers/region-sheet";
import { MultiChoiceSheet, OccupationSheet, UniversitySheet } from "@/components/pickers/list-sheets";
import {
  HOBBY_DESC_MAX,
  HOBBY_DESC_MIN,
  TEXT_MAX,
  TEXT_MIN,
  birthdayText,
  calcAge,
  type Draft,
} from "@/onboarding/draft";

type Setter = <K extends keyof Draft>(k: K, v: Draft[K]) => void;

/** 身高/体重的范围和默认落点，与 Web 版一致（性别只改落点，不改范围） */
export const HEIGHT_RANGE = { min: 130, max: 230, male: 173, female: 162 };
export const WEIGHT_RANGE = { min: 30, max: 200, male: 70, female: 55 };
/** 期望身高：区间宽度至少留 5cm，和 Web 版双滑块的 gap 一致 */
export const PREF_HEIGHT = { min: 140, max: 210, gap: 5 };

export function genderOf(d: Draft): "male" | "female" {
  return d.gender === 2 ? "female" : "male";
}

/* ================================================================ 第一步 */

type Sheet1 = "birthday" | "height" | "weight" | "hometown" | "residence" | "occupation" | "school" | "mbti" | null;

export function Step1({ d, set }: { d: Draft; set: Setter }) {
  const toast = useToast();
  const [sheet, setSheet] = useState<Sheet1>(null);
  const [uploading, setUploading] = useState(false);
  const g = genderOf(d);

  /**
   * 选照片。
   *
   * `uploadPhoto()` 内部已经走完了 presign → 直传 → confirm，所以这里拿到
   * objectKey 就等于服务端已经存下了。**不要**在保存那一步再 confirm 一次——
   * Web 版是那时候才 confirm 的，照抄会变成两张照片。
   */
  async function pickPhoto() {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      toast("需要相册权限才能选照片", "error");
      return;
    }
    const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], quality: 0.85 });
    if (res.canceled) return;
    const asset = res.assets[0];
    setUploading(true);
    try {
      const key = await uploadPhoto(asset.uri, asset.mimeType ?? "image/jpeg");
      set("photoObjectKey", key);
      set("photoPreview", asset.uri);
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "照片上传失败，请重试", "error");
    } finally {
      setUploading(false);
    }
  }

  const previewSource = previewOf(d.photoPreview);

  return (
    <View style={styles.step}>
      <View style={styles.head}>
        <Text style={styles.title}>先认识一下你</Text>
        <Text style={styles.lede}>这些会决定给你推荐谁，也会出现在别人看到的卡片上。</Text>
      </View>

      {/* 第一张照片就是头像／封面，所以放在最上面、也做得最显眼 */}
      <View style={styles.avatarWrap}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={d.photoPreview ? "更换照片" : "上传照片"}
          onPress={() => void pickPhoto()}
          style={styles.avatar}
        >
          {previewSource ? (
            <Image source={previewSource} style={StyleSheet.absoluteFill} contentFit="cover" transition={200} />
          ) : uploading ? (
            <ActivityIndicator color={colors.brand} />
          ) : (
            <>
              <Ionicons name="camera-outline" size={22} color={colors.muted2} />
              <Text style={styles.avatarHint}>上传照片</Text>
            </>
          )}
        </Pressable>
        <Text style={styles.avatarNote}>
          {d.photoPreview ? "点一下可以换一张" : "至少一张（它就是你的头像，之后可以在「我的」里加更多并调整顺序）"}
        </Text>
      </View>

      <Choice label="性别" options={GENDER} value={d.gender} onChange={(v) => set("gender", v)} />
      {d.gender !== null ? <Text style={styles.note}>性别填写后不可修改，请确认无误</Text> : null}

      <FieldRow
        label="出生年月日"
        value={d.birthday ? birthdayText(d.birthday) : null}
        hint={d.birthday ? `${calcAge(d.birthday)} 岁` : undefined}
        icon="calendar-outline"
        onPress={() => setSheet("birthday")}
      />
      <FieldRow
        label="身高"
        value={d.heightCm ? `${d.heightCm} cm` : null}
        icon="resize-outline"
        onPress={() => setSheet("height")}
      />
      <FieldRow
        label="体重"
        value={d.weightKg ? `${d.weightKg} kg` : null}
        icon="barbell-outline"
        onPress={() => setSheet("weight")}
      />
      <FieldRow
        label="家乡"
        value={d.hometown ? fullName(d.hometown.province, d.hometown.city) : null}
        icon="home-outline"
        onPress={() => setSheet("hometown")}
      />
      <FieldRow
        label="现居地"
        value={d.residence ? fullName(d.residence.province, d.residence.city, d.residence.district) : null}
        icon="location-outline"
        onPress={() => setSheet("residence")}
      />
      <FieldRow
        label="职业"
        value={d.occupation}
        icon="briefcase-outline"
        onPress={() => setSheet("occupation")}
      />
      {/* MBTI 不铺 16 个类型：按四个维度各答一次（见 mbti-sheet.tsx）。
          放在这里是为了和身高/家乡/职业一样只占一行，别把这一屏撑长 */}
      <FieldRow
        label="MBTI"
        value={d.mbti}
        icon="sparkles-outline"
        onPress={() => setSheet("mbti")}
      />
      <Choice label="抽烟" options={SMOKING} value={d.smoking} onChange={(v) => set("smoking", v)} />
      <Choice label="喝酒" options={DRINKING} value={d.drinking} onChange={(v) => set("drinking", v)} />
      <Choice label="年收入" options={INCOME} value={d.incomeRange} columns={2} onChange={(v) => set("incomeRange", v)} />
      <Choice label="学历" options={EDUCATION} value={d.education} onChange={(v) => set("education", v)} />
      <FieldRow
        label="学校"
        value={d.school || null}
        icon="school-outline"
        onPress={() => setSheet("school")}
      />
      <Input
        label="公司"
        value={d.company}
        onChangeText={(v) => set("company", v)}
        placeholder="请输入公司"
        maxLength={30}
      />
      <Choice label="是否独生" options={YES_NO} value={d.isOnlyChild} onChange={(v) => set("isOnlyChild", v)} />
      <Choice label="有无养老压力" options={ELDERCARE} value={d.eldercarePressure} onChange={(v) => set("eldercarePressure", v)} />
      <Choice label="是否有车" options={YES_NO} value={d.hasCar} onChange={(v) => set("hasCar", v)} />
      <Choice label="是否有房" options={HOUSE} value={d.hasHouse} onChange={(v) => set("hasHouse", v)} />
      <Choice label="是否丁克" options={DINK} value={d.isDink} onChange={(v) => set("isDink", v)} />

      <DateSheet
        open={sheet === "birthday"}
        value={d.birthday}
        gender={g}
        onChange={(v) => set("birthday", v)}
        onClose={() => setSheet(null)}
      />
      <NumberSheet
        open={sheet === "height"}
        title="身高"
        value={d.heightCm}
        min={HEIGHT_RANGE.min}
        max={HEIGHT_RANGE.max}
        unit="cm"
        fallback={HEIGHT_RANGE[g]}
        onChange={(v) => set("heightCm", v)}
        onClose={() => setSheet(null)}
      />
      <NumberSheet
        open={sheet === "weight"}
        title="体重"
        value={d.weightKg}
        min={WEIGHT_RANGE.min}
        max={WEIGHT_RANGE.max}
        unit="kg"
        fallback={WEIGHT_RANGE[g]}
        onChange={(v) => set("weightKg", v)}
        onClose={() => setSheet(null)}
      />
      <RegionSheet
        open={sheet === "hometown"}
        title="家乡"
        value={d.hometown}
        withDistrict={false}
        onChange={(v) => set("hometown", v)}
        onClose={() => setSheet(null)}
      />
      <RegionSheet
        open={sheet === "residence"}
        title="现居地"
        value={d.residence}
        withDistrict
        onChange={(v) => set("residence", v)}
        onClose={() => setSheet(null)}
      />
      <OccupationSheet
        open={sheet === "occupation"}
        value={d.occupation}
        onChange={(v) => set("occupation", v)}
        onClose={() => setSheet(null)}
      />
      <UniversitySheet
        open={sheet === "school"}
        value={d.school}
        onChange={(v) => set("school", v)}
        onClose={() => setSheet(null)}
      />
      <MbtiSheet
        open={sheet === "mbti"}
        value={d.mbti}
        onChange={(v) => set("mbti", v)}
        onClose={() => setSheet(null)}
      />
    </View>
  );
}

/* ================================================================ 第二步 */

export function Step2({
  d,
  setD,
}: {
  d: Draft;
  setD: Dispatch<SetStateAction<Draft>>;
}) {
  const toast = useToast();
  const [picking, setPicking] = useState<number | null>(null);

  function setName(i: number, name: string) {
    setD((p) => {
      if (p.hobbies.some((h, j) => j !== i && h.name === name)) {
        toast("这个兴趣已经选过了");
        return p;
      }
      const hs = [...p.hobbies];
      hs[i] = { ...hs[i], name };
      return { ...p, hobbies: hs };
    });
  }

  function setDesc(i: number, description: string) {
    setD((p) => {
      const hs = [...p.hobbies];
      hs[i] = { ...hs[i], description };
      return { ...p, hobbies: hs };
    });
  }

  const used = new Set(d.hobbies.map((h) => h.name).filter(Boolean));

  return (
    <View style={styles.step}>
      <View style={styles.head}>
        <Text style={styles.title}>你的三个兴趣爱好</Text>
        <Text style={styles.lede}>每个都写几句具体的情况——这比标签本身更能让人认识你。</Text>
      </View>

      {d.hobbies.map((h, i) => (
        <View key={i} style={styles.hobbyCard}>
          <View style={styles.hobbyHead}>
            <View style={styles.hobbyIndex}>
              <Text style={styles.hobbyIndexText}>{i + 1}</Text>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`选择第 ${i + 1} 个兴趣`}
              onPress={() => setPicking(i)}
              style={[styles.hobbyPick, h.name ? null : styles.hobbyPickEmpty]}
            >
              <Text style={[styles.hobbyPickText, h.name ? null : styles.hobbyPickTextEmpty]}>
                {h.name || "选择兴趣"}
              </Text>
              <Ionicons name="chevron-forward" size={16} color={colors.muted2} />
            </Pressable>
          </View>
          <Textarea
            value={h.description}
            onChangeText={(v) => setDesc(i, v)}
            placeholder="比如：去年一个人去了川西，跑了 1200 公里，最喜欢在海拔 4000 米的垭口发呆"
            rows={3}
            max={HOBBY_DESC_MAX}
            minHint={HOBBY_DESC_MIN}
          />
        </View>
      ))}

      <HobbySheet
        open={picking !== null}
        used={used}
        onPick={(name) => {
          if (picking !== null) setName(picking, name);
          setPicking(null);
        }}
        onClose={() => setPicking(null)}
      />
    </View>
  );
}

function HobbySheet({
  open,
  used,
  onPick,
  onClose,
}: {
  open: boolean;
  used: Set<string>;
  onPick: (name: string) => void;
  onClose: () => void;
}) {
  return (
    <Sheet open={open} onClose={onClose} title="选择兴趣">
      <View style={styles.hobbyWrap}>
        {HOBBIES.map((name) => {
          // 已经用在别的格子上的兴趣置灰——三个兴趣写成同一个没有意义
          const taken = used.has(name);
          return (
            <Pressable
              key={name}
              accessibilityRole="button"
              accessibilityState={{ disabled: taken }}
              disabled={taken}
              onPress={() => onPick(name)}
              style={[styles.hobbyChip, taken && styles.hobbyChipOff]}
            >
              <Text style={[styles.hobbyChipText, taken && styles.hobbyChipTextOff]}>{name}</Text>
            </Pressable>
          );
        })}
      </View>
    </Sheet>
  );
}

/* ================================================================ 第三步 */

export function Step3({ d, set }: { d: Draft; set: Setter }) {
  return (
    <View style={styles.step}>
      <View style={styles.head}>
        <Text style={styles.title}>关于我</Text>
        <Text style={styles.lede}>用一段话补充前面的字段说不清的部分——性格、生活方式、你在意什么。</Text>
      </View>
      <Textarea
        value={d.aboutMe}
        onChangeText={(v) => set("aboutMe", v)}
        placeholder="比如：写代码也写字，周末不是在山里就是在咖啡馆。做事比较认真，不太会寒暄，但熟起来话很多。"
        rows={9}
        max={TEXT_MAX}
        minHint={TEXT_MIN}
      />
      <View style={styles.tipCard}>
        <Text style={styles.tipTitle}>一个小建议</Text>
        <Text style={styles.tipBody}>
          避免「喜欢旅游、看电影、美食」这种谁都能写的句子。写具体的事，比如「上个月在厦门住了五天，每天只去一个地方」。
        </Text>
      </View>
    </View>
  );
}

/* ================================================================ 第四步 */

type Sheet4 = "height" | "province" | "income" | null;

export function Step4({
  d,
  setPref,
}: {
  d: Draft;
  setPref: <K extends keyof Draft["pref"]>(k: K, v: Draft["pref"][K]) => void;
}) {
  const [sheet, setSheet] = useState<Sheet4>(null);
  const p = d.pref;

  /** 上下限互抬/互压，但「不限」那一端不钳制——和 Web 版的双滑块一致 */
  function pickMin(lo: number) {
    setPref("incomeMin", lo);
    if (p.incomeMax !== 7 && p.incomeMax < lo) setPref("incomeMax", lo);
  }
  function pickMax(hi: number) {
    setPref("incomeMax", hi);
    if (hi !== 7 && hi < p.incomeMin) setPref("incomeMin", hi);
  }

  return (
    <View style={styles.step}>
      <View style={styles.head}>
        <Text style={styles.title}>你期待的伴侣</Text>
        <Text style={styles.lede}>这些条件用来排序推荐，不是硬性筛选——不满足的人也可能出现在后面。</Text>
      </View>

      <FieldRow
        label="期望身高"
        value={`${p.heightMin}–${p.heightMax} cm`}
        icon="resize-outline"
        onPress={() => setSheet("height")}
      />
      <FieldRow
        label="期待家乡"
        value={p.hometownProvinces.length ? `${p.hometownProvinces.length} 个省份` : "不限"}
        hint={p.hometownProvinces.length ? p.hometownProvinces.join("、") : "可多选，不选即不限"}
        icon="home-outline"
        onPress={() => setSheet("province")}
      />

      <Choice label="抽烟" options={ACCEPT_3} value={p.smokingAccept} onChange={(v) => setPref("smokingAccept", v)} />
      <Choice label="喝酒" options={ACCEPT_3} value={p.drinkingAccept} onChange={(v) => setPref("drinkingAccept", v)} />

      <FieldRow
        label="期望年收入"
        value={INCOME_LABEL_RANGE(p.incomeMin, p.incomeMax)}
        icon="wallet-outline"
        onPress={() => setSheet("income")}
      />

      <Choice label="最低学历" options={EDUCATION_MIN} value={p.educationMin} onChange={(v) => setPref("educationMin", v)} />
      <Choice label="独生情况" options={ACCEPT_3} value={p.onlyChildAccept} onChange={(v) => setPref("onlyChildAccept", v)} />
      <Choice label="是否有车" options={CAR_PREFER} value={p.carPrefer} onChange={(v) => setPref("carPrefer", v)} />
      <Choice label="有房" options={HOUSE_PREFER} value={p.housePrefer} onChange={(v) => setPref("housePrefer", v)} />
      <Choice label="是否丁克" options={DINK_ACCEPT} value={p.dinkAccept} onChange={(v) => setPref("dinkAccept", v)} />
      <Text style={styles.note}>丁克分歧对关系影响较大，这里只留「接受 / 不接受」</Text>

      <View>
        <Text style={styles.groupLabel}>你的期待（可多选）</Text>
        <View style={styles.hobbyWrap}>
          {PARTNER_TAGS.map((t) => {
            const on = p.tags.includes(t);
            return (
              <Pressable
                key={t}
                accessibilityRole="button"
                accessibilityState={{ selected: on }}
                onPress={() => setPref("tags", on ? p.tags.filter((x) => x !== t) : [...p.tags, t])}
                style={[styles.hobbyChip, on && styles.tagChipOn]}
              >
                <Text style={[styles.hobbyChipText, on && styles.tagChipTextOn]}>{t}</Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      <RangeSheet
        open={sheet === "height"}
        title="期望身高"
        min={PREF_HEIGHT.min}
        max={PREF_HEIGHT.max}
        gap={PREF_HEIGHT.gap}
        valueMin={p.heightMin}
        valueMax={p.heightMax}
        unit="cm"
        onChange={(lo, hi) => {
          setPref("heightMin", lo);
          setPref("heightMax", hi);
        }}
        onClose={() => setSheet(null)}
      />
      <MultiChoiceSheet
        open={sheet === "province"}
        title="期待家乡"
        hint="可多选，不选即不限。"
        options={PROVINCE_NAMES}
        value={p.hometownProvinces}
        onChange={(v) => setPref("hometownProvinces", v)}
        onClose={() => setSheet(null)}
      />
      <IncomeSheet
        open={sheet === "income"}
        min={p.incomeMin}
        max={p.incomeMax}
        onPickMin={pickMin}
        onPickMax={pickMax}
        onClose={() => setSheet(null)}
      />
    </View>
  );
}

/** 期望收入：两组档位点选。人的收入是分档的类别值，用滑杆表达不了 */
function IncomeSheet({
  open,
  min,
  max,
  onPickMin,
  onPickMax,
  onClose,
}: {
  open: boolean;
  min: number;
  max: number;
  onPickMin: (v: number) => void;
  onPickMax: (v: number) => void;
  onClose: () => void;
}) {
  return (
    <Sheet open={open} onClose={onClose} title="期望年收入" confirmText="完成">
      <View style={styles.incomeBody}>
        <Choice label="至少" options={INCOME_MIN_CHOICES} value={min} columns={3} onChange={onPickMin} />
        <Choice label="至多" options={INCOME_MAX_CHOICES} value={max} columns={3} onChange={onPickMax} />
        <Text style={styles.note}>当前：{INCOME_LABEL_RANGE(min, max)}</Text>
      </View>
    </Sheet>
  );
}

/* ================================================================ 第五步 */

export function Step5({ d, set }: { d: Draft; set: Setter }) {
  return (
    <View style={styles.step}>
      <View style={styles.head}>
        <Text style={styles.title}>期待的那个他 / 她</Text>
        <Text style={styles.lede}>
          最后一件事：用文字描述一下你希望遇到什么样的人。这是你资料里最容易被认真读完的一段。
        </Text>
      </View>
      <Textarea
        value={d.expectPartner}
        onChangeText={(v) => set("expectPartner", v)}
        placeholder="比如：希望遇到一个能把话说清楚的人。不用很热闹，但要能聊到一块儿去——比如一起吐槽一部烂片，或者安静地各看各的书。"
        rows={9}
        max={TEXT_MAX}
        minHint={TEXT_MIN}
      />
    </View>
  );
}

/* ==================================================================== */


const styles = StyleSheet.create({
  step: { gap: space(4), paddingBottom: space(4) },
  head: { gap: space(1.5) },
  title: { fontSize: 22, fontWeight: "700", color: colors.ink },
  lede: { fontSize: 14, lineHeight: 22, color: colors.muted },
  note: { marginTop: -space(1), fontSize: font.caption, color: colors.muted2 },
  groupLabel: { marginBottom: space(2), fontSize: font.body, color: colors.muted },

  avatarWrap: { alignItems: "center", gap: space(2) },
  avatar: {
    width: 104,
    height: 104,
    borderRadius: 52,
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
    gap: space(1),
    backgroundColor: colors.surface,
    borderWidth: 2,
    borderStyle: "dashed",
    borderColor: colors.line,
    ...shadow.card,
  },
  avatarHint: { fontSize: font.caption, color: colors.muted2 },
  avatarNote: { paddingHorizontal: space(6), textAlign: "center", fontSize: font.caption, color: colors.muted2, lineHeight: 17 },

  hobbyCard: { borderRadius: radius.card, backgroundColor: colors.surface, padding: space(4), gap: space(3), ...shadow.card },
  hobbyHead: { flexDirection: "row", alignItems: "center", gap: space(2) },
  hobbyIndex: { width: 24, height: 24, borderRadius: 12, backgroundColor: colors.brandSoft, alignItems: "center", justifyContent: "center" },
  hobbyIndexText: { fontSize: 12, fontWeight: "700", color: colors.brandDark },
  hobbyPick: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: space(3),
    paddingVertical: space(2.5),
    borderRadius: radius.field,
    borderWidth: 1,
    borderColor: colors.line,
  },
  hobbyPickEmpty: { borderStyle: "dashed" },
  hobbyPickText: { fontSize: font.body, color: colors.ink },
  hobbyPickTextEmpty: { color: colors.muted2 },

  hobbyWrap: { flexDirection: "row", flexWrap: "wrap", gap: space(2), paddingHorizontal: space(5), paddingBottom: space(2) },
  hobbyChip: { paddingHorizontal: space(3.5), paddingVertical: space(2), borderRadius: radius.pill, borderWidth: 1, borderColor: colors.line },
  hobbyChipOff: { borderColor: colors.lineSoft, opacity: 0.4 },
  hobbyChipText: { fontSize: 14, color: colors.ink },
  hobbyChipTextOff: { color: colors.muted2 },
  tagChipOn: { borderColor: colors.brand, backgroundColor: colors.brandSoft },
  tagChipTextOn: { color: colors.brandDark, fontWeight: "600" },

  tipCard: { borderRadius: radius.card, backgroundColor: colors.brandSoft, padding: space(4), gap: space(1) },
  tipTitle: { fontSize: font.label, fontWeight: "600", color: colors.brandDark },
  tipBody: { fontSize: font.label, lineHeight: 21, color: colors.brandDark },

  incomeBody: { paddingHorizontal: space(5), paddingBottom: space(2), gap: space(4) },
});

/**
 * 预览图的来源。
 *
 * 两种来源要分开处理：
 *   - 刚在相册里选的（`file://` / `ph://` / `content://`）：直接把 URI 交给
 *     图片组件，**不能**拼服务端地址，否则会拼成 `https://…/file:///…`；
 *   - 服务端回填的（`/api/v1/media/...`）：媒体接口要鉴权，走 `mediaImage`
 *     带上 Bearer——原始图片组件支持自定义头，不必模拟浏览器 cookie。
 */
function previewOf(p: string | null) {
  if (!p) return null;
  if (p.startsWith("file:") || p.startsWith("ph:") || p.startsWith("content:")) return p;
  return mediaImage(p);
}
