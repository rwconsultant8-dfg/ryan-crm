import {NextRequest} from "next/server";
import {beforeEach,afterEach,describe,it,expect,vi} from "vitest";
const m=vi.hoisted(()=>({claim:vi.fn(),finish:vi.fn(),resolve:vi.fn(),latest:vi.fn(),process:vi.fn(),send:vi.fn(),admin:vi.fn(),syncName:vi.fn(),execute:vi.fn(),enqueue:vi.fn()}));
vi.mock("@/lib/supabase/admin",()=>({createAdminClient:m.admin}));
vi.mock("@/lib/codex/jobs",async importOriginal=>({...await importOriginal<object>(),loadClaim:m.claim,finishJob:m.finish,enqueueJob:m.enqueue}));
vi.mock("@/lib/assistant/execute",async original=>({...await original<object>(),executeTool:m.execute}));
vi.mock("@/lib/telegram/registry",()=>({resolveTelegramAgent:m.resolve}));
vi.mock("@/lib/telegram/transport",()=>({sendTelegramText:m.send}));
vi.mock("@/lib/whatsapp/drafts",()=>({latestPending:m.latest}));
vi.mock("@/lib/whatsapp/handle",()=>({processIncoming:m.process}));
vi.mock("@/lib/telegram/branding",()=>({syncTelegramDisplayName:m.syncName}));
import {GET,POST} from "@/app/api/codex/jobs/route";
import {hkToday} from "@/lib/weeks";
const id="00000000-0000-4000-8000-000000000001",lease="00000000-0000-4000-8000-000000000002";
const job={kind:"extraction",ownerId:"staff-a",from:"12345",messageId:"telegram:1",text:"私人資料",texts:"私人資料",today:hkToday(),expectedDraftId:null};
const result={client:{name:"試用客戶",age:"50",gender:"",occupation:"",marital:""},fields:[],checks:[],stage:"",season:"",activity:{r:0,n:0,a:0,rr:0,nr:0,pc:0},appointment:{slot:"",text:""},date:hkToday(),summary:"整理資料",tasks:[]};
function request(body:unknown,token="worker-token-at-least-thirty-two-characters"){return new NextRequest("https://app.test/api/codex/jobs",{method:"POST",headers:{authorization:`Bearer ${token}`,"Content-Type":"application/json"},body:JSON.stringify(body)});}
beforeEach(()=>{vi.clearAllMocks();m.admin.mockReturnValue({});vi.stubEnv("CODEX_WORKER_TOKEN","worker-token-at-least-thirty-two-characters");m.claim.mockResolvedValue({job,revision:"2026-11-06T08:00:00.000Z"});m.resolve.mockResolvedValue({id:"staff-a"});m.latest.mockResolvedValue(null);m.finish.mockResolvedValue(undefined);m.process.mockResolvedValue(undefined);m.send.mockResolvedValue(undefined);});
afterEach(()=>vi.unstubAllEnvs());
describe("Codex structured result boundary",()=>{
 it("rejects unauthenticated worker GET before changing bot profile",async()=>{expect((await GET(new NextRequest("https://app.test/api/codex/jobs"))).status).toBe(401);expect(m.syncName).not.toHaveBeenCalled();});
 it("rejects an unauthenticated request before accessing a job or CRM",async()=>{expect((await POST(request({id,lease,result},"wrong"))).status).toBe(401);expect(m.claim).not.toHaveBeenCalled();expect(m.admin).not.toHaveBeenCalled();});
 it("rejects malformed model results before consuming a claim",async()=>{expect((await POST(request({id,lease,result:{arbitrary:"tool command"}}))).status).toBe(400);expect(m.claim).not.toHaveBeenCalled();expect(m.process).not.toHaveBeenCalled();});
 it("rejects rebound or revoked Telegram identities without preparing a draft",async()=>{m.resolve.mockResolvedValue({id:"staff-b"});expect((await POST(request({id,lease,result}))).status).toBe(409);expect(m.process).not.toHaveBeenCalled();expect(m.finish).toHaveBeenCalledWith(expect.anything(),id,"2026-11-06T08:00:00.000Z",job,"failed");});
 it("does not overwrite a newer preview",async()=>{m.latest.mockResolvedValue({id:"newer",draft:{channel:"telegram"}});expect((await POST(request({id,lease,result}))).status).toBe(200);expect(m.process).not.toHaveBeenCalled();expect(m.send).toHaveBeenCalledWith("12345",expect.stringContaining("未有覆蓋"));});
 it("feeds validated data to preview creation for the server-derived owner, never a worker-supplied owner",async()=>{expect((await POST(request({id,lease,result}))).status).toBe(200);expect(m.process).toHaveBeenCalledWith(expect.objectContaining({from:"12345",text:"私人資料"}),"staff-a",expect.anything(),m.send,"telegram",expect.objectContaining({today:job.today,extract:expect.any(Function)}));const options=m.process.mock.calls[0][5];expect(await options.extract(job.texts)).toEqual(result);await expect(options.extract("changed")).rejects.toThrow();});
 it("rejects a replayed or expired lease",async()=>{m.claim.mockRejectedValue(Error("expired"));expect((await POST(request({id,lease,result}))).status).toBe(409);expect(m.process).not.toHaveBeenCalled();});
 it("answers a chat question even when another pending draft has changed, without entering the write flow",async()=>{
   m.latest.mockResolvedValue({id:"newer",draft:{channel:"telegram"}});
   const answer={...result,response:{kind:"chat",text:"可以先問客戶最想了解邊部分，再約時間傾。"}};
   expect((await POST(request({id,lease,result:answer}))).status).toBe(200);
   expect(m.process).not.toHaveBeenCalled();expect(m.latest).not.toHaveBeenCalled();
   expect(m.send).toHaveBeenCalledWith("12345",answer.response.text);
 });
 it("accepts a standalone chat answer and ignores irrelevant malformed CRM fields",async()=>{
   const result={response:{kind:"chat",text:"7乘8係56。"},client:"unused",date:""};
   expect((await POST(request({id,lease,result}))).status).toBe(200);
   expect(m.process).not.toHaveBeenCalled();expect(m.send).toHaveBeenCalledWith("12345","7乘8係56。");
 });
});

