/**
 * 省市行政区划数据。
 *
 * ⚠️ 这是一份「够用且准确到地级市」的初始数据，覆盖 34 个省级行政区。
 * 生产环境建议替换为民政部《中华人民共和国行政区划代码》的官方数据，
 * 或使用 npm 上的 `china-division`；届时本文件的接口保持不变即可。
 */

export interface Region {
  /** 省级行政区全称，如「浙江省」「内蒙古自治区」 */
  name: string;
  /** 下辖地级行政区全称 */
  cities: string[];
}

export const REGIONS: Region[] = [
  { name: "北京市", cities: ["北京市"] },
  { name: "天津市", cities: ["天津市"] },
  { name: "上海市", cities: ["上海市"] },
  { name: "重庆市", cities: ["重庆市"] },
  { name: "河北省", cities: ["石家庄市","唐山市","秦皇岛市","邯郸市","邢台市","保定市","张家口市","承德市","沧州市","廊坊市","衡水市"] },
  { name: "山西省", cities: ["太原市","大同市","阳泉市","长治市","晋城市","朔州市","晋中市","运城市","忻州市","临汾市","吕梁市"] },
  { name: "内蒙古自治区", cities: ["呼和浩特市","包头市","乌海市","赤峰市","通辽市","鄂尔多斯市","呼伦贝尔市","巴彦淖尔市","乌兰察布市","兴安盟","锡林郭勒盟","阿拉善盟"] },
  { name: "辽宁省", cities: ["沈阳市","大连市","鞍山市","抚顺市","本溪市","丹东市","锦州市","营口市","阜新市","辽阳市","盘锦市","铁岭市","朝阳市","葫芦岛市"] },
  { name: "吉林省", cities: ["长春市","吉林市","四平市","辽源市","通化市","白山市","松原市","白城市","延边朝鲜族自治州"] },
  { name: "黑龙江省", cities: ["哈尔滨市","齐齐哈尔市","鸡西市","鹤岗市","双鸭山市","大庆市","伊春市","佳木斯市","七台河市","牡丹江市","黑河市","绥化市","大兴安岭地区"] },
  { name: "江苏省", cities: ["南京市","无锡市","徐州市","常州市","苏州市","南通市","连云港市","淮安市","盐城市","扬州市","镇江市","泰州市","宿迁市"] },
  { name: "浙江省", cities: ["杭州市","宁波市","温州市","嘉兴市","湖州市","绍兴市","金华市","衢州市","舟山市","台州市","丽水市"] },
  { name: "安徽省", cities: ["合肥市","芜湖市","蚌埠市","淮南市","马鞍山市","淮北市","铜陵市","安庆市","黄山市","滁州市","阜阳市","宿州市","六安市","亳州市","池州市","宣城市"] },
  { name: "福建省", cities: ["福州市","厦门市","莆田市","三明市","泉州市","漳州市","南平市","龙岩市","宁德市"] },
  { name: "江西省", cities: ["南昌市","景德镇市","萍乡市","九江市","新余市","鹰潭市","赣州市","吉安市","宜春市","抚州市","上饶市"] },
  { name: "山东省", cities: ["济南市","青岛市","淄博市","枣庄市","东营市","烟台市","潍坊市","济宁市","泰安市","威海市","日照市","临沂市","德州市","聊城市","滨州市","菏泽市"] },
  { name: "河南省", cities: ["郑州市","开封市","洛阳市","平顶山市","安阳市","鹤壁市","新乡市","焦作市","濮阳市","许昌市","漯河市","三门峡市","南阳市","商丘市","信阳市","周口市","驻马店市","济源市"] },
  { name: "湖北省", cities: ["武汉市","黄石市","十堰市","宜昌市","襄阳市","鄂州市","荆门市","孝感市","荆州市","黄冈市","咸宁市","随州市","恩施土家族苗族自治州"] },
  { name: "湖南省", cities: ["长沙市","株洲市","湘潭市","衡阳市","邵阳市","岳阳市","常德市","张家界市","益阳市","郴州市","永州市","怀化市","娄底市","湘西土家族苗族自治州"] },
  { name: "广东省", cities: ["广州市","韶关市","深圳市","珠海市","汕头市","佛山市","江门市","湛江市","茂名市","肇庆市","惠州市","梅州市","汕尾市","河源市","阳江市","清远市","东莞市","中山市","潮州市","揭阳市","云浮市"] },
  { name: "广西壮族自治区", cities: ["南宁市","柳州市","桂林市","梧州市","北海市","防城港市","钦州市","贵港市","玉林市","百色市","贺州市","河池市","来宾市","崇左市"] },
  { name: "海南省", cities: ["海口市","三亚市","三沙市","儋州市"] },
  { name: "四川省", cities: ["成都市","自贡市","攀枝花市","泸州市","德阳市","绵阳市","广元市","遂宁市","内江市","乐山市","南充市","眉山市","宜宾市","广安市","达州市","雅安市","巴中市","资阳市","阿坝藏族羌族自治州","甘孜藏族自治州","凉山彝族自治州"] },
  { name: "贵州省", cities: ["贵阳市","六盘水市","遵义市","安顺市","毕节市","铜仁市","黔西南布依族苗族自治州","黔东南苗族侗族自治州","黔南布依族苗族自治州"] },
  { name: "云南省", cities: ["昆明市","曲靖市","玉溪市","保山市","昭通市","丽江市","普洱市","临沧市","楚雄彝族自治州","红河哈尼族彝族自治州","文山壮族苗族自治州","西双版纳傣族自治州","大理白族自治州","德宏傣族景颇族自治州","怒江傈僳族自治州","迪庆藏族自治州"] },
  { name: "西藏自治区", cities: ["拉萨市","日喀则市","昌都市","林芝市","山南市","那曲市","阿里地区"] },
  { name: "陕西省", cities: ["西安市","铜川市","宝鸡市","咸阳市","渭南市","延安市","汉中市","榆林市","安康市","商洛市"] },
  { name: "甘肃省", cities: ["兰州市","嘉峪关市","金昌市","白银市","天水市","武威市","张掖市","平凉市","酒泉市","庆阳市","定西市","陇南市","临夏回族自治州","甘南藏族自治州"] },
  { name: "青海省", cities: ["西宁市","海东市","海北藏族自治州","黄南藏族自治州","海南藏族自治州","果洛藏族自治州","玉树藏族自治州","海西蒙古族藏族自治州"] },
  { name: "宁夏回族自治区", cities: ["银川市","石嘴山市","吴忠市","固原市","中卫市"] },
  { name: "新疆维吾尔自治区", cities: ["乌鲁木齐市","克拉玛依市","吐鲁番市","哈密市","昌吉回族自治州","博尔塔拉蒙古自治州","巴音郭楞蒙古自治州","阿克苏地区","克孜勒苏柯尔克孜自治州","喀什地区","和田地区","伊犁哈萨克自治州","塔城地区","阿勒泰地区"] },
  { name: "台湾省", cities: ["台北市","新北市","桃园市","台中市","台南市","高雄市","基隆市","新竹市","嘉义市"] },
  { name: "香港特别行政区", cities: ["香港岛","九龙","新界"] },
  { name: "澳门特别行政区", cities: ["澳门半岛","氹仔","路环"] },
];

