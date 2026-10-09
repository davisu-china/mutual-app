# 行政区划源数据

## 来源

**国家统计局**《统计用区划和城乡划分代码》——这是行政区划代码的权威出处。
（民政部公布的是行政区划调整公告，不含完整的代码表；业界普遍用统计局的这份。）

通过 npm 包 [`china-division`](https://www.npmjs.com/package/china-division)
（WTFPL 协议，可自由使用）获取，其数据直接整理自上述统计口径。

## 文件

| 文件 | 内容 |
|---|---|
| `pca-code.json` | 省 → 市 → 区，含行政区划代码（31 个省级，不含港澳台） |
| `HK-MO-TW.json` | 港澳台（统计局数据不含这三地，单独维护） |

## 更新方式

```bash
npm pack china-division
tar xzf china-division-*.tgz
cp package/dist/pca-code.json package/dist/HK-MO-TW.json web/data-src/
cd web && node scripts/gen-regions.mjs
```

重新生成后，`src/data/regions.generated.ts` 会更新，不需要改任何业务代码。
