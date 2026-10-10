import { adminApi } from "./api";
import { LineChart, Ring, SERIES, ShareBar } from "./charts";
import { Card, ErrorNote, fmt, Kpi, Loading, pct, useAsync } from "./ui";

/**
 * 统计首页。
 *
 * 版面按"先结论、后分解"排：顶部是指标块（一眼看完今天的数），
 * 中间是趋势（判断在变好还是变坏），下面是构成（人是谁）。
 *
 * 趋势拆成四张图而不是一张四条线：**一个图只有一根 y 轴**，而"配对"（个位数）
 * 和"消息"（几十）量级差得远，塞进同一根轴里小的那条会贴着零线看不出形状。
 * 四张各自有各自的比例尺，读起来才准。
 */
export default function AdminDashboard() {
  const { data, error, loading, reload } = useAsync(() => adminApi.stats(), []);

  if (loading) return <Loading />;
  if (error || !data) return <ErrorNote msg={error ?? "取不到数据"} onRetry={reload} />;

  const { users, actions, matches, messages, engagement, daily } = data;
  const dates = daily.map((d) => d.date);

  return (
    <div className="space-y-5">
      {/* 第一屏：今天的数 */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="用户总数" value={fmt(users.total)} sub={`已完成资料 ${fmt(users.onboarded)}`} />
        <Kpi label="今日新增" value={fmt(users.newToday)} sub={`近 7 天 ${fmt(users.new7d)}`} tone="brand" />
        <Kpi label="今日登录" value={fmt(users.loginToday)} sub={`活跃账号 ${fmt(users.active)}`} />
        <Kpi label="配对总数" value={fmt(matches.total)} sub={`今日新增 ${fmt(matches.today)}`} tone="gold" />
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="划卡 · 喜欢" value={fmt(actions.like)} sub={`今日 ${fmt(actions.likeToday)}`} />
        <Kpi label="划卡 · 跳过" value={fmt(actions.pass)} sub={`今日 ${fmt(actions.passToday)}`} />
        <Kpi label="看过主页" value={fmt(actions.visit)} sub={`今日 ${fmt(actions.visitToday)}`} />
        <Kpi label="消息总数" value={fmt(messages.total)} sub={`会话 ${fmt(messages.conversations)} 个`} />
      </div>

      {/* 关键比率。这几个比绝对值更能说明产品好不好使 */}
      <Card title="关键比率">
        <div className="grid grid-cols-2 gap-x-6 gap-y-4 lg:grid-cols-4">
          <Rate
            label="右滑率"
            value={pct(engagement.likeRate)}
            hint="划卡时选择喜欢的比例"
          />
          <Rate
            label="回喜率"
            value={pct(engagement.mutualLikeRate)}
            hint="我发出的喜欢里，对方也喜欢过我"
          />
          <Rate
            label="会话开口率"
            value={pct(engagement.replyRate)}
            hint={`${fmt(messages.chattedConversations)} / ${fmt(messages.conversations)} 个会话有人开口`}
          />
          <Rate
            label="曝光转化率"
            value={pct(engagement.exposureToLike)}
            hint="被展示后被喜欢上的比例"
          />
        </div>
        <p className="mt-4 text-[12px] text-muted-2">
          配对了但没人开口是这类产品最主要的流失点，所以「开口率」单独给一个数，而不是藏在平均消息数里
          （当前平均每会话 {engagement.avgMessages.toFixed(1)} 条）。
        </p>
      </Card>

      {/* 趋势：四张图，各自的比例尺 */}
      <div className="grid gap-4 lg:grid-cols-2">
        <LineChart
          title="新增用户"
          dates={dates}
          series={[{ key: "registers", label: "新增", color: SERIES.users, values: daily.map((d) => d.registers) }]}
        />
        <LineChart
          title="划卡：喜欢 / 跳过"
          dates={dates}
          series={[
            { key: "like", label: "喜欢", color: SERIES.like, values: daily.map((d) => d.likes) },
            { key: "pass", label: "跳过", color: SERIES.pass, values: daily.map((d) => d.passes) },
          ]}
        />
        <LineChart
          title="配对"
          dates={dates}
          series={[{ key: "match", label: "配对", color: SERIES.match, values: daily.map((d) => d.matches) }]}
        />
        <LineChart
          title="消息"
          dates={dates}
          series={[{ key: "message", label: "消息", color: SERIES.message, values: daily.map((d) => d.messages) }]}
        />
      </div>

      {/* 构成 */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="性别构成">
          <ShareBar
            parts={[
              { label: "女", value: users.female, color: SERIES.users },
              { label: "男", value: users.male, color: SERIES.match },
              { label: "未填", value: users.genderUnset, color: "#8C8178" },
            ]}
          />
          <p className="mt-3 text-[12px] text-muted-2">
            这个比例直接决定推荐能不能成：男女数量差太多时，少的那一侧会一直看到重复的人。
          </p>
        </Card>

        <Card title="资料完成度">
          <div className="flex items-center gap-4">
            <Ring value={users.total ? (users.onboarded / users.total) * 100 : 0} size={56} />
            <div>
              <div className="text-[20px] font-semibold tabular-nums text-ink">
                {users.total ? pct(users.onboarded / users.total) : "—"}
              </div>
              <div className="text-[12px] text-muted">
                {fmt(users.onboarded)} / {fmt(users.total)} 走完了五步向导
              </div>
            </div>
          </div>
          <p className="mt-3 text-[12px] text-muted-2">
            没走完向导的账号进不了卡池、也不能划卡——所以这个比例等于"有效用户占比"。
          </p>
        </Card>
      </div>
    </div>
  );
}

function Rate({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div>
      <div className="text-[12px] text-muted-2">{label}</div>
      <div className="mt-0.5 text-[22px] font-semibold tabular-nums text-ink">{value}</div>
      <div className="mt-0.5 text-[12px] leading-relaxed text-muted">{hint}</div>
    </div>
  );
}