describe("Assistant tools do not enter CRM writes",()=>{
 it("consumes the lease once and continues with server-owned tool receipts",async()=>{
  const publicJob={...job,text:"幫我查 FWD 官方小冊子"};
  m.claim.mockResolvedValue({job:publicJob,revision:"r"});
  m.execute.mockResolvedValue({tool:"web_search",ok:true,data:{results:[]}});
  const result={response:{kind:"tool",text:""},tool:{name:"web_search",query:"FWD 官方香港小冊子"}};
  expect((await POST(request({id,lease,result}))).status).toBe(200);
  expect(m.finish).toHaveBeenCalledWith(expect.anything(),id,expect.anything(),publicJob,"done");
  expect(m.execute).toHaveBeenCalledWith(expect.anything(),"staff-a","12345",result.tool,undefined,publicJob.text);
  expect(m.send).toHaveBeenCalledWith("12345",expect.stringContaining("預計約 2–5 分鐘"));
  expect(m.enqueue).toHaveBeenCalledWith(expect.anything(),expect.objectContaining({ownerId:"staff-a",from:"12345",work:expect.objectContaining({step:1})}));
  expect(m.process).not.toHaveBeenCalled();expect(m.latest).not.toHaveBeenCalled();
 });
 it("revoked staff cannot execute any tool",async()=>{
  m.resolve.mockResolvedValue(null);
  expect((await POST(request({id,lease,result:{response:{kind:"tool",text:""},tool:{name:"web_search",query:"test search"}}}))).status).toBe(409);
  expect(m.execute).not.toHaveBeenCalled();
 });
 it("an update emitted after tool use cannot write a customer",async()=>{
  m.claim.mockResolvedValue({job:{...job,work:{rootMessageId:"x",step:1,observations:[]}},revision:"r"});
  expect((await POST(request({id,lease,result}))).status).toBe(200);expect(m.process).not.toHaveBeenCalled();
 });
});

