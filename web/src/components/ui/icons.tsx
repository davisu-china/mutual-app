import {
  Baby,
  Brain,
  Briefcase,
  Building2,
  Cake,
  Cigarette,
  GraduationCap,
  Home,
  House,
  MapPin,
  Ruler,
  Scale,
  School,
  Users,
  Wallet,
  Wine,
  type LucideIcon,
} from "lucide-react";

/**
 * 资料字段 → 图标。
 *
 * 按中文标签查，资料页的每一行、他人主页、以及表单字段共用这一份——
 * 同一件事在三个地方用不同的图形会显得很随意。
 *
 * 为什么用图标库而不是继续手写 SVG：手写的那几个（返回箭头、行尾箭头）形状各异，
 * 粗细也不统一；lucide 是按统一网格画的，同一页放一排才像是同一套东西。
 * 它按需打包，用多少个图标就带多少个，不会把整套塞进包里。
 */
const FIELD_ICONS: Record<string, LucideIcon> = {
  身高: Ruler,
  期望身高: Ruler,
  体重: Scale,
  出生年月日: Cake,

  家乡: Home,
  现居地: MapPin,
  现居: MapPin,
  期待家乡: Home,

  职业: Briefcase,
  公司: Building2,
  学历: GraduationCap,
  最低学历: GraduationCap,
  学校: School,

  年收入: Wallet,
  期望年收入: Wallet,

  MBTI: Brain,
  抽烟: Cigarette,
  喝酒: Wine,

  是否有房: House,
  有房: House,
  是否独生: Users,
  独生情况: Users,
  有无养老压力: Users,
  是否丁克: Baby,
};

/** 查不到就返回 null，调用方直接不渲染图标即可（新增字段时不至于报错） */
export function fieldIcon(label: string): LucideIcon | null {
  return FIELD_ICONS[label] ?? null;
}
