/** Attach an unresolved draft only when the new message is answering or extending it. */
export function continuesTelegramDraft(text: string, clarification?: string, quote?: string, draftTexts: string[] = []): boolean {
  const latest = text.trim();
  const normalize = (value: string) => value.normalize("NFKC").replace(/\s+/gu,"").trim();
  if (quote && ![clarification ?? "",...draftTexts].some(value=>normalize(value)===normalize(quote))) return false;
  if (/^(?:補充(?:返)?|更正(?:返)?|修正(?:返)?|頭先嗰[個份段]|上面嗰[個份段]|啱啱嗰[個份段])/.test(latest)) return true;
  if (!clarification || /[?？]|幫我(?:查|搵|寫)|可唔可以|想問/.test(latest)) return false;

  if (quote && normalize(quote) === normalize(clarification)) return true;
  if (latest.length > 65) return false;

  const timeQuestion = /幾點|日期|時間|邊一日|邊日|原定|時段/.test(clarification);
  const timeReply = /^(?:係|原本係|原定係|原定|改做|改到|改去)?\s*(?:(?:今日|琴日|尋日|聽日|後日|下(?:個)?星期[一二三四五六日]|(?:星期|週)[一二三四五六日]|\d{1,4}(?:年\d{1,2}月\d{1,2}[日號]?|[/-]\d{1,2}(?:[/-]\d{1,2})?|月\d{1,2}[日號]?))[，, ]*)?(?:(?:朝早|上午|中午|下午|下晝|晚上|夜晚)\s*)?(?:(?:[零一二三四五六七八九十兩]+|\d{1,2})(?:點(?:半|\d{1,2}分)?|:\d{2}))?(?:呀|喇|啊)?[。！!]*$/.test(latest) &&
    /今日|琴日|尋日|聽日|後日|星期|週|朝早|上午|中午|下午|下晝|晚上|夜晚|[點:/月]/.test(latest);
  if (timeQuestion && timeReply) return true;

  return /(?:全名|姓名|係邊個客|邊位客)/.test(clarification) &&
    /^(?:(?:個客|客戶|全名)?係|客戶名(?:係|[:：]))\s*\S/.test(latest);
}
