module.exports = function (api) {
  // 缓存要跟着 NODE_ENV 走：下面按环境挂不同的插件，写死 cache(true) 会把
  // 测试环境那份配置缓存给打包用（babel 会直接报 "Caching has already been configured"）
  api.cache.using(() => process.env.NODE_ENV);
  // jest 跑在 CJS 里，原生 `import()` 会直接报
  // "A dynamic import callback was invoked without --experimental-vm-modules"。
  // 受影响的是**懒加载的数据**（地名 216KB、院校名单），它们因此永远是空的——
  // 症状是"选择器里一个选项都没有"，很容易误判成组件写错了。
  // 所以只在测试环境把 import() 降级成 require；打包时仍是真正的动态 import（会切 chunk）。
  const isTest = api.env("test");
  return {
    presets: ["babel-preset-expo"],
    plugins: [
      // Reanimated 4 把 babel 插件挪到了 react-native-worklets 这个包里，
      // 不挂它动画会在运行时直接报 "worklet" 相关错误。
      "react-native-worklets/plugin",
      ...(isTest ? ["dynamic-import-node"] : []),
    ],
  };
};
