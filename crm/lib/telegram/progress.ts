import { isClientNote } from "../assistant/schema";

/** Rough processing ranges, not a completion deadline. */
export function processingEstimate(text:string):string|null {
  if (isClientNote(text)) return null;
  const request=text.replace(/\[本次上傳檔案：[\s\S]*?\]/g,'');
  const document=/(?:OCR|掃描|辨認|識別|填表|填寫.*(?:表格|PDF)|(?:改|修改|翻譯|整理|處理).*(?:PowerPoint|PPTX?|簡報|PDF|Excel|XLSX?|文件)|(?:PowerPoint|PPTX?|簡報|PDF|Excel|XLSX?).*(?:改|修改|翻譯|整理|處理))/i.test(request);
  if(document)return '🛠️ 預計約 3–8 分鐘，實際視文件大小同內容而定。';
  if(/上網|搜尋|搜索|查資料|查閱|查證|搵.*(?:小冊子|資料|來源|文件)|下載|download|最新|比較|分析|詳細|深入|完整.*(?:報告|方案)|計劃書/i.test(request)||request.length>240)
    return '🔎 預計約 2–5 分鐘，資料較多可能需要耐啲。';
  return null;
}
export const queuedAcknowledgement=(text:string)=>processingEstimate(text);
export function toolProcessingEstimate(name:string){
  return ['web_search','open_url','download_file'].includes(name)
    ?'🔎 呢個問題需要查資料，預計約 2–5 分鐘；資料較多可能需要耐啲。'
    :'🛠️ 呢項工作需要處理文件，預計約 3–8 分鐘；實際視文件大小同內容而定。';
}
