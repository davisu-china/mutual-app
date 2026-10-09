// 渲染冒烟测试用不到的原生模块在这里挡掉
jest.mock("expo-haptics", () => ({
  impactAsync: jest.fn(),
  notificationAsync: jest.fn(),
  selectionAsync: jest.fn(),
  ImpactFeedbackStyle: { Light: "light", Medium: "medium", Heavy: "heavy" },
  NotificationFeedbackType: { Success: "success", Warning: "warning", Error: "error" },
}));
jest.mock("expo-secure-store", () => ({
  getItemAsync: jest.fn(async () => null),
  setItemAsync: jest.fn(async () => {}),
  deleteItemAsync: jest.fn(async () => {}),
}));

// 手势库有官方 jest 环境
require("react-native-gesture-handler/jestSetup");

/**
 * 自己写一份 Reanimated 的最小替身。
 *
 * 不要用 `react-native-reanimated/mock`：那个 mock 自己又 require 了真实模块
 * （要装 TurboModule），在纯 JS 测试环境里照样炸。动画不是渲染测试的目标，
 * 这里只保证组件能画出结构。
 */
jest.mock("react-native-reanimated", () => {
  const React = require("react");
  const { View, Text, ScrollView } = require("react-native");
  const passthrough = (Base) => (props) => React.createElement(Base, props, props.children);
  return {
    __esModule: true,
    default: {
      View: passthrough(View),
      Text: passthrough(Text),
      ScrollView: passthrough(ScrollView),
      // 手势库要用它把普通组件包成可动画的
      createAnimatedComponent: (C) => C,
      createAnimatedPropAdapter: (fn) => fn,
      addWhitelistedNativeProps: () => {},
      addWhitelistedUIProps: () => {},
    },
    useSharedValue: (v) => ({ value: v }),
    useAnimatedStyle: () => ({}),
    useDerivedValue: (fn) => ({ value: fn() }),
    withTiming: (v) => v,
    withSpring: (v) => v,
    withDelay: (_d, v) => v,
    withSequence: (...v) => v[v.length - 1],
    interpolate: () => 0,
    interpolateColor: () => "#000000",
    runOnJS: (fn) => fn,
    runOnUI: (fn) => fn,
    useEvent: () => () => {},
    useHandler: () => ({ context: {}, doDependenciesDiffer: false }),
    useAnimatedGestureHandler: () => () => {},
    isSharedValue: () => false,
    Easing: { out: () => () => 0, inOut: () => () => 0, ease: () => 0 },
    // 入场/出场动画是链式配置（FadeInDown.delay(400).duration(280)），
    // 所以替身要能无限链下去
    ...(() => {
      const chain = () => {
        const o = {};
        for (const k of ["delay", "duration", "springify", "damping", "stiffness", "easing", "withInitialValues"]) {
          o[k] = () => o;
        }
        return o;
      };
      return {
        FadeIn: chain(), FadeOut: chain(), FadeInDown: chain(), FadeInUp: chain(),
        FadeOutDown: chain(), SlideInDown: chain(), SlideOutDown: chain(),
        Layout: chain(), LinearTransition: chain(),
      };
    })(),
  };
});
