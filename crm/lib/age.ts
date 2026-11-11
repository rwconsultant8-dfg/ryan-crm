/** Age is descriptive data: never turn an estimate into a precise birthday/age. */
export function normalizeAge(raw:string):string|null {
  let value=raw.trim().replace(/\s+/g,"").replace(/(?:歲|岁)(?=(?:左右|以上|以下)?$)/u,"").replace(/[–—至到]/g,"-");
  if(!value)return "";
  value=value.replace(/^(大約|大约|差唔多)/,"約").replace(/^约/,"約").replace(/多$/, "幾");
  const decades:Record<string,string>={十:"10",二十:"20",三十:"30",四十:"40",五十:"50",六十:"60",七十:"70",八十:"80",九十:"90",一百:"100"};
  value=value.replace(/^(一百|[二三四五六七八九]?十)(?=幾|几|多|出頭|尾|左右|$)/,m=>decades[m]||m).replace(/几/g,"幾").replace(/多$/, "幾");
  const range=value.match(/^(\d{1,3})-(\d{1,3})$/);
  if(range)return +range[1]<=+range[2] && +range[2]<=120 ? `${+range[1]}-${+range[2]}`:null;
  const age=value.match(/^(約)?(\d{1,3})(幾|出頭|尾|左右|以上|以下|\+)?$/);
  if(!age || +age[2]>120)return null;
  if(age[3] && ["幾","出頭","尾"].includes(age[3]) && (+age[2]<10 || +age[2]%10!==0 || +age[2]>110))return null;
  return `${age[1]||""}${+age[2]}${age[3]||""}`;
}
export function ageLabel(raw:string){
  const value=normalizeAge(raw);
  if(!value)return raw.trim();
  if(/以上|以下|左右$/.test(value))return value.replace(/(以上|以下|左右)$/, "歲$1");
  return `${value}歲`;
}
