package service

import "fmt"

// InvalidInputError 表示「用户填的内容不合法」。
//
// 这类错误的消息是**写给用户看的**——「昵称需要 2–12 个字」「还有未填写的必填项：体重」
// 之类。mapErr 会把它翻成 400 并把消息原样透出；其它未识别的错误一律 500 +
// 通用文案，避免把内部细节漏给客户端。
//
// 为什么要有这个类型：改造前这些校验都用 errors.New 直接返回，落到 mapErr 的
// default 分支，于是**用户填错东西只看到「服务暂时不可用，请稍后重试」**——
// 五步填资料的主流程上，所有提示都是不可见的。
type InvalidInputError struct{ Msg string }

func (e InvalidInputError) Error() string { return e.Msg }

// invalidInput 造一个「给用户看的」校验错误。
func invalidInput(format string, a ...any) error {
	return InvalidInputError{Msg: fmt.Sprintf(format, a...)}
}
