/**
 * 「加我微信提建议」。
 *
 * 两个点值得钉住：
 *   1. 微信号是**服务端配的**——没配时调用方要能据此把整个入口藏起来（不能显示一个空的框）；
 *   2. 一键复制：用户不会为了一个微信号去手输字母数字。
 */
import { fireEvent, render, waitFor } from "@testing-library/react-native";
import * as Clipboard from "expo-clipboard";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { ToastProvider } from "@/ui/feedback";
import { SupportEntry, SupportSheet } from "@/components/support";

jest.mock("expo-clipboard", () => ({ setStringAsync: jest.fn(async () => true) }));

function wrap(ui: React.ReactElement) {
  return (
    <SafeAreaProvider
      initialMetrics={{ frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 47, left: 0, right: 0, bottom: 34 } }}
    >
      <ToastProvider>{ui}</ToastProvider>
    </SafeAreaProvider>
  );
}

describe("联系客服 / 提建议", () => {
  it("弹层里显示微信号，点复制就把它放进剪贴板", () => {
    const r = render(wrap(<SupportSheet open wechat="jianjiange_dev" onClose={() => {}} />));

    expect(r.getByText("有问题随时找我")).toBeTruthy();
    expect(r.getByText("jianjiange_dev")).toBeTruthy();

    fireEvent.press(r.getByText("复制微信号"));
    expect(Clipboard.setStringAsync).toHaveBeenCalledWith("jianjiange_dev");
  });

  it("复制完就关掉弹层（用户下一步是去微信里粘贴）", async () => {
    const onClose = jest.fn();
    const r = render(wrap(<SupportSheet open wechat="a_wx_id" onClose={onClose} />));
    fireEvent.press(r.getByText("复制微信号"));
    // 复制是异步的，关弹层在它之后
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it("「我的」里那一行说明白它是干什么的", () => {
    const onPress = jest.fn();
    const r = render(wrap(<SupportEntry onPress={onPress} />));
    expect(r.getByText("提建议 · 加我微信")).toBeTruthy();
    fireEvent.press(r.getByText("提建议 · 加我微信"));
    expect(onPress).toHaveBeenCalled();
  });
});
