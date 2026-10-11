/**
 * 两个"填资料"用的选择器：地区（省市联动）与院校（纯搜索）。
 *
 * 这两个都是**弹层 + 交互**，本机看不到真机画面（没有模拟器，图形也渲染不了），
 * 所以只能靠"点一下、看它变成什么"来验：联动有没有真的换列、区县有没有钻进去、
 * 直辖市有没有跳过中间那一级、搜到的市会不会直接收口。
 *
 * 数据用的是**真数据**（`regions.generated` / `universities.generated`），
 * 不另造一份：省市的父子关系、杭州有没有「西湖区」，这些正是要验的东西。
 */
import { fireEvent, render } from "@testing-library/react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { RegionSheet } from "@/components/pickers/region-sheet";
import { UniversitySheet } from "@/components/pickers/list-sheets";
import type { RegionValue } from "@/onboarding/draft";

function wrap(ui: React.ReactElement) {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider
        initialMetrics={{ frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 47, left: 0, right: 0, bottom: 34 } }}
      >
        {ui}
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

/** 渲染一个打开的地区选择器，返回"最后一次写回的值"和当前树 */
function openRegion(opts: { withDistrict: boolean; value?: RegionValue | null } = { withDistrict: false }) {
  const picked: RegionValue[] = [];
  let closed = 0;
  const r = render(
    wrap(
      <RegionSheet
        open
        title={opts.withDistrict ? "现居地" : "家乡"}
        value={opts.value ?? null}
        withDistrict={opts.withDistrict}
        onChange={(v) => picked.push(v)}
        onClose={() => closed++}
      />
    )
  );
  return { ...r, picked, closedCount: () => closed };
}

