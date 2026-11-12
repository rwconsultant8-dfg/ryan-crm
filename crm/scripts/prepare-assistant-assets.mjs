import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
const assets=[
 ['ocr/eng.traineddata.gz','https://tessdata.projectnaptha.com/4.0.0_fast/eng.traineddata.gz','18c1ac52b75e35d44735fb6c2a60acfaf23033524653200738e98f0243edb75b'],
 ['ocr/chi_tra.traineddata.gz','https://tessdata.projectnaptha.com/4.0.0_fast/chi_tra.traineddata.gz','542b2aecc8e4a3b760694301381543d76bdcd8afdf6d899fb03381801b5e2b47'],
 ['NotoSansTC-Regular.ttf','https://raw.githubusercontent.com/notofonts/noto-cjk/main/Sans/Variable/TTF/Subset/NotoSansTC-VF.ttf','ac091cc8cd19e848202afc8fe6d3809b4526c8fdbdb4be82da20c4f785949591'],
];
const hash=body=>createHash('sha256').update(body).digest('hex');
for(const [file,url,expected]of assets){
 const destination=path.join(process.cwd(),'lib/assistant/assets',file);let body=await readFile(destination).catch(()=>null);
 if(body&&hash(body)===expected)continue;
 const response=await fetch(url,{signal:AbortSignal.timeout(60000)});if(!response.ok)throw Error(`Assistant asset unavailable: ${file}`);
 body=Buffer.from(await response.arrayBuffer());if(hash(body)!==expected)throw Error(`Assistant asset checksum mismatch: ${file}`);
 await mkdir(path.dirname(destination),{recursive:true});await writeFile(destination,body);
}
console.log('Assistant OCR languages and Chinese font verified');
