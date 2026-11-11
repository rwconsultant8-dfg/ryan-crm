import {describe,it,expect} from 'vitest';
import {createCanvas,GlobalFonts} from '@napi-rs/canvas';
import {PDFDocument,StandardFonts} from 'pdf-lib';
import {ocrImage,inspectPdf,fillPdf} from '@/lib/assistant/pdf';
import {searchWeb,openWebpage,publicFetch} from '@/lib/assistant/web';

describe.runIf(process.env.ASSISTANT_RUNTIME_TEST==='1')('Real assistant file/network runtime',()=>{
 it('performs actual local English and Chinese OCR',async()=>{
  GlobalFonts.registerFromPath('lib/assistant/assets/NotoSansTC-Regular.ttf','NotoTC');
  const canvas=createCanvas(1400,500),ctx=canvas.getContext('2d');ctx.fillStyle='white';ctx.fillRect(0,0,1400,500);ctx.fillStyle='black';ctx.font='56px NotoTC';ctx.fillText('姓名：陳大文',50,110);ctx.fillText('Policy 123456',50,230);ctx.fillText('Amount HKD 5000',50,350);
  const result=await ocrImage(canvas.toBuffer('image/png'));expect(result.text).toMatch(/123456/);expect(result.text).toMatch(/5000/);expect(result.text).toMatch(/陳|大文/);expect(result.confidence).toBeGreaterThan(45);
 },120000);
 it('reads a real PDF and canonical form fields, and fills Chinese characters',async()=>{
  const doc=await PDFDocument.create();const page=doc.addPage([600,400]);const font=await doc.embedFont(StandardFonts.Helvetica);page.drawText('Form: Customer Details',{x:30,y:350,font,size:18});doc.getForm().createTextField('CustomerName').addToPage(page,{x:30,y:220,width:300,height:50});const original=await doc.save();
  const edited=await fillPdf(original,[{field:'CustomerName',value:'陳大文'}]);const reopened=await PDFDocument.load(edited);expect(reopened.getForm().getTextField('CustomerName').getText()).toBe('陳大文');
  const inspected=await inspectPdf(edited);expect(inspected.fields[0].field).toBe('CustomerName');expect(inspected.pages[0].text).toContain('Customer');
 },120000);
 it('fetches actual web search results and reads FWD official download links',async()=>{
  const found=await searchWeb('site:fwd.com.hk brochure');expect(found.length).toBeGreaterThan(0);
  const page=await openWebpage('https://www.fwd.com.hk/');expect(page.text.length).toBeGreaterThan(100);expect(page.links.length).toBeGreaterThan(0);expect(page.url).toContain('fwd.com.hk');
  const result=await publicFetch('https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf');expect(result.body.subarray(0,5).toString()).toBe('%PDF-');
 },60000);
});
