import "server-only";
import type {SupabaseClient} from "@supabase/supabase-js";
import {fileScope,listBotFiles,readBotFile,saveBotFile,MAX_FILE_BYTES} from "../telegram/files";
import {sendTelegramDocument} from "../telegram/transport";
import {type AssistantTool,type Observation,type WorkState,MAX_TOOL_STEPS} from "./schema";
import {searchWeb,openWebpage,publicFetch} from "./web";
import {editPresentation,fillWorkbook,inspectOffice} from "./office";
import {fillPdf,inspectPdf,ocrImage} from "./pdf";

const mimes:Record<string,string>={pdf:'application/pdf',pptx:'application/vnd.openxmlformats-officedocument.presentationml.presentation',xlsx:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',docx:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',txt:'text/plain; charset=utf-8',csv:'text/csv; charset=utf-8',md:'text/markdown; charset=utf-8'};
const extension=(name:string)=>name.split('.').pop()?.toLowerCase()||'';
function filename(raw:string,fallback:string){const name=raw.replace(/[\\/\u0000-\u001f\u007f]/g,'_').replace(/^\.+/,'').trim().slice(0,120);return name||fallback;}
function inspected(work:WorkState|undefined,key:string){return work?.observations.some(o=>o.ok&&o.tool==='inspect_file'&&(o.data as {fileKey?:string}).fileKey===key);}
export async function assistantFileList(admin:SupabaseClient,owner:string){
  return(await listBotFiles(admin,fileScope('coach',owner))).filter(x=>!/^(AI對話-|訊息-|工具紀錄-|客戶修正備份-)/.test(x.name)).slice(0,15);
}
async function ownedFile(admin:SupabaseClient,owner:string,key:string){
  // A key is never enough authority: it must also appear in this owner's current private directory.
  const files=await assistantFileList(admin,owner);if(!files.some(x=>x.key===key))throw Error("搵唔到你自己嘅檔案，請重新上傳");
  return readBotFile(admin,fileScope('coach',owner),key);
}
export async function inspectAttachment(file:{name:string;body:Uint8Array;mime:string}){
  const ext=extension(file.name);
  if(['pptx','xlsx','docx'].includes(ext))return inspectOffice(file.body,ext as 'pptx'|'xlsx'|'docx');
  if(ext==='pdf'||file.mime==='application/pdf')return inspectPdf(file.body);
  if(['png','jpg','jpeg','webp'].includes(ext)||/^image\/(png|jpeg|webp)$/.test(file.mime))return{kind:'image',...await ocrImage(file.body)};
  if(['txt','csv','md'].includes(ext))return{kind:ext,text:Buffer.from(file.body).toString('utf8').slice(0,40000)};
  throw Error("支援PDF、PPTX、XLSX、DOCX、相片同文字檔；請將舊版PPT／XLS另存為新格式");
}
export async function executeTool(admin:SupabaseClient,owner:string,to:string,tool:AssistantTool,work?:WorkState,evidence=""):Promise<Observation>{
  try{
    if(tool.name==='web_search'){
      if(/\b[A-Z]{1,2}\d{6}\(?[0-9A]\)?\b|\b\d{7,}\b|[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(tool.query))throw Error('搜尋字句似乎包含私人識別資料，請只提供公開產品或問題主題');
      const results=await searchWeb(tool.query);return{tool:tool.name,ok:true,data:{query:tool.query,results,notice:'搜尋摘要未核實，重要資訊請open_url讀取官方來源。'}};
    }
    if(tool.name==='open_url'){
      const page=await openWebpage(tool.url);return{tool:tool.name,ok:true,data:page,sources:[{title:page.title,url:page.url}]};
    }
    let file:{name:string;body:Uint8Array;mime:string},caption='';
    if(tool.name==='download_file'){
      // Downloads must be linked from a page we actually opened, or explicitly supplied by the employee.
      const known=work?.observations.filter(x=>x.ok&&x.tool==='open_url').flatMap(x=>{const d=x.data as {url?:string;links?:{url:string}[]};return[d.url,...(d.links||[]).map(l=>l.url)];})||[];
      const suppliedUrls=[...evidence.matchAll(/https:\/\/[^\s<>\"）)]+/g)].map(x=>x[0]);
      if(!known.includes(tool.url)&&!suppliedUrls.includes(tool.url))throw Error("請先open_url核實下載頁及文件連結");
      const download=await publicFetch(tool.url);const ext=extension(new URL(download.url).pathname);
      if(!['pdf','pptx','xlsx','docx','png','jpg','jpeg'].includes(ext))throw Error("連結未能確認係支援嘅文件，請提供官方直接下載連結");
      if(ext==='pdf'&&!download.body.subarray(0,5).equals(Buffer.from('%PDF-')))throw Error("下載內容唔係PDF");
      if(['pptx','xlsx','docx'].includes(ext)){await inspectOffice(download.body,ext as 'pptx'|'xlsx'|'docx');}
      const name=filename(tool.filename,decodeURIComponent(new URL(download.url).pathname.split('/').pop()||`下載文件.${ext}`));
      file={name:name.toLowerCase().endsWith('.'+ext)?name:`${name}.${ext}`,body:download.body,mime:mimes[ext]};caption=`來源：${download.url}`;
    }else if(tool.name==='inspect_file'){
      const source=await ownedFile(admin,owner,tool.fileKey);const contents=await inspectAttachment(source);
      return{tool:tool.name,ok:true,data:{fileKey:tool.fileKey,filename:source.name,contents}};
    }else if(tool.name==='edit_presentation'){
      if(!inspected(work,tool.fileKey))throw Error("修改前請先inspect_file讀取原檔");
      const source=await ownedFile(admin,owner,tool.fileKey);if(extension(source.name)!=='pptx')throw Error("請提供PPTX簡報");
      const name=filename(tool.filename,source.name.replace(/\.pptx$/i,'-已修改.pptx'));
      file={name:name.endsWith('.pptx')?name:name+'.pptx',body:await editPresentation(source.body,tool.changes),mime:mimes.pptx};caption='已按要求修改文字並保留原版面，請核對換行及文字位置。';
    }else if(tool.name==='fill_form'){
      if(!inspected(work,tool.fileKey))throw Error("填表前請先inspect_file核對欄位");
      const normalized=(value:string)=>value.normalize('NFKC').replace(/[\s,，]/g,'').toLowerCase();
      const supplied=normalized(evidence);
      if(tool.values.some(x=>x.value.trim() && !supplied.includes(normalized(x.value))))throw Error("部分填表內容未能喺你提供嘅資料核實，請逐項提供要填嘅值；唔會估填");
      const source=await ownedFile(admin,owner,tool.fileKey),ext=extension(source.name);if(!['pdf','xlsx'].includes(ext))throw Error("請提供可填PDF或XLSX表格");
      const name=filename(tool.filename,source.name.replace(/\.(pdf|xlsx)$/i,`-已填寫.${ext}`));
      file={name:name.endsWith('.'+ext)?name:`${name}.${ext}`,body:ext==='pdf'?await fillPdf(source.body,tool.values):await fillWorkbook(source.body,tool.values),mime:mimes[ext]};caption='已填入提供嘅資料，請核對內容；未簽署或提交。';
    }else{
      file={name:filename(tool.filename,'整理結果.txt'),body:Buffer.from(tool.text),mime:mimes[extension(tool.filename)]||mimes.txt};
    }
    if(file.body.length>MAX_FILE_BYTES)throw Error("文件超過10 MB，請分拆");
    const key=await saveBotFile(admin,fileScope('coach',owner),file.name,file.body,file.mime);
    await sendTelegramDocument(to,file,caption);
    return{tool:tool.name,ok:true,data:{fileKey:key,filename:file.name,bytes:file.body.length,stored:true,sent:true,...(caption?{note:caption}:{})}};
  }catch(error){console.error('Assistant tool failed',{tool:tool.name});return{tool:tool.name,ok:false,data:{error:error instanceof Error?error.message:'工具暫時未能執行'}};}
}
export function sourceReply(answer:string,work?:WorkState){
  const sources=work?.observations.filter(x=>x.ok).flatMap(x=>x.sources||[])||[];
  const unique=sources.filter((x,i)=>sources.findIndex(y=>y.url===x.url)===i).slice(0,3);
  const untrustedLinks=[...answer.matchAll(/https?:\/\/[^\s<>"）)]+/g)].map(m=>m[0]);
  if(untrustedLinks.some(url=>!sources.some(s=>s.url===url)&&!work?.observations.some(x=>JSON.stringify(x.data).includes(url))))return'未能核實答案引用嘅來源，請提供官方資料或再試搜尋。';
  const observations=work?.observations||[];
  const failures=observations.filter((x,i)=>!x.ok && x.tool!=='accuracy_check' && !observations.slice(i+1).some(y=>y.tool===x.tool&&y.ok));
  const text=answer.trim().slice(0,2200)+(failures.length?"\n\n未完成項目："+failures.map(x=>(x.data as {error?:string}).error||x.tool).slice(-2).join('；'):"");
  return unique.length?`${text}\n\n已查閱來源：\n${unique.map(s=>`${s.title.slice(0,60)}\n${s.url}`).join('\n')}`:text;
}
export const toolsExhausted=(work?:WorkState)=>(work?.step||0)>=MAX_TOOL_STEPS;
