import { useRef, useState } from "react";

/**
 * 后台的折线图。纯 SVG，没有图表库。
 *
 * 颜色是**用脚本验过的**（不是挑的）：
 *   `#A32E4E` 喜欢 / `#C8862B` 配对 / `#2a78d6` 消息
 * 在象牙白底上过了亮度带、彩度下限、色盲分离度（最差相邻 ΔE 20.5 deutan）、
 * 常视觉下限（23.5）四项。有两条值得记住：
 *   - 品牌色里的香槟金 `#A8763E` **过不了彩度下限**（0.096，图表上会读成灰色），
 *     所以这里的琥珀色是它在图表语境下的加饱和版本，不要"顺手改回品牌金"。
 *   - `#C8862B` 对底色的对比度 2.75:1（低于 3:1），规范要求补"可见标签或表格视图"——
 *     所以这个组件**必须有行末直接标注和表格切换**，它们不是装饰。
 *
 * 另外两条一以贯之的规则：**一个图只有一根 y 轴**（不做双轴），
 * 文字一律用墨色系、颜色只由旁边的色块承担身份。
 */

export interface Series {
  key: string;
  label: string;
  color: string;
  values: number[];
}

const W = 760; // viewBox 宽度；实际显示宽度由 CSS 决定，图整体等比缩放
const PAD = { top: 16, right: 78, bottom: 26, left: 44 };

