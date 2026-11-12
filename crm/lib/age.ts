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

/** Return completed years only when the full date identifies a unique plausible birth year. */
export function ageFromBirthDate(raw: string, today: string): number | null {
  const date = raw.normalize("NFKC").replace(/\s+/gu, "");
  const parts = /^(\d{2}|\d{4})年(\d{1,2})月(\d{1,2})[日號]?$/.exec(date)
    ?? /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/.exec(date);
  if (!parts || !/^\d{4}-\d{2}-\d{2}$/.test(today)) return null;
  const [, yearText, monthText, dayText] = parts;
  const [currentYear, currentMonth, currentDay] = today.split("-").map(Number);
  const month = Number(monthText), day = Number(dayText);
  const currentCentury = Math.floor(currentYear / 100) * 100;
  const years = yearText.length === 4 ? [Number(yearText)] : [currentCentury + Number(yearText), currentCentury - 100 + Number(yearText)];
  const ages = years.flatMap((year) => {
    const birthDate = new Date(Date.UTC(year, month - 1, day));
    if (birthDate.getUTCFullYear() !== year || birthDate.getUTCMonth() !== month - 1 || birthDate.getUTCDate() !== day) return [];
    const beforeBirthday = currentMonth < month || (currentMonth === month && currentDay < day);
    const age = currentYear - year - Number(beforeBirthday);
    return age >= 0 && age <= 120 ? [age] : [];
  });
  return ages.length === 1 ? ages[0] : null;
}
