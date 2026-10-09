module.exports = function (api) {
  api.cache(true);
  return {
    presets: ["babel-preset-expo"],
    // Reanimated 4 把 babel 插件挪到了 react-native-worklets 这个包里，
    // 不挂它动画会在运行时直接报 "worklet" 相关错误。
    plugins: ["react-native-worklets/plugin"],
  };
};