/**
 * 热门城市：约 80% 的用户会选这十几个。
 * 单独提出来置顶，避免他们在一屏之外的列表里翻找——
 * 这是省市选择器体验好坏的关键分水岭。
 */
export const HOT_CITIES: {
  city: string;
  province: string;
  /** 全拼，如 hangzhou */
  py: string;
  /** 拼音首字母，如 hz */
  initials: string;
}[] = [
  { city: "北京市", province: "北京市", py: "beijing", initials: "bj" },
  { city: "上海市", province: "上海市", py: "shanghai", initials: "sh" },
  { city: "广州市", province: "广东省", py: "guangzhou", initials: "gz" },
  { city: "深圳市", province: "广东省", py: "shenzhen", initials: "sz" },
  { city: "杭州市", province: "浙江省", py: "hangzhou", initials: "hz" },
  { city: "成都市", province: "四川省", py: "chengdu", initials: "cd" },
  { city: "南京市", province: "江苏省", py: "nanjing", initials: "nj" },
  { city: "武汉市", province: "湖北省", py: "wuhan", initials: "wh" },
  { city: "西安市", province: "陕西省", py: "xian", initials: "xa" },
  { city: "重庆市", province: "重庆市", py: "chongqing", initials: "cq" },
  { city: "苏州市", province: "江苏省", py: "suzhou", initials: "sz" },
  { city: "长沙市", province: "湖南省", py: "changsha", initials: "cs" },
  { city: "天津市", province: "天津市", py: "tianjin", initials: "tj" },
  { city: "郑州市", province: "河南省", py: "zhengzhou", initials: "zz" },
  { city: "青岛市", province: "山东省", py: "qingdao", initials: "qd" },
];

/** 去掉「市」后缀用于展示；自治州、地区、盟等保留全称（去掉会歧义） */
export function shortName(name: string): string {
  return name.endsWith("市") ? name.slice(0, -1) : name;
}

export interface CityHit {
  province: string;
  city: string;
}

/**
 * 搜索城市。
 *
 * 匹配规则（按优先级）：拼音/首字母前缀 > 城市名中文包含 > 省份名中文包含。
 * 拼音放最前是因为它最精确——搜「nanjing」不该被「南京」以外的结果干扰。
 *
 * 说明：拼音目前只覆盖热门城市。生产环境建议接入 `pinyin-pro`，
 * 为全部城市生成全拼与首字母索引，这样输入「hrb」也能搜到哈尔滨。
 * 本函数的签名不变，替换实现即可。
 */
export function searchCities(keyword: string, limit = 30): CityHit[] {
  const kw = keyword.trim().toLowerCase();
  if (!kw) return [];

  const cityHits: CityHit[] = [];
  const provinceHits: CityHit[] = [];
  const pinyinHits: CityHit[] = [];

  for (const region of REGIONS) {
    for (const city of region.cities) {
      if (city.toLowerCase().includes(kw)) {
        cityHits.push({ province: region.name, city });
      }
    }
    if (region.name.toLowerCase().includes(kw)) {
      for (const city of region.cities) {
        provinceHits.push({ province: region.name, city });
      }
    }
  }

  for (const hot of HOT_CITIES) {
    // 中文用户最常用的其实是首字母（hz → 杭州），比全拼更短。
    // 两者都支持：全拼前缀 + 首字母前缀。
    if (hot.py.startsWith(kw) || hot.initials.startsWith(kw)) {
      pinyinHits.push({ province: hot.province, city: hot.city });
    }
  }

  // 去重，保持优先级顺序
  const seen = new Set<string>();
  const out: CityHit[] = [];
  for (const hit of [...pinyinHits, ...cityHits, ...provinceHits]) {
    const key = `${hit.province}/${hit.city}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(hit);
    if (out.length >= limit) break;
  }
  return out;
}
