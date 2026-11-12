import {describe,it,expect,vi,afterEach} from 'vitest';
import JSZip from 'jszip';
import {toolResultSchema,toolResultJsonSchema,verificationRequired,needsResearch,researchSourceMissing,isClientNote} from '@/lib/assistant/schema';
import {publicAddress,publicUrl,htmlLinks} from '@/lib/assistant/web';
import {editPresentation,inspectOffice,fillWorkbook} from '@/lib/assistant/office';
import {fillPdf} from '@/lib/assistant/pdf';
import {PDFDocument} from 'pdf-lib';
import {processingEstimate} from '@/lib/telegram/progress';
import {sourceReply} from '@/lib/assistant/execute';

describe('Assistant tool boundaries',()=>{
 it('emits a worker-compatible strict output schema',()=>{const serialized=JSON.stringify(toolResultJsonSchema);expect(serialized).not.toMatch(/\"(?:oneOf|const|format|\$schema)\"/);expect(serialized).toContain('anyOf');});
 it('accepts only typed tools, never commands, recipients or credentials',()=>{
  expect(toolResultSchema.safeParse({response:{kind:'tool',text:''},tool:{name:'web_search',query:'FWD 香港產品小冊子'}}).success).toBe(true);
  for(const tool of [{name:'exec',command:'rm -rf /'},{name:'download_file',url:'https://example.com/a.pdf',filename:'x.pdf',to:'another-user'},{name:'fill_form',fileKey:'x',filename:'f.pdf',values:[],ownerId:'someone'}])expect(toolResultSchema.safeParse({response:{kind:'tool',text:''},tool}).success).toBe(false);
 });
 it('blocks private, loopback, metadata and unusual network destinations',()=>{
  for(const ip of ['127.0.0.1','10.1.1.1','169.254.169.254','172.16.1.1','192.168.1.1','100.64.0.1','::1','::ffff:127.0.0.1'])expect(publicAddress(ip)).toBe(false);
  expect(publicAddress('8.8.8.8')).toBe(true);
  for(const url of ['http://example.com','https://user:pass@example.com','https://127.0.0.1','https://localhost','https://example.com:8443','https://foo.internal'])expect(()=>publicUrl(url)).toThrow();
 });
 it('resolves document links but ignores active or internal links',()=>{
  expect(htmlLinks('<a href="/a.pdf">小冊子</a><a href="javascript:bad">x</a><a href="https://127.0.0.1">x</a>','https://www.fwd.com.hk/products')).toEqual([{title:'小冊子',url:'https://www.fwd.com.hk/a.pdf'}]);
 });
 it('appends actual source receipts and refuses invented citations',()=>{
  const work={rootMessageId:'x',step:1,observations:[{tool:'open_url',ok:true,data:{},sources:[{title:'Official',url:'https://www.fwd.com.hk/a'}]}]};
  expect(sourceReply('已查到',work)).toContain('https://www.fwd.com.hk/a');expect(sourceReply('來源 https://fabricated.example/a',work)).toContain('未能核實');
 });
});
async function deck(){const zip=new JSZip();zip.file('ppt/presentation.xml','<p:presentation xmlns:p="p" xmlns:r="r"><p:sldIdLst><p:sldId id="256" r:id="rId1"/></p:sldIdLst></p:presentation>');zip.file('ppt/_rels/presentation.xml.rels','<Relationships><Relationship Id="rId1" Target="slides/slide1.xml"/></Relationships>');zip.file('ppt/slides/slide1.xml','<p:sld xmlns:p="p" xmlns:a="a"><a:p><a:r><a:rPr b="1"/><a:t>Old &amp; title</a:t></a:r><a:r><a:t>body</a:t></a:r></a:p></p:sld>');zip.file('ppt/media/image1.png','unchanged-image');return zip.generateAsync({type:'nodebuffer'});}
describe('PowerPoint original-preserving edits',()=>{
 it('reads the source in presentation order and changes only requested text',async()=>{
  const source=await deck();const inspected=await inspectOffice(source,'pptx');expect('slides'in inspected&&inspected.slides![0].blocks[0].text).toBe('Old & title');
  const result=await editPresentation(source,[{id:'ppt/slides/slide1.xml#t0',text:'新標題 <確認>'}]);const output=await JSZip.loadAsync(result),input=await JSZip.loadAsync(source);
  expect(await output.file('ppt/slides/slide1.xml')!.async('string')).toContain('新標題 &lt;確認&gt;');expect(await output.file('ppt/slides/slide1.xml')!.async('string')).toContain('b="1"');
  for(const path of ['ppt/presentation.xml','ppt/media/image1.png'])expect(await output.file(path)!.async('string')).toBe(await input.file(path)!.async('string'));
  expect(await input.file('ppt/slides/slide1.xml')!.async('string')).toContain('Old &amp; title');
 });
 it('rejects invented text targets and macro containers',async()=>{
  await expect(editPresentation(await deck(),[{id:'ppt/slides/slide1.xml#t99',text:'oops'}])).rejects.toThrow();const zip=await JSZip.loadAsync(await deck());zip.file('ppt/vbaProject.bin','bad');await expect(inspectOffice(await zip.generateAsync({type:'nodebuffer'}),'pptx')).rejects.toThrow('巨集');
 });
});
describe('Form data round trip',()=>{
 it('fills actual PDF fields without changing the original and verifies canonical values',async()=>{
  const pdf=await PDFDocument.create();const page=pdf.addPage();pdf.getForm().createTextField('name').addToPage(page);pdf.getForm().createCheckBox('approved').addToPage(page);
  const source=await pdf.save(),result=await fillPdf(source,[{field:'name',value:'Mary'},{field:'approved',value:'yes'}]);const reopened=await PDFDocument.load(result);
  expect(reopened.getForm().getTextField('name').getText()).toBe('Mary');expect(reopened.getForm().getCheckBox('approved').isChecked()).toBe(true);expect((await PDFDocument.load(source)).getForm().getTextField('name').getText()).toBeUndefined();
  await expect(fillPdf(source,[{field:'unknown',value:'x'}])).rejects.toThrow();
 });
 it('fills spreadsheet cells as literal data and preserves styles and formulas',async()=>{
  const zip=new JSZip();zip.file('xl/workbook.xml','<workbook><sheets><sheet name="Sheet1" r:id="rId1"/></sheets></workbook>');zip.file('xl/_rels/workbook.xml.rels','<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>');zip.file('xl/worksheets/sheet1.xml','<worksheet><sheetData><row r="1"><c r="A1" s="2" t="inlineStr"><is><t>Name</t></is></c><c r="B1"><f>1+1</f><v>2</v></c></row><row r="2"></row></sheetData></worksheet>');const source=await zip.generateAsync({type:'nodebuffer'});
  const result=await fillWorkbook(source,[{field:'Sheet1!A1',value:'Mary'},{field:'Sheet1!A2',value:'=HYPERLINK("malicious")'}]);const output=await JSZip.loadAsync(result);const xml=await output.file('xl/worksheets/sheet1.xml')!.async('string');expect(xml).toContain('s="2"');expect(xml).toContain('<f>1+1</f>');expect(xml).toContain('<t xml:space="preserve">=HYPERLINK(&quot;malicious&quot;)</t>');await expect(fillWorkbook(source,[{field:'Sheet1!B1',value:'overwrite'}])).rejects.toThrow('公式');
 });
});

describe('Source requirement',()=>{it('blocks unchecked product/current claims while allowing clarification and verified answers',()=>{expect(verificationRequired('FWD保障係點？','保障包括以下內容。')).toBe(true);expect(verificationRequired('FWD小冊子','你想搵邊一個產品嘅小冊子？')).toBe(false);expect(verificationRequired('FWD保障係點？','已查閱',{rootMessageId:'x',step:1,observations:[{tool:'open_url',ok:true,data:{},sources:[{title:'官方',url:'https://www.fwd.com.hk/'}]}]})).toBe(false);expect(verificationRequired('幫我草擬道謝短訊','多謝你。')).toBe(false);});});

describe('Real comparison research dispatch',()=>{it('requires research for product comparisons and both insurers, even after a history of refusals',()=>{
 const question='我想睇FWD尊衞您同埋永明嘅高端醫療保費對比';expect(needsResearch(question)).toBe(true);
 const work={rootMessageId:'x',step:1,observations:[{tool:'open_url',ok:true,data:{},sources:[{title:'FWD',url:'https://www.fwd.com.hk/'}]}]};
 expect(researchSourceMissing(question,work)).toBe(true);work.observations.push({tool:'open_url',ok:true,data:{},sources:[{title:'Sun Life',url:'https://www.sunlife.com.hk/'}]});expect(researchSourceMissing(question,work)).toBe(false);
 expect(needsResearch('記低Mary今日FWD保單已簽單')).toBe(false);
});});

it("routes factual meeting notes locally even when they mention comparisons and insurance", () => {
  const note = "Ada，任職老師。\n琴日用表格整理收入開支。人工24000，學校對比之前多啲，家用每月7000。\n興趣睇演唱會。曾投保被拒，見面有傾保障同儲蓄。";
  expect(isClientNote(note)).toBe(true);
  expect(needsResearch(note)).toBe(false);
  expect(verificationRequired(note, "已整理見客資料。")).toBe(false);
  expect(processingEstimate(note)).toBeNull();
  expect(needsResearch("公司人工對比上年有變。\n同客戶傾過保障。")).toBe(false);
  expect(isClientNote(note + "\n幫我查資料，比較兩份保費。")).toBe(false);
  expect(needsResearch(note + "\n幫我查資料，比較兩份保費。")).toBe(true);
});
