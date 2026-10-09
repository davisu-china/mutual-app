import { Button } from "@/components/ui/button";
import { Empty } from "@/components/ui/empty";
import { FieldRow } from "@/components/ui/field-row";
import { Choice } from "@/components/ui/choice";
import { ProfileCard } from "@/components/deck/profile-card";
import { MessageRow } from "@/pages/Chat";
import { Heart, MessageCircle, UserRound, Compass, LayoutGrid } from "lucide-react";
import type { Card, Message } from "@/lib/api";

/**
 * 设计预览页（不对外宣传，也不在导航里出现）。
 *
 * 为什么需要它：调色这件事没法靠描述确认——「主色从亮粉换成酒红」这句话，
 * 听的人脑子里想的是自家那张色卡，看的人和改的人对不上。所以把**真实组件**
 * 渲染成一页，配色、按钮、卡片、气泡一次看全，看完再决定往哪调。
 *
 * 路径：/styleguide
 */

const SWATCHES: { name: string; cls: string; note: string }[] = [
  { name: "brand 主色", cls: "bg-brand", note: "深酒红 · 按钮、强调" },
  { name: "brand-dark", cls: "bg-brand-dark", note: "按下态 / 深文字" },
  { name: "brand-deep", cls: "bg-brand-deep", note: "渐变的深端" },
  { name: "brand-soft", cls: "bg-brand-soft", note: "选中态底色" },
  { name: "gold 香槟金", cls: "bg-gold", note: "只用于仪式感（配对）" },
  { name: "gold-soft", cls: "bg-gold-soft", note: "金底浅色" },
  { name: "paper 象牙白", cls: "bg-paper", note: "整站底色" },
  { name: "surface", cls: "bg-surface", note: "卡片" },
  { name: "line 暖沙", cls: "bg-line", note: "描边 / 分隔" },
  { name: "line-soft", cls: "bg-line-soft", note: "更浅的分隔" },
  { name: "ink 暖墨", cls: "bg-ink", note: "正文" },
  { name: "muted-2", cls: "bg-muted-2", note: "次要文字" },
];

const card: Card = {
  userId: 2, nickname: "小晴", age: 24, gender: 2, heightCm: 165,
  city: "上海市", cityProvince: "上海市",
  occupation: "互联网/IT · 产品经理", education: 3,
  distanceKm: 4, hasDistance: true,
  avatarUrl: "/preview-photo.jpg", photos: ["/preview-photo.jpg"],
  hobbies: ["摄影", "美食", "旅行"], completeness: 92, softMismatch: ["收入"],
};

const msg: Message = {
  id: 1, fromUser: 2, msgType: "text", content: "周末我去看了个展，人有点多但挺好看",
  seq: 1, status: "ok", createdAt: new Date().toISOString(),
};

