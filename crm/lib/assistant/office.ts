import "server-only";
import JSZip from "jszip";
import {xml2js} from "xml-js";

type XmlNode={type?:string;name?:string;attributes?:Record<string,string>;text?:string;elements?:XmlNode[]};
function parse(xml:string):XmlNode{if(/<!DOCTYPE|<!ENTITY/i.test(xml))throw Error("文件含不支援XML宣告");return xml2js(xml) as XmlNode;}
function nodes(node:XmlNode,name:string):XmlNode[]{return[...(node.name===name?[node]:[]),...(node.elements||[]).flatMap(x=>nodes(x,name))];}
function plain(node:XmlNode):string{return(node.text||'')+(node.elements||[]).map(plain).join('');}
const escape=(s:string)=>s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
export async function officeZip(body:Uint8Array){
  const zip=await JSZip.loadAsync(body,{checkCRC32:true});const entries=Object.values(zip.files);let size=0;
  if(entries.length>1500)throw Error("文件結構太大，請拆細");
  for(const file of entries){const length=(file as unknown as {_data?:{uncompressedSize?:number}})._data?.uncompressedSize||0;size+=length;if(length>15*1024*1024||size>60*1024*1024)throw Error("文件解壓後太大，請拆細");if(/vbaProject|activeX|embeddings\//i.test(file.name))throw Error("暫不處理含巨集或嵌入程式嘅文件");}
  return zip;
}
async function text(zip:JSZip,path:string){const file=zip.file(path);if(!file)throw Error("文件結構不完整");const value=await file.async('string');if(value.length>3*1024*1024)throw Error("文件文字過多");return value;}
export async function inspectOffice(body:Uint8Array,kind:'pptx'|'xlsx'|'docx'){
  const zip=await officeZip(body);
  if(kind==='pptx'){
    const rels=nodes(parse(await text(zip,'ppt/_rels/presentation.xml.rels')),'Relationship');
    const ids=nodes(parse(await text(zip,'ppt/presentation.xml')),'p:sldId');
    const slides=[];
    for(const [i,id] of ids.entries()){
      const rel=rels.find(x=>x.attributes?.Id===id.attributes?.['r:id']);const target=rel?.attributes?.Target;
      if(!target||target.includes('..')||target.startsWith('/')||target.includes(':'))throw Error("簡報頁面連結不支援");
      const path='ppt/'+target;const xml=await text(zip,path);const runs=nodes(parse(xml),'a:t');
      slides.push({slide:i+1,blocks:runs.map((n,index)=>({id:`${path}#t${index}`,text:plain(n)}))});
    }
    if(slides.length>60)throw Error("簡報超過60頁，請分批處理");
    return{kind,slides,notice:"文字修改保留原有圖片、主題及版面；新文字需保持簡潔，完成後請核對換行。"};
  }
  if(kind==='docx')return{kind,text:nodes(parse(await text(zip,'word/document.xml')),'w:p').map(plain).join('\n').slice(0,40000)};
  const strings=zip.file('xl/sharedStrings.xml')?nodes(parse(await text(zip,'xl/sharedStrings.xml')),'si').map(plain):[];
  const rels=nodes(parse(await text(zip,'xl/_rels/workbook.xml.rels')),'Relationship');
  const sheets=[];
  for(const sheet of nodes(parse(await text(zip,'xl/workbook.xml')),'sheet')){
    const target=rels.find(x=>x.attributes?.Id===sheet.attributes?.['r:id'])?.attributes?.Target;
    if(!target||target.includes('..')||target.includes(':'))continue;
    const path=target.startsWith('/')?target.slice(1):'xl/'+target;
    const cells=nodes(parse(await text(zip,path)),'c').slice(0,1000).map(cell=>({field:`${sheet.attributes?.name}!${cell.attributes?.r}`,value:cell.attributes?.t==='s'?strings[Number(plain(nodes(cell,'v')[0]||{}))]:plain(nodes(cell,'is')[0]||nodes(cell,'v')[0]||{}),formula:plain(nodes(cell,'f')[0]||{})}));
    sheets.push({name:sheet.attributes?.name,cells});
  }
  return{kind,sheets,notice:"用工作表名!儲存格地址填寫，例如Sheet1!B2；不會改公式。"};
}
export async function editPresentation(body:Uint8Array,changes:{id:string;text:string}[]){
  const zip=await officeZip(body),seen=new Set<string>();let changed=0;
  const parts=new Map<string,Map<number,string>>();
  for(const change of changes){const match=change.id.match(/^(ppt\/slides\/slide\d+\.xml)#t(\d+)$/);if(!match||seen.has(change.id))throw Error("簡報文字代號無效或重複");seen.add(change.id);const list=parts.get(match[1])||new Map<number,string>();list.set(Number(match[2]),change.text);parts.set(match[1],list);}
  for(const [path,edits]of parts){let index=0;const source=await text(zip,path);parse(source);
    const updated=source.replace(/<a:t(?:\s[^>]*)?>([\s\S]*?)<\/a:t>/g,(full)=>{const value=edits.get(index++);if(value===undefined)return full;edits.delete(index-1);changed++;return `<a:t xml:space="preserve">${escape(value)}</a:t>`;});
    if(edits.size)throw Error("搵唔到指定簡報文字，請先重新讀取檔案");parse(updated);zip.file(path,updated);
  }
  if(!changed)throw Error("簡報未有可修改文字");
  const result=await zip.generateAsync({type:'nodebuffer',compression:'DEFLATE'});await inspectOffice(result,'pptx');return result;
}
export async function fillWorkbook(body:Uint8Array,values:{field:string;value:string}[]){
  const zip=await officeZip(body),workbook=parse(await text(zip,'xl/workbook.xml'));
  const rels=nodes(parse(await text(zip,'xl/_rels/workbook.xml.rels')),'Relationship');const sheets=nodes(workbook,'sheet');const parts=new Map<string,Map<string,string>>();
  for(const input of values){const sep=input.field.lastIndexOf('!');const name=input.field.slice(0,sep).replace(/^'|'$/g,''),cell=input.field.slice(sep+1).toUpperCase();if(sep<1||!/^([A-Z]{1,3})([1-9]\d{0,5})$/.test(cell))throw Error("儲存格地址無效");const sheet=sheets.find(x=>x.attributes?.name===name),target=rels.find(x=>x.attributes?.Id===sheet?.attributes?.['r:id'])?.attributes?.Target;if(!target||target.includes('..')||target.includes(':'))throw Error("搵唔到指定工作表");const path=target.startsWith('/')?target.slice(1):'xl/'+target;const list=parts.get(path)||new Map<string,string>();if(list.has(cell))throw Error("儲存格重複");list.set(cell,input.value);parts.set(path,list);}
  for(const [path,edits]of parts){let xml=await text(zip,path);parse(xml);
    for(const [ref,value]of edits){const safe=escape(value);const numeric=/^-?(?:0|[1-9]\d{0,11})(?:\.\d{1,6})?$/.test(value);
      const replacement=(style='')=>numeric?`<c r="${ref}"${style}><v>${value}</v></c>`:`<c r="${ref}"${style} t="inlineStr"><is><t xml:space="preserve">${safe}</t></is></c>`;
      const pattern=new RegExp(`<c\\b(?=[^>]*\\br=["']${ref}["'])[^>]*(?:/>|>[\\s\\S]*?<\\/c>)`);
      const old=xml.match(pattern)?.[0];if(old){if(/<f[\s>]/.test(old))throw Error(`唔會覆蓋公式：${ref}`);const style=old.match(/\bs=["'](\d+)["']/)?.[1];xml=xml.replace(pattern,replacement(style?` s="${style}"`:''));}
      else{const row=ref.match(/\d+$/)![0],rowPattern=new RegExp(`(<row\\b(?=[^>]*\\br=["']${row}["'])[^>]*>)([\\s\\S]*?)(<\\/row>)`);if(!rowPattern.test(xml))throw Error(`表格冇呢一行：${row}，請提供現有欄位`);xml=xml.replace(rowPattern,(_all,start,content,end)=>start+content+replacement()+end);}
    }
    parse(xml);zip.file(path,xml);
  }
  let book=await text(zip,'xl/workbook.xml');const calc='<calcPr calcMode="auto" fullCalcOnLoad="1" forceFullCalc="1"/>';book=/<calcPr\b[^>]*\/>/.test(book)?book.replace(/<calcPr\b[^>]*\/>/,calc):book.replace('</workbook>',calc+'</workbook>');zip.file('xl/workbook.xml',book);
  const result=await zip.generateAsync({type:'nodebuffer',compression:'DEFLATE'});await inspectOffice(result,'xlsx');return result;
}
