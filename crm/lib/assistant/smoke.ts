import "server-only";
import JSZip from 'jszip';
import {PDFDocument} from 'pdf-lib';
import {createCanvas,GlobalFonts} from '@napi-rs/canvas';
import {ocrImage,fillPdf,assistantAsset} from './pdf';
import {inspectOffice,editPresentation} from './office';
import {searchWeb,openWebpage} from './web';

/** Deterministic deployment checks: no customer reads/writes and no Telegram messages. */
export async function assistantSmokeCheck(){
 const checks:Record<string,string>={};
 try{
  GlobalFonts.registerFromPath(assistantAsset('NotoSansTC-Regular.ttf'),'AssistantCheckTC');
  const canvas=createCanvas(900,220),ctx=canvas.getContext('2d');ctx.fillStyle='white';ctx.fillRect(0,0,900,220);ctx.fillStyle='black';ctx.font='48px AssistantCheckTC';ctx.fillText('測試 Test 123456',25,100);
  const ocr=await ocrImage(canvas.toBuffer('image/png'));if(!/123456/.test(ocr.text))throw Error('OCR output mismatch');checks.ocr='passed';
  const pdf=await PDFDocument.create(),page=pdf.addPage([400,300]);pdf.getForm().createTextField('sample').addToPage(page,{x:20,y:150,width:300,height:45});
  const filled=await fillPdf(await pdf.save(),[{field:'sample',value:'測試'}]);if((await PDFDocument.load(filled)).getForm().getTextField('sample').getText()!=='測試')throw Error('PDF round trip mismatch');checks.pdfForm='passed';
  const zip=new JSZip();zip.file('ppt/presentation.xml','<p:presentation xmlns:p="p" xmlns:r="r"><p:sldIdLst><p:sldId r:id="r1"/></p:sldIdLst></p:presentation>');zip.file('ppt/_rels/presentation.xml.rels','<Relationships><Relationship Id="r1" Target="slides/slide1.xml"/></Relationships>');zip.file('ppt/slides/slide1.xml','<p:sld xmlns:p="p" xmlns:a="a"><a:p><a:r><a:t>Sample</a:t></a:r></a:p></p:sld>');
  const edited=await editPresentation(await zip.generateAsync({type:'nodebuffer'}),[{id:'ppt/slides/slide1.xml#t0',text:'測試簡報'}]);const deck=await inspectOffice(edited,'pptx');if(!('slides'in deck)||deck.slides?.[0].blocks[0].text!=='測試簡報')throw Error('PPTX round trip mismatch');checks.powerPoint='passed';
  if(!(await searchWeb('site:fwd.com.hk brochure')).length)throw Error('Search unavailable');checks.webSearch='passed';
  const web=await openWebpage('https://www.fwd.com.hk/');if(web.text.length<100||!web.links.length)throw Error('Official website unreadable');checks.officialWebpage='passed';
  return{ok:true,checks};
 }catch(error){console.error('Assistant synthetic runtime check failed',{completed:Object.keys(checks)});return{ok:false,checks,error:error instanceof Error?error.message:'Runtime check failed',stack:error instanceof Error?error.stack?.slice(0,1600):undefined};}
}
