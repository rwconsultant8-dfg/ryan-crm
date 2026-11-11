// 四季紅簿：人脈分類（取代《四季紅簿 2026》嘅分類部分）

export type Season = "SPRING" | "SUMMER" | "AUTUMN" | "WINTER";
export const NO_SEASON = "NONE";
export type SeasonColumn = Season | typeof NO_SEASON;

export type SeasonDef = {
  key: Season;
  label: string;
  emoji: string;
  state: string; // 有心／有力
  focus: string; // 行動方向
  actions: string[]; // 對應行動清單（照《四季紅簿 2026》紙本）
};

export const SEASONS: SeasonDef[] = [
  {
    key: "SPRING",
    label: "春",
    emoji: "🌱",
    state: "有力無心",
    focus: "建立 ICIC 信任",
    actions: [
      "Fact Finding → Needs",
      "賣人情（先付出後回報）",
      "了解你的人品／Marketing 加 FB／IG",
      "印象分",
      "能力表現",
      "共同話題",
      "Case 分享",
      "專業知識",
      "Lifestyle",
    ],
  },
  {
    key: "SUMMER",
    label: "夏",
    emoji: "☀️",
    state: "有心有力",
    focus: "專注成交",
    actions: [
      "NR2 → PC",
      "Confirm Appointment",
      "Preparation（功課）",
      "Drill",
      "Case Study",
      "狀態",
      "具備所有簽單條件",
    ],
  },
  {
    key: "AUTUMN",
    label: "秋",
    emoji: "🍂",
    state: "有心無力",
    focus: "培養中心人物",
    actions: [
      "開發 N",
      "重點培養深厚關係",
      "Ask Referral",
      "要求聽 Present（練習）",
      "準備一分鐘 Script（Referral）",
      "非必要事也多聯絡",
      "教育銷售概念",
      "認識身邊的人",
      "共同興趣",
    ],
  },
  {
    key: "WINTER",
    label: "冬",
    emoji: "❄️",
    state: "無心無力",
    focus: "招募人才",
    actions: [
      "開 N 物色人才",
      "分享 My Story 及公司",
      "建立互動關係",
      "發英雄帖",
      "搵出搵錢動機",
      "對現況不滿之處",
      "對行業睇法",
      "欣賞對方具備的條件",
    ],
  },
];

export const isSeason = (v: unknown): v is Season => SEASONS.some((s) => s.key === v);
export const seasonLabel = (s: string | null | undefined) => {
  const d = SEASONS.find((x) => x.key === s);
  return d ? `${d.emoji} ${d.label}` : "未分類";
};

/** 四季頁嘅「已簽」欄：階段係已簽／已出單嘅客會喺呢欄 */
export const SIGNED_ZONE = "SIGNED_ZONE";
