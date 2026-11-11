import "server-only";
import type {SupabaseClient} from '@supabase/supabase-js';
import {type Job,finishJob,enqueueJob,jobId,openJob} from '../codex/jobs';
import {executeTool,sourceReply} from './execute';
import {type toolResultSchema,MAX_TOOL_STEPS,researchSourceMissing} from './schema';
import type {Extraction} from '../whatsapp/schema';
import type {z} from 'zod';

/** Runs the same research loop with public sample data, without Telegram sends or customer changes. */
export async function runResearchProbe(admin:SupabaseClient,id:string,revision:string|null,job:Job,result:Extraction|z.infer<typeof toolResultSchema>|undefined,failed?:true){
 if(!failed&&result&&'tool'in result&&(job.work?.step||0)<MAX_TOOL_STEPS&&['web_search','open_url'].includes(result.tool.name)){
  await finishJob(admin,id,revision,job,'done');
  const observation=await executeTool(admin,job.ownerId,'',result.tool,job.work,job.text);
  const step=(job.work?.step||0)+1,rootMessageId=job.work?.rootMessageId||job.messageId;
  await enqueueJob(admin,{...job,messageId:`${rootMessageId}:tool:${step}`,work:{rootMessageId,step,etaNotified:true,observations:[...(job.work?.observations||[]),observation]},state:'pending',lease:undefined,leaseUntil:undefined});
  return{ok:true,continued:true};
 }
 const answer=result?.response?.text||'';
 const passed=!failed&&Boolean(result&&!('tool'in result)&&result.response?.kind==='chat'&&!researchSourceMissing(job.text,job.work)&&!/(?:無法|不能|未能).{0,12}(?:上網|搜尋)/.test(answer));
 const probeReport={passed,answer:sourceReply(answer,job.work).slice(0,3000),tools:job.work?.observations.map(o=>`${o.tool}:${o.ok?'ok':'failed'}`)||[]};
 await finishJob(admin,id,revision,{...job,probeReport},passed?'done':'failed');
 console.info(`Codex research flow ${passed?'passed':'failed'}`,{steps:job.work?.step||0,tools:probeReport.tools});
 return{ok:true,passed};
}
export async function researchProbeReport(admin:SupabaseClient,root:string){
 const ids=Array.from({length:MAX_TOOL_STEPS+1},(_,step)=>jobId(step?`${root}:tool:${step}`:root));
 const {data,error}=await admin.from('wa_drafts').select('id,payload').in('id',ids);
 if(error)throw Error('Research probe unavailable');
 const jobs=(data||[]).map(row=>openJob(row.id,row.payload));
 const final=jobs.find(job=>job.probeReport);
 return{status:final?.probeReport?.passed?'passed':final?'failed':'pending',report:final?.probeReport,steps:jobs.map(job=>({step:job.work?.step||0,state:job.state,tools:job.work?.observations.map(o=>({name:o.tool,ok:o.ok,error:!o.ok?o.data:undefined,sources:o.sources}))||[]})).sort((a,b)=>a.step-b.step)};
}
