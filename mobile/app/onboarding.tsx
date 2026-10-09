import { useCallback, useEffect, useRef, useState } from "react";
import {
  KeyboardAvoidingView,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useToast } from "@/ui/feedback";
import { Button } from "@/ui/button";
import { colors, font, radius, space } from "@/theme";
import {
  EMPTY,
  STEPS,
  backfill,
  hintFor,
  stepDone,
  stepRequest,
  type Draft,
  type ProfileSnapshot,
} from "@/onboarding/draft";
import { Step1, Step2, Step3, Step4, Step5 } from "@/onboarding/steps";

/**
 * 资料向导（五步）。
 *
 * 交互上的一件事：**每点一次「下一步」就先存服务端，存成功才翻页**。
 * 这样有三层好处——填到一半退出能续上（下次进来用 /users/me 回填）、
 * 出错时不会把用户留在"以为存了其实没存"的页面上、最后那步只需一次收口。
 *
 * 续填靠服务端而不是本地草稿：`/users/me` 那一组路由**刻意没有挂 OnboardGuard**
 * （见后端 router.go 的注释），所以资料没填完也能读回来。比本地存一份更稳——
 * 换设备、重装都在，也少一处会和服务器对不上的状态。
 *
 * 唯一回填不了的是**生日**：后端出于隐私把 `birthday` 标记为不下发（只给 age）。
 * 所以中途退出再进来，生日要重选一次，其余都能续上。
 */
export default function Onboarding() {
  const nav = useRouter();
  const insets = useSafeAreaInsets();
  const toast = useToast();
  const { markOnboarded } = useAuth();

  const [step, setStep] = useState(0);
  const [d, setD] = useState<Draft>(EMPTY);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");
  const scrollRef = useRef<ScrollView>(null);

  // 回填已有资料。失败就用空表单，不阻断——填资料这件事不能因为读不到旧数据而做不成。
  useEffect(() => {
    let alive = true;
    api
      .get<ProfileSnapshot>("/users/me")
      .then((p) => alive && setD((prev) => backfill(prev, p)))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  const set = useCallback(<K extends keyof Draft>(k: K, v: Draft[K]) => {
    setD((prev) => ({ ...prev, [k]: v }));
    setErr("");
  }, []);

  const setPref = useCallback(<K extends keyof Draft["pref"]>(k: K, v: Draft["pref"][K]) => {
    setD((prev) => ({ ...prev, pref: { ...prev.pref, [k]: v } }));
    setErr("");
  }, []);

  const done = stepDone(step, d);
  const last = step === STEPS.length - 1;
  // 进度条把"当前这页填完了"也算进去：填完立刻长一截，翻页之前就有反馈
  const pct = ((step + (done ? 1 : 0)) / STEPS.length) * 100;

  async function next() {
    if (!done || saving) return;
    setSaving(true);
    setErr("");
    try {
      const req = stepRequest(step, d);
      if (req) {
        const send = req.method === "patch" ? api.patch : req.method === "put" ? api.put : api.post;
        await send(req.path, req.body);
      }
      if (!last) {
        setStep(step + 1);
        scrollRef.current?.scrollTo({ y: 0, animated: false });
        return;
      }
      // 最后一步：收口，通过后服务端才会放行其他接口
      await api.post("/users/me/onboarding/complete", {});
      markOnboarded();
      toast("资料已完成，开始认识人吧");
      nav.replace("/(tabs)");
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "保存失败，请重试");
    } finally {
      setSaving(false);
    }
  }

  return (
    <KeyboardAvoidingView style={styles.root} behavior="padding" keyboardVerticalOffset={0}>
      {/* behavior 两端都用 padding，原因同 login.tsx：Android 15 起系统强制 edge-to-edge，
          adjustResize 失效，传 undefined 时 KAV 只渲染普通 View、完全不避让。 */}
      <View style={[styles.header, { paddingTop: insets.top + space(2) }]}>
        <View style={styles.headRow}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="上一步"
            onPress={() => step > 0 && setStep(step - 1)}
            hitSlop={10}
            style={[styles.backBtn, step === 0 && styles.backHidden]}
          >
            <Ionicons name="chevron-back" size={18} color={colors.muted2} />
            <Text style={styles.backText}>上一步</Text>
          </Pressable>
          <Text style={styles.stepLabel}>
            {step + 1} / {STEPS.length} · {STEPS[step]}
          </Text>
          <View style={styles.backBtn} />
        </View>
        <View style={styles.track}>
          <View style={[styles.fill, { width: `${pct}%` }]} />
        </View>
      </View>

      <ScrollView
        ref={scrollRef}
        style={styles.scroll}
        contentContainerStyle={styles.scrollBody}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
      >
        {step === 0 ? <Step1 d={d} set={set} /> : null}
        {step === 1 ? <Step2 d={d} setD={setD} /> : null}
        {step === 2 ? <Step3 d={d} set={set} /> : null}
        {step === 3 ? <Step4 d={d} setPref={setPref} /> : null}
        {step === 4 ? <Step5 d={d} set={set} /> : null}
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, space(3)) }]}>
        {err ? <Text style={styles.err}>{err}</Text> : null}
        {/* 差什么就说出来，而不是只把按钮置灰——用户不该猜为什么点不动 */}
        {!done && !err ? <Text style={styles.hint}>{hintFor(step, d)}</Text> : null}
        <Button
          label={last ? "完成，开始认识人" : "下一步"}
          onPress={() => void next()}
          disabled={!done}
          loading={saving}
          size="lg"
          block
        />
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.paper },
  header: {
    paddingHorizontal: space(5),
    paddingBottom: space(2),
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.lineSoft,
    gap: space(2),
  },
  headRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  backBtn: { flexDirection: "row", alignItems: "center", width: 76 },
  backHidden: { opacity: 0, pointerEvents: "none" },
  backText: { fontSize: 14, color: colors.muted2 },
  stepLabel: { fontSize: 13, fontWeight: "600", color: colors.brand },
  track: { height: 4, borderRadius: 2, backgroundColor: colors.lineSoft, overflow: "hidden" },
  fill: { height: "100%", borderRadius: 2, backgroundColor: colors.brand },
  scroll: { flex: 1 },
  scrollBody: { paddingHorizontal: space(5), paddingTop: space(5) },
  footer: {
    paddingHorizontal: space(5),
    paddingTop: space(3),
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.lineSoft,
    backgroundColor: colors.paper,
    gap: space(3),
  },
  err: {
    borderRadius: radius.field,
    backgroundColor: colors.brandSoft,
    paddingHorizontal: space(3),
    paddingVertical: space(2.5),
    fontSize: 13,
    color: colors.brandDark,
  },
  hint: { textAlign: "center", fontSize: 12.5, lineHeight: 19, color: colors.muted2 },
});