describe("地区选择器（省市联动）", () => {
  it("先选省、右列才出市；点市即选定，不存区县", async () => {
    const r = openRegion({ withDistrict: false });
    // 地名是动态 import 进来的，等一下
    await r.findByLabelText("浙江");

    // 还没选省：右列不该有任何市
    expect(r.getByText("先在左边选省份")).toBeTruthy();
    expect(r.queryByLabelText("杭州")).toBeNull();

    fireEvent.press(r.getByLabelText("浙江"));
    // 联动：右列当场换成浙江的市（不需要再点一次"下一步"）
    expect(r.getByLabelText("杭州")).toBeTruthy();
    expect(r.getByLabelText("宁波")).toBeTruthy();
    // 换一个省，右列跟着换
    fireEvent.press(r.getByLabelText("广东"));
    expect(r.getByLabelText("广州")).toBeTruthy();
    expect(r.queryByLabelText("杭州")).toBeNull();

    fireEvent.press(r.getByLabelText("浙江"));
    fireEvent.press(r.getByLabelText("杭州"));
    expect(r.picked).toEqual([{ province: "浙江省", city: "杭州市" }]);
    expect(r.closedCount()).toBe(1);
    // 家乡只要到市：绝不能顺手把区县写进库
    expect("district" in r.picked[0]).toBe(false);
  });

  it("现居地多一级：选市之后钻进区县，能退回来重选", async () => {
    const r = openRegion({ withDistrict: true });
    await r.findByLabelText("浙江");

    fireEvent.press(r.getByLabelText("浙江"));
    fireEvent.press(r.getByLabelText("杭州"));

    // 钻进去了：右列变成区县，顶上是"回到市列表"的条
    expect(r.getByLabelText("西湖区")).toBeTruthy();
    expect(r.getByLabelText("返回上一级")).toBeTruthy();
    expect(r.queryByLabelText("宁波")).toBeNull();

    // 返回：回到市列表，区县消失
    fireEvent.press(r.getByLabelText("返回上一级"));
    expect(r.getByLabelText("宁波")).toBeTruthy();
    expect(r.queryByLabelText("西湖区")).toBeNull();

    fireEvent.press(r.getByLabelText("杭州"));
    fireEvent.press(r.getByLabelText("西湖区"));
    expect(r.picked).toEqual([{ province: "浙江省", city: "杭州市", district: "西湖区" }]);
  });

  it("直辖市没有中间那一级：家乡当场选完，现居地直接进区县", async () => {
    const home = openRegion({ withDistrict: false });
    await home.findByLabelText("北京");
    fireEvent.press(home.getByLabelText("北京"));
    expect(home.picked).toEqual([{ province: "北京市", city: "北京市" }]);

    const live = openRegion({ withDistrict: true });
    await live.findByLabelText("北京");
    fireEvent.press(live.getByLabelText("北京"));
    // 不给一个只有一项的"市列表"，直接列区县
    expect(live.getByLabelText("东城区")).toBeTruthy();
    fireEvent.press(live.getByLabelText("东城区"));
    expect(live.picked).toEqual([{ province: "北京市", city: "北京市", district: "东城区" }]);
  });

  it("搜索：还能按拼音找，且搜到的市会落进联动列表而不是直接收口", async () => {
    const r = openRegion({ withDistrict: true });
    await r.findByLabelText("浙江");

    fireEvent.changeText(r.getByPlaceholderText(/搜索/), "hz");
    // 搜索结果是 Chip（只有文字、没有 a11y label），按文字点
    fireEvent.press(await r.findByText("杭州"));

    // 没有直接写回，而是停在浙江/杭州的区县列表上——用户还能改主意
    expect(r.picked).toEqual([]);
    expect(r.getByLabelText("西湖区")).toBeTruthy();
  });

  it("带着已填的值打开：停在那个省，当前值也高亮", async () => {
    const r = openRegion({ withDistrict: false, value: { province: "浙江省", city: "杭州市" } });
    await r.findByLabelText("浙江");
    // 右列已经是浙江的市（而不是"先在左边选省份"）
    expect(r.getByLabelText("杭州")).toBeTruthy();
    expect(r.getByText("当前：浙江 杭州")).toBeTruthy();
  });

  it("港澳台没有统计局代码：选中判断不能跟着串（code 都是空串）", async () => {
    const r = openRegion({ withDistrict: false });
    // shortName 只剥「省/市」，特别行政区是全名
    await r.findByLabelText("香港特别行政区");

    fireEvent.press(r.getByLabelText("香港特别行政区"));
    // 右列出的是香港的市（数据里叫「香港岛」）
    expect(r.getByLabelText("香港岛")).toBeTruthy();
    // 只有香港是选中的：按 code 比的话，香港和澳门（code 都是空串）会一起亮
    expect(r.getByLabelText("香港特别行政区").props.accessibilityState.selected).toBe(true);
    expect(r.getByLabelText("澳门特别行政区").props.accessibilityState.selected).toBe(false);
  });
});


describe("院校选择器", () => {
  it("不再按省份铺标签，只靠输入搜索", async () => {
    const picked: string[] = [];
    const r = render(
      wrap(<UniversitySheet open value="" onChange={(v) => picked.push(v)} onClose={() => {}} />)
    );

    // 等数据加载完（加载完那行提示会换掉）
    await r.findByText(/直接输入学校名搜索/);
    // 没有省份那一排：北京/浙江这些当省份用的标签不该在
    expect(r.queryByText("北京")).toBeNull();
    expect(r.queryByText("浙江")).toBeNull();

    fireEvent.changeText(r.getByPlaceholderText(/搜学校/), "zj");
    fireEvent.press(await r.findByText("浙江大学"));
    expect(picked).toEqual(["浙江大学"]);
  });

  it("搜不到时给「其他院校」这条出路", async () => {
    const picked: string[] = [];
    const r = render(
      wrap(<UniversitySheet open value="" onChange={(v) => picked.push(v)} onClose={() => {}} />)
    );
    await r.findByText(/直接输入学校名搜索/);

    fireEvent.changeText(r.getByPlaceholderText(/搜学校/), "zzzzzz");
    await r.findByText(/没找到/);

    fireEvent.press(r.getByLabelText(/选择其他院校|选择/));
    expect(picked.length).toBe(1);
  });
});