export default function StyleGuide() {
  return (
    <div className="min-h-screen bg-paper px-5 py-8">
      <div className="mx-auto max-w-[520px] space-y-9">
        <header>
          <h1 className="text-[26px] font-bold tracking-tight text-ink">相悦 · 设计预览</h1>
          <p className="mt-1.5 text-[14px] leading-relaxed text-muted">
            这一页用**真实组件**渲染，调色和观感直接看这里，不必去 App 里找差别。
          </p>
        </header>

        <section>
          <h2 className="mb-3 text-[16px] font-semibold tracking-tight text-ink">色板</h2>
          <div className="grid grid-cols-2 gap-3">
            {SWATCHES.map((s) => (
              <div key={s.name} className="overflow-hidden rounded-field bg-surface shadow-card">
                <div className={`h-14 w-full ${s.cls}`} />
                <div className="px-3 py-2">
                  <p className="text-[13px] font-medium text-ink">{s.name}</p>
                  <p className="text-[11.5px] text-muted-2">{s.note}</p>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section>
          <h2 className="mb-3 text-[16px] font-semibold tracking-tight text-ink">
            划卡 / 广场卡片（整图出血）
          </h2>
          <div className="grid grid-cols-2 gap-3">
            <div className="h-[240px]">
              <ProfileCard card={card} compact />
            </div>
            <div className="h-[240px]">
              <ProfileCard card={{ ...card, nickname: "苏禾", city: "杭州市" }} compact />
            </div>
          </div>
          <div className="mt-3 h-[340px]">
            <ProfileCard card={{ ...card, nickname: "安然" }} />
          </div>
        </section>

        <section>
          <h2 className="mb-3 text-[16px] font-semibold tracking-tight text-ink">按钮</h2>
          <div className="flex flex-wrap items-center gap-3 rounded-card bg-surface p-4 shadow-card">
            <Button>喜欢</Button>
            <Button variant="outline">跳过</Button>
            <Button variant="ghost">重置</Button>
            <Button variant="danger">举报</Button>
            <Button size="sm">小按钮</Button>
            <Button size="lg">大按钮</Button>
          </div>
        </section>

        <section>
          <h2 className="mb-3 text-[16px] font-semibold tracking-tight text-ink">表单字段与选项</h2>
          <div className="space-y-3 rounded-card bg-surface p-4 shadow-card">
            <FieldRow label="职业" value="互联网/IT · 产品经理" onClick={() => {}} />
            <FieldRow label="年收入" onClick={() => {}} />
            <Choice label="学历" options={[
              { value: 1, label: "高中及以下" }, { value: 2, label: "大专" },
              { value: 3, label: "本科" }, { value: 4, label: "硕士" },
            ]} value={3} onChange={() => {}} />
          </div>
        </section>

        <section>
          <h2 className="mb-3 text-[16px] font-semibold tracking-tight text-ink">聊天</h2>
          <div className="space-y-1 rounded-card bg-surface p-4 shadow-card">
            <MessageRow message={msg} mine={false} myAvatar="/preview-photo.jpg" peerAvatar="/preview-photo.jpg" showAvatar />
            <MessageRow message={{ ...msg, id: 2, content: "我也很喜欢那个展厅的光" }} mine myAvatar="/preview-photo.jpg" peerAvatar="/preview-photo.jpg" showAvatar />
            <MessageRow message={{ ...msg, id: 3, content: "下次一起去？", fromUser: 2 }} mine={false} myAvatar="/preview-photo.jpg" peerAvatar="/preview-photo.jpg" showAvatar />
          </div>
        </section>

        <section>
          <h2 className="mb-3 text-[16px] font-semibold tracking-tight text-ink">底部导航</h2>
          <nav className="rounded-card bg-surface/85 shadow-card backdrop-blur-xl">
            <div className="flex">
              {[
                { label: "发现", Icon: Compass, on: true },
                { label: "广场", Icon: LayoutGrid, on: false },
                { label: "心动", Icon: Heart, on: false },
                { label: "消息", Icon: MessageCircle, on: false },
                { label: "我的", Icon: UserRound, on: false },
              ].map((t) => (
                <div key={t.label} className="flex flex-1 flex-col items-center gap-1 py-2">
                  <span className={`flex h-7 w-12 items-center justify-center rounded-full ${t.on ? "bg-brand-soft" : ""}`}>
                    <t.Icon size={21} strokeWidth={t.on ? 2.3 : 1.8} className={t.on ? "text-brand" : "text-muted-2"} />
                  </span>
                  <span className={t.on ? "text-[12.5px] font-semibold text-brand" : "text-[12.5px] text-muted-2"}>
                    {t.label}
                  </span>
                </div>
              ))}
            </div>
          </nav>
        </section>

        <section>
          <h2 className="mb-3 text-[16px] font-semibold tracking-tight text-ink">空态</h2>
          <div className="rounded-card bg-surface shadow-card">
            <Empty icon={Heart} title="还没有人喜欢你" desc="完善资料、多上传几张照片，会明显提高被喜欢的概率。" />
          </div>
        </section>
      </div>
    </div>
  );
}