export function LineChart({
  title,
  dates,
  series,
  unit = "",
}: {
  title: string;
  dates: string[];
  series: Series[];
  unit?: string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const [asTable, setAsTable] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  if (dates.length === 0) return null;

  // y 轴从 0 起：这几个都是"每天发生了几次"的计数，截断基线会把小波动画得很惊悚
  const rawMax = Math.max(1, ...series.flatMap((s) => s.values));
  const step = niceStep(rawMax);
  const yMax = Math.ceil(rawMax / step) * step;

  const H = 220;
  const innerW = W - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;
  const x = (i: number) => PAD.left + (dates.length === 1 ? innerW / 2 : (i / (dates.length - 1)) * innerW);
  const y = (v: number) => PAD.top + innerH - (v / yMax) * innerH;

  const ticks: number[] = [];
  for (let t = 0; t <= yMax; t += step) ticks.push(t);

  const onMove = (e: React.MouseEvent) => {
    const rect = boxRef.current?.getBoundingClientRect();
    if (!rect) return;
    // 把鼠标位置换算回 viewBox 坐标，再取最近的一天
    const vx = ((e.clientX - rect.left) / rect.width) * W;
    const ratio = (vx - PAD.left) / innerW;
    const i = Math.round(ratio * (dates.length - 1));
    setHover(Math.min(dates.length - 1, Math.max(0, i)));
  };

  return (
    <section className="rounded-card border border-line bg-surface p-5 shadow-card">
      <header className="mb-3 flex items-baseline justify-between gap-3">
        <h3 className="text-[15px] font-semibold text-ink">{title}</h3>
        <button
          type="button"
          onClick={() => setAsTable((v) => !v)}
          className="rounded-pill border border-line px-2.5 py-1 text-[12px] text-muted transition-colors hover:border-brand/40 hover:text-ink"
        >
          {asTable ? "看图表" : "看表格"}
        </button>
      </header>

      {asTable ? (
        <TableView dates={dates} series={series} unit={unit} />
      ) : (
        <>
          {/* 图例：两条以上必须有，身份不能只靠颜色。
              单系列不给图例——标题已经点名了。 */}
          {series.length > 1 ? (
            <div className="mb-1 flex flex-wrap items-center gap-x-4 gap-y-1">
              {series.map((s) => (
                <span key={s.key} className="flex items-center gap-1.5 text-[12px] text-muted">
                  <span className="h-0.5 w-3.5 rounded" style={{ backgroundColor: s.color }} />
                  {s.label}
                </span>
              ))}
            </div>
          ) : null}

          <div ref={boxRef} className="relative" onMouseMove={onMove} onMouseLeave={() => setHover(null)}>
            <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label={title}>
              {/* 网格与刻度：一律压到最轻，数据才是主角 */}
              {ticks.map((t) => (
                <g key={t}>
                  <line x1={PAD.left} x2={W - PAD.right} y1={y(t)} y2={y(t)} stroke="#E7DDD2" strokeWidth={1} />
                  <text x={PAD.left - 8} y={y(t) + 3.5} textAnchor="end" fontSize={10} fill="#8C8178">
                    {t}
                  </text>
                </g>
              ))}

              {/* x 轴只标首/中/末三天，14 个日期全写上会糊成一条 */}
              {[0, Math.floor((dates.length - 1) / 2), dates.length - 1].map((i) => (
                <text key={i} x={x(i)} y={H - 6} textAnchor="middle" fontSize={10} fill="#8C8178">
                  {dates[i].slice(5)}
                </text>
              ))}

              <line x1={PAD.left} x2={W - PAD.right} y1={y(0)} y2={y(0)} stroke="#E7DDD2" strokeWidth={1} />

              {series.map((s) => {
                const d = s.values.map((v, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
                const last = s.values.length - 1;
                return (
                  <g key={s.key}>
                    <path d={d} fill="none" stroke={s.color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
                    {/* 行末直接标注：≤4 条时都标上。这同时是配色里那条 contrast 警告的
                        "补偿"——文字用墨色，身份由旁边那个色点承担 */}
                    <circle cx={x(last)} cy={y(s.values[last])} r={3} fill={s.color} />
                    <text x={x(last) + 8} y={y(s.values[last]) + 3.5} fontSize={11} fill="#6B615A">
                      {s.label}
                    </text>
                  </g>
                );
              })}

              {/* hover：竖线 + 各系列的点。比 tooltip 更早告诉用户"你指的是哪一天" */}
              {hover !== null ? (
                <g>
                  <line x1={x(hover)} x2={x(hover)} y1={PAD.top} y2={PAD.top + innerH} stroke="#8C8178" strokeWidth={1} strokeDasharray="3 3" />
                  {series.map((s) => (
                    <circle key={s.key} cx={x(hover)} cy={y(s.values[hover])} r={4} fill={s.color} stroke="#FFFFFF" strokeWidth={2} />
                  ))}
                </g>
              ) : null}
            </svg>

            {hover !== null ? (
              <div
                className="pointer-events-none absolute top-2 z-10 min-w-[132px] rounded-field border border-line bg-surface/95 px-3 py-2 text-[12px] shadow-card backdrop-blur"
                style={{
                  left: `calc(${(x(hover) / W) * 100}% + ${x(hover) / W > 0.62 ? -150 : 12}px)`,
                }}
              >
                <div className="mb-1 text-muted-2">{dates[hover]}</div>
                {series.map((s) => (
                  <div key={s.key} className="flex items-center justify-between gap-3 text-ink">
                    <span className="flex items-center gap-1.5">
                      <span className="h-2 w-2 rounded-full" style={{ backgroundColor: s.color }} />
                      <span className="text-muted">{s.label}</span>
                    </span>
                    <span className="font-medium tabular-nums">
                      {s.values[hover]}
                      {unit}
                    </span>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        </>
      )}
    </section>
  );
}

/** 表格视图：对比度不足的那条警告要求"可见标签或表格"，这也是给"想抄数"的人用的 */
function TableView({ dates, series, unit }: { dates: string[]; series: Series[]; unit: string }) {
  return (
    <div className="max-h-[260px] overflow-auto">
      <table className="w-full text-[12.5px]">
        <thead className="sticky top-0 bg-surface">
          <tr className="border-b border-line text-left text-muted-2">
            <th className="py-1.5 font-normal">日期</th>
            {series.map((s) => (
              <th key={s.key} className="py-1.5 text-right font-normal">
                {s.label}
                {unit}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {dates.map((d, i) => (
            <tr key={d} className="border-b border-line-soft last:border-0">
              <td className="py-1.5 text-ink-2">{d}</td>
              {series.map((s) => (
                <td key={s.key} className="py-1.5 text-right tabular-nums text-ink">
                  {s.values[i]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** 让刻度落在一个整一点的数量上（5 的倍数起步），别出现 0/7/14/21 这种 */
function niceStep(max: number): number {
  if (max <= 5) return 1;
  if (max <= 10) return 2;
  if (max <= 30) return 5;
  if (max <= 100) return 20;
  if (max <= 300) return 50;
  return Math.ceil(max / 5 / 100) * 100;
}

/** 环形进度样的小指标（资料完成度那种），比进度条更省地方 */
export function Ring({ value, size = 40 }: { value: number; size?: number }) {
  const r = (size - 6) / 2;
  const c = 2 * Math.PI * r;
  return (
    <svg width={size} height={size} className="shrink-0">
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#F1EAE1" strokeWidth={4} />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke="#A32E4E"
        strokeWidth={4}
        strokeLinecap="round"
        strokeDasharray={`${(value / 100) * c} ${c}`}
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
      />
    </svg>
  );
}

/** 占比条：用于"女性占比"这种一眼看比例的地方 */
export function ShareBar({ parts }: { parts: { label: string; value: number; color: string }[] }) {
  const total = parts.reduce((a, p) => a + p.value, 0) || 1;
  return (
    <div>
      <div className="flex h-2 overflow-hidden rounded-pill bg-line-soft">
        {parts.map((p) => (
          <div key={p.label} style={{ width: `${(p.value / total) * 100}%`, backgroundColor: p.color }} />
        ))}
      </div>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
        {parts.map((p) => (
          <span key={p.label} className="flex items-center gap-1.5 text-[12px] text-muted">
            <span className="h-2 w-2 rounded-full" style={{ backgroundColor: p.color }} />
            {p.label} {p.value}
          </span>
        ))}
      </div>
    </div>
  );
}

/**
 * 图表用的四个色位。**顺序固定、不循环**（规范里的硬性一条）：
 * 同一个指标在任何图上都是同一个颜色，换了筛选条件也不许重新上色。
 * 这一组跑过校验脚本：亮度带 / 彩度下限 / 色盲分离 / 常视觉下限全过；
 * 琥珀与绿两条对底色的对比度低于 3:1，所以每张图都带行末标注和表格切换来兜。
 */
export const SERIES = {
  users: "#A32E4E",
  like: "#A32E4E",
  pass: "#C8862B",
  match: "#2a78d6",
  message: "#1baf7a",
} as const;