it("requires official-source verification before answering a product question",async()=>{
  m.claim.mockResolvedValue({job:{...job,text:"FWD保障係點？"},revision:"r"});
  expect((await POST(request({id,lease,result:{response:{kind:"chat",text:"提供所有保障。"}}}))).status).toBe(200);
  expect(m.enqueue).toHaveBeenCalledWith(expect.anything(),expect.objectContaining({work:expect.objectContaining({observations:[expect.objectContaining({tool:"accuracy_check"})]})}));
  expect(m.send).not.toHaveBeenCalled();expect(m.process).not.toHaveBeenCalled();
});

it("does not repeat the time estimate for each step of the same task",async()=>{
  m.claim.mockResolvedValue({job:{...job,text:"幫我查 FWD 官方小冊子",work:{rootMessageId:"x",step:1,etaNotified:true,observations:[]}},revision:"r"});
  m.execute.mockResolvedValue({tool:"open_url",ok:true,data:{}});
  expect((await POST(request({id,lease,result:{response:{kind:"tool",text:""},tool:{name:"open_url",url:"https://www.fwd.com.hk/"}}}))).status).toBe(200);
  expect(m.send).not.toHaveBeenCalled();
  expect(m.enqueue).toHaveBeenCalledWith(expect.anything(),expect.objectContaining({work:expect.objectContaining({etaNotified:true})}));
});

it("rejects a web tool returned for a private factual note before execution", async () => {
  const note = "Ada，任職老師，琴日同佢見面整理收入同家用。佢有提到學校人工對比之前高咗，亦有傾保障同儲蓄，未定下一步。";
  m.claim.mockResolvedValue({job:{...job,text:note,texts:note},revision:"r"});
  const result={response:{kind:"tool",text:""},tool:{name:"web_search",query:"private facts"}};
  expect((await POST(request({id,lease,result}))).status).toBe(200);
  expect(m.execute).not.toHaveBeenCalled();
  expect(m.send).toHaveBeenCalledWith("12345",expect.stringContaining("原文已保留"));
});

it("retries a failed extraction once with the original message and context",async()=>{
  const original={...job,draftContext:[],telegramMessageId:45,quotedText:"Previous question"};
  m.claim.mockResolvedValue({job:original,revision:"r"});
  expect((await POST(request({id,lease,failed:true}))).status).toBe(200);
  expect(m.enqueue).toHaveBeenCalledWith(expect.anything(),expect.objectContaining({messageId:"telegram:1:retry",retry:true,draftContext:[],quotedText:"Previous question"}));
  expect(m.send).not.toHaveBeenCalled();
  m.enqueue.mockClear();
  m.claim.mockResolvedValue({job:{...original,retry:true},revision:"r"});
  expect((await POST(request({id,lease,failed:true}))).status).toBe(200);
  expect(m.enqueue).not.toHaveBeenCalled();
  expect(m.send).toHaveBeenCalledWith("12345",expect.stringContaining("未能回應"),undefined,45);
});

it("returns a targeted clarification on a public question without searching an arbitrary product", async()=>{
  m.claim.mockResolvedValue({job:{...job,text:"FWD保障係點？",telegramMessageId:21},revision:"r"});
  const answer="你想查邊個 FWD 產品嘅保障？";
  await POST(request({id,lease,result:{response:{kind:"chat",text:answer}}}));
  expect(m.send).toHaveBeenCalledWith("12345",answer,undefined,21);
  expect(m.enqueue).not.toHaveBeenCalled();
});
