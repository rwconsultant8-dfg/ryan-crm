import "server-only";
import {lookup} from "node:dns/promises";
import {isIP} from "node:net";
import https from "node:https";
import {xml2js} from "xml-js";

export function publicAddress(address:string):boolean {
  if(isIP(address)===4){const [a,b]=address.split('.').map(Number);return !(a===0 || a===10 || a===127 || a>=224 || (a===169&&b===254) || (a===172&&b>=16&&b<=31) || (a===192&&(b===168||b===0)) || (a===100&&b>=64&&b<=127) || (a===198&&(b===18||b===19)));}
  // Pin to public IPv4 records; IPv6-only hosts fail closed rather than bypass IPv4 protections.
  return false;
}
export function publicUrl(raw:string):URL {
  const url=new URL(raw);
  if(url.protocol!=="https:" || url.username || url.password || (url.port && url.port!=="443") || isIP(url.hostname) || !url.hostname.includes('.') || /(^|\.)(localhost|local|internal|test|invalid)$/i.test(url.hostname))throw Error("只可讀取公開HTTPS網站");
  return url;
}
export async function publicFetch(raw:string,maxBytes=10*1024*1024,redirects=0):Promise<{url:string;body:Buffer;type:string}> {
  if(redirects>3)throw Error("網站轉址太多");
  const url=publicUrl(raw),addresses=await lookup(url.hostname,{all:true,family:4});
  if(!addresses.length || addresses.some(x=>!publicAddress(x.address)))throw Error("網站位址不屬於公開網絡");
  const address=addresses.find(x=>x.family===4)!;
  const response=await new Promise<{status:number;headers:Record<string,string|undefined>;body:Buffer}>((resolve,reject)=>{
    const req=https.request(url,{method:"GET",family:4,headers:{"User-Agent":"RyanCRM-Assistant/1.0","Accept":"text/html,application/pdf,application/rss+xml,*/*;q=0.8"},lookup:(_hostname,_options,callback)=>callback(null,address.address,4)},res=>{
      if(Number(res.headers['content-length']||0)>maxBytes){res.destroy();reject(Error("文件超過10 MB或網頁過大"));return;}
      const chunks:Buffer[]=[];let length=0;
      res.on('data',(chunk:Buffer)=>{length+=chunk.length;if(length>maxBytes){res.destroy();reject(Error("文件超過10 MB或網頁過大"));}else chunks.push(chunk);});
      res.on('error',reject);res.on('end',()=>resolve({status:res.statusCode||0,headers:{location:res.headers.location,type:res.headers['content-type']},body:Buffer.concat(chunks)}));
    });
    req.setTimeout(12000,()=>req.destroy(Error("網站逾時")));req.on('error',reject);req.end();
  });
  if(response.status>=300&&response.status<400&&response.headers.location)return publicFetch(new URL(response.headers.location,url).href,maxBytes,redirects+1);
  if(response.status!==200)throw Error(`網站回應${response.status}`);
  return{url:url.href,body:response.body,type:response.headers.type||"application/octet-stream"};
}
export function cleanHtml(html:string):string {
  return html.replace(/<(script|style|noscript|svg)\b[^>]*>[\s\S]*?<\/\1>/gi,' ').replace(/<\/(p|div|li|h[1-6]|tr)>/gi,'\n').replace(/<[^>]+>/g,' ').replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&#39;|&apos;/g,"'").replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&nbsp;/g,' ').replace(/&#(\d+);/g,(_,n)=>{const v=Number(n);return v>0&&v<=0x10ffff?String.fromCodePoint(v):'';}).replace(/[ \t]+/g,' ').replace(/\n\s*\n/g,'\n').trim();
}
export function htmlLinks(html:string,base:string){
  const links:{title:string;url:string}[]=[];
  for(const match of html.matchAll(/<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)){
    try{const url=publicUrl(new URL(match[1].replace(/&amp;/g,'&'),base).href).href;
      if(!links.some(x=>x.url===url))links.push({title:cleanHtml(match[2]).slice(0,160)||url.split('/').pop()||url,url});
    }catch{/* Ignore scripts, local URLs and fragments. */}
  }
  return links;
}
export async function searchWeb(query:string){
  const result=await publicFetch(`https://www.bing.com/search?format=rss&q=${encodeURIComponent(query)}`,1024*1024);
  if(/<!DOCTYPE|<!ENTITY/i.test(result.body.toString()))throw Error("搜尋回應格式不符");
  const parsed=xml2js(result.body.toString(),{compact:true}) as {rss?:{channel?:{item?:unknown}}};
  const raw=parsed.rss?.channel?.item;const items=Array.isArray(raw)?raw:raw?[raw]:[];
  const results=items.slice(0,8).flatMap((item)=>{
    const row=item as Record<string,{_text?:string;_cdata?:string}>;
    try{return[{title:cleanHtml(row.title?._text||row.title?._cdata||""),url:publicUrl(row.link?._text||"").href,snippet:cleanHtml(row.description?._text||row.description?._cdata||"").slice(0,600)}];}catch{return[];}
  });
  if(!results.length)throw Error("搜尋暫時冇可用結果，請提供官方網頁或更明確產品名");
  return results;
}
export function structuredPageData(html:string,base:string){
  const texts:string[]=[],links:{title:string;url:string}[]=[];
  const visit=(value:unknown,key:string,depth:number)=>{
    if(depth>35||texts.length>3000)return;
    if(typeof value==='string'){
      if(/^(component|_uid|uuid|id|className|class|style|color|font|srcSet|image|filename|type|locale|slug)$/i.test(key))return;
      const readable=cleanHtml(value);if(readable.length>8 && !/^https?:|^[a-z0-9_./-]+$/i.test(readable))texts.push(readable);
      links.push(...htmlLinks(value,base));
      for(const raw of value.match(/https?:\/\/[^\s<>"']+|\/[^\s<>"']+\.(?:pdf|pptx|docx|xlsx)(?:\?[^\s<>"']*)?/gi)||[]){try{const url=publicUrl(new URL(raw,base).href).href;links.push({title:key,url});}catch{}}
    }else if(Array.isArray(value))value.forEach(v=>visit(v,key,depth+1));
    else if(value&&typeof value==='object')for(const[k,v]of Object.entries(value))visit(v,k,depth+1);
  };
  for(const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)){
    if(!/__NEXT_DATA__|application\/(ld\+)?json/i.test(match[1]))continue;
    try{visit(JSON.parse(match[2]),'',0);}catch{/* Non-JSON scripts remain untrusted and are never run. */}
  }
  return{text:[...new Set(texts)].join('\n'),links};
}
export async function openWebpage(url:string){
  const page=await publicFetch(url,/\.pdf(?:[?#]|$)/i.test(url)?10*1024*1024:2*1024*1024);
  if(/application\/pdf/i.test(page.type)||page.body.subarray(0,5).toString()==='%PDF-'){
    const {inspectPdf}=await import('./pdf');const document=await inspectPdf(page.body);
    const text=document.pages.map(p=>`第${p.page}頁：${p.text}`).join('\n');
    return{title:decodeURIComponent(new URL(page.url).pathname.split('/').pop()||'官方PDF'),url:page.url,text:text.slice(0,22000),truncated:text.length>22000,links:[] as {title:string;url:string}[],accessedAt:new Date().toISOString()};
  }
  if(!/html|text\//i.test(page.type))throw Error("呢個連結係文件，請用download_file下載再inspect_file");
  const html=page.body.toString(),title=cleanHtml(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]||page.url);
  const structured=structuredPageData(html,page.url);
  const links=[...htmlLinks(html,page.url),...structured.links].filter((x,i,all)=>all.findIndex(y=>y.url===x.url)===i);const downloads=links.filter(x=>/\.(pdf|pptx|docx|xlsx)(\?|$)|download|brochure|小冊|下載/i.test(x.url+' '+x.title));
  return{title,url:page.url,text:[cleanHtml(html),structured.text].filter(Boolean).join("\n").slice(0,22000),links:[...downloads,...links.filter(x=>!downloads.includes(x))].slice(0,60),accessedAt:new Date().toISOString()};
}
