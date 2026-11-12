import "server-only";
import {existsSync} from "node:fs";
import {readFile} from "node:fs/promises";
import path from "node:path";
import {PDFDocument,PDFTextField,PDFCheckBox,PDFDropdown,PDFRadioGroup,PDFOptionList,PDFSignature,PDFName} from "pdf-lib";

export function assistantAsset(file:string){
  const paths=[path.join(process.cwd(),'lib/assistant/assets',file),path.join(process.cwd(),'crm/lib/assistant/assets',file)];
  const found=paths.find(candidate=>existsSync(candidate));if(!found)throw Error('Assistant asset missing: '+file);return found;
}
function ocrWorkerPath(){
  const paths=[path.join(process.cwd(),'node_modules/tesseract.js/src/worker-script/node/index.js'),path.join(process.cwd(),'crm/node_modules/tesseract.js/src/worker-script/node/index.js')];
  const found=paths.find(candidate=>existsSync(candidate));if(!found)throw Error('OCR worker not bundled');return found;
}
let pdfModule:Promise<typeof import('pdfjs-dist/legacy/build/pdf.mjs')>|undefined;
async function pdfjs(){
  // PDF.js uses these browser geometry primitives when rendering in Node.
  const canvas=await import('@napi-rs/canvas');
  Object.assign(globalThis,{DOMMatrix:canvas.DOMMatrix,ImageData:canvas.ImageData,Path2D:canvas.Path2D});
  pdfModule??=import('pdfjs-dist/legacy/build/pdf.mjs');return pdfModule;
}
export async function ocrImage(body:Uint8Array){
  const {loadImage}=await import('@napi-rs/canvas');
  const image=await loadImage(Buffer.from(body));if(image.width*image.height>12_000_000)throw Error('圖片太大，請縮細至約1200萬像素內');
  const {createWorker}=await import('tesseract.js');
  const worker=await createWorker(['chi_tra','eng'],1,{workerPath:ocrWorkerPath(),langPath:path.dirname(assistantAsset('ocr/eng.traineddata.gz')),cachePath:'/tmp',cacheMethod:'none',logger:()=>{},errorHandler:()=>{}});
  try{const {data}=await worker.recognize(Buffer.from(body));return{text:data.text.slice(0,40000),confidence:Math.round(data.confidence),notice:"OCR文字需核對原圖；低清晰度、手寫字及數字可能辨認錯誤。"};}finally{await worker.terminate();}
}
export async function inspectPdf(body:Uint8Array){
  const lib=await pdfjs(),canvasModule=await import('@napi-rs/canvas');
  const doc=await lib.getDocument({data:Uint8Array.from(body),useSystemFonts:true,isEvalSupported:false,disableFontFace:true}).promise;
  try{
    if(doc.numPages>30)throw Error("PDF超過30頁，請分拆後再傳");
    const pages=[];let scanned=0,totalText=0;
    for(let i=1;i<=doc.numPages;i++){
      const page=await doc.getPage(i);const content=await page.getTextContent();let text=content.items.map(x=>'str'in x?x.str:'').join(' ').trim();let confidence:number|undefined;
      if(text.length<20){
        if(++scanned>4)throw Error("掃描PDF每次最多4頁，請分拆後再傳");
        const viewport=page.getViewport({scale:1.7});if(viewport.width*viewport.height>12_000_000)throw Error("PDF頁面過大");
        const canvas=canvasModule.createCanvas(Math.ceil(viewport.width),Math.ceil(viewport.height));
        await page.render({canvas:canvas as never,canvasContext:canvas.getContext('2d') as never,viewport}).promise;
        const result=await ocrImage(canvas.toBuffer('image/png'));text=result.text;confidence=result.confidence;
      }
      totalText+=text.length;if(text.length>15000||totalText>60000)throw Error("PDF文字太多，請分拆指定頁面後再傳，避免漏讀");
      pages.push({page:i,text,...(confidence!==undefined?{ocrConfidence:confidence}:{})});page.cleanup();
    }
    const form=(await PDFDocument.load(body)).getForm();const fields=form.getFields().map(f=>({field:f.getName(),type:f.constructor.name,...(f instanceof PDFTextField?{value:f.getText()||''}:{}),...(f instanceof PDFDropdown||f instanceof PDFOptionList||f instanceof PDFRadioGroup?{options:f.getOptions()}:{})}));
    return{kind:'pdf',pages,fields,notice:scanned?'包含OCR文字，請對照原件核實。':fields.length?'可以按列出嘅field名稱填表。':'呢份PDF冇可填欄位；可提供欄位對照／CSV，請提供可填表格版本。'};
  }finally{await doc.destroy();}
}
export async function fillPdf(body:Uint8Array,values:{field:string;value:string}[]){
  const doc=await PDFDocument.load(body);const form=doc.getForm();
  if(form.hasXFA())throw Error("XFA表格未支援，請提供一般可填PDF");
  if(form.getFields().some(x=>x instanceof PDFSignature && x.acroField.dict.get(PDFName.of('V')) && String(x.acroField.dict.get(PDFName.of('V')))!=='null'))throw Error("已簽署文件請先提供未簽署副本；暫不修改或代簽");
  const seen=new Set<string>();
  for(const input of values){if(seen.has(input.field))throw Error("表格欄位重複");seen.add(input.field);const field=form.getField(input.field);
    if(field.isReadOnly())throw Error(`欄位不可更改：${input.field}`);
    if(field instanceof PDFTextField){field.setText(input.value);}
    else if(field instanceof PDFCheckBox){if(/^(true|yes|1|✓)$/i.test(input.value))field.check();else if(/^(false|no|0)$/i.test(input.value))field.uncheck();else throw Error("勾選欄位必須明確指定yes/no");}
    else if(field instanceof PDFDropdown||field instanceof PDFOptionList||field instanceof PDFRadioGroup){if(!field.getOptions().includes(input.value))throw Error("選項唔存在");field.select(input.value);}
    else throw Error(`未支援欄位：${input.field}`);
  }
  if(values.some(x=>/[^\x00-\xff]/.test(x.value))){
    const fontkit=(await import('@pdf-lib/fontkit')).default;doc.registerFontkit(fontkit);
    const font=await doc.embedFont(await readFile(assistantAsset('NotoSansTC-Regular.ttf')),{subset:true});form.updateFieldAppearances(font);
  }else form.updateFieldAppearances();
  const result=await doc.save();const reopened=await PDFDocument.load(result);const check=reopened.getForm();
  for(const input of values){const field=check.getField(input.field);if(field instanceof PDFTextField&&field.getText()!==input.value)throw Error("表格讀回驗證失敗");if(field instanceof PDFCheckBox&&field.isChecked()!==/^(true|yes|1|✓)$/i.test(input.value))throw Error("勾選欄讀回驗證失敗");if((field instanceof PDFDropdown||field instanceof PDFOptionList)&&!field.getSelected().includes(input.value))throw Error("選項讀回驗證失敗");if(field instanceof PDFRadioGroup&&field.getSelected()!==input.value)throw Error("選項讀回驗證失敗");}
  return Buffer.from(result);
}
