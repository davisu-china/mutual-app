package model

import (
	"database/sql/driver"
	"fmt"
	"strings"
)

// StringArray 是 PostgreSQL text[] 的 Go 表示。
//
// 实现 driver.Valuer 与 sql.Scanner 之后，GORM 会自动用它读写 text[] 列，
// 不需要额外的 serializer 注册，也不用引 lib/pq。
//
// 用途：伴侣画像里的「期待家乡（多选省份）」与「期望标签（多选）」。
type StringArray []string

// Value 把切片编码成 PostgreSQL 的数组字面量：{"a","b"}。
// 注意反斜杠与双引号必须转义，否则省份名里出现特殊字符时会写坏数据。
func (a StringArray) Value() (driver.Value, error) {
	if a == nil {
		return nil, nil
	}
	var b strings.Builder
	b.WriteByte('{')
	esc := strings.NewReplacer(`\`, `\\`, `"`, `\"`)
	for i, s := range a {
		if i > 0 {
			b.WriteByte(',')
		}
		b.WriteByte('"')
		b.WriteString(esc.Replace(s))
		b.WriteByte('"')
	}
	b.WriteByte('}')
	return b.String(), nil
}

// Scan 解析 PostgreSQL 返回的数组字面量。
func (a *StringArray) Scan(src any) error {
	if src == nil {
		*a = nil
		return nil
	}

	var raw string
	switch v := src.(type) {
	case string:
		raw = v
	case []byte:
		raw = string(v)
	default:
		return fmt.Errorf("StringArray: 不支持的来源类型 %T", src)
	}

	parsed, err := parsePGArray(raw)
	if err != nil {
		return err
	}
	*a = parsed
	return nil
}

// parsePGArray 是一个最小的 PostgreSQL 数组字面量解析器。
//
// 支持的形式：{"a","b"}、{a,b}、{}、NULL
// 处理带引号元素中的转义（\" 与 \\），以及不带引号元素直到逗号为止。
func parsePGArray(raw string) ([]string, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" || raw == "NULL" {
		return nil, nil
	}
	if len(raw) < 2 || raw[0] != '{' || raw[len(raw)-1] != '}' {
		return nil, fmt.Errorf("StringArray: 不是合法的数组字面量: %q", raw)
	}

	body := raw[1 : len(raw)-1]
	if strings.TrimSpace(body) == "" {
		return []string{}, nil
	}

	var (
		out     []string
		cur     strings.Builder
		inQuote bool
		escaped bool
		started bool
	)

	flush := func() {
		if started {
			out = append(out, cur.String())
			cur.Reset()
			started = false
		}
	}

	for i := 0; i < len(body); i++ {
		c := body[i]

		if escaped {
			cur.WriteByte(c)
			escaped = false
			continue
		}
		if c == '\\' {
			escaped = true
			started = true
			continue
		}
		if c == '"' {
			inQuote = !inQuote
			started = true
			continue
		}
		if c == ',' && !inQuote {
			flush()
			continue
		}
		cur.WriteByte(c)
		started = true
	}
	flush()

	if inQuote {
		return nil, fmt.Errorf("StringArray: 引号未闭合: %q", raw)
	}
	return out, nil
}
