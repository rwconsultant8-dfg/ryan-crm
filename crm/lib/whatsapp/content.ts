import type {Extraction} from "./schema";
export function hasClientFacts(e:Extraction){
 return Boolean(e.fields?.some(f=>f.text.trim()) || e.checks?.length || e.stage || e.season || Object.entries(e.client || {}).some(([key,value])=>key!=="name" && Boolean(value)));
}
