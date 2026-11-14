import {NextRequest} from "next/server";
import {beforeEach,afterEach,describe,it,expect,vi} from "vitest";
const m=vi.hoisted(()=>({claim:vi.fn(),finish:vi.fn(),resolve:vi.fn(),latest:vi.fn(),process:vi.fn(),send:vi.fn(),admin:vi.fn(),syncName:vi.fn(),execute:vi.fn(),enqueue:vi.fn(),loadTasks:vi.fn(),saveFile:vi.fn(),listFiles:vi.fn(),readFile:vi.fn()}));
vi.mock("@/lib/supabase/admin",()=>({createAdminClient:m.admin}));
vi.mock("@/lib/codex/jobs",async importOriginal=>({...await importOriginal<object>(),loadClaim:m.claim,finishJob:m.finish,enqueueJob:m.enqueue}));
vi.mock("@/lib/assistant/execute",async original=>({...await original<object>(),executeTool:m.execute}));
vi.mock("@/lib/telegram/registry",async original=>({...await original<object>(),resolveTelegramAgent:m.resolve}));
vi.mock("@/lib/planner-data",()=>({loadTasks:m.loadTasks}));
vi.mock("@/lib/telegram/files",async original=>({...await original<object>(),saveBotFile:m.saveFile,listBotFiles:m.listFiles,readBotFile:m.readFile}));
vi.mock("@/lib/telegram/transport",()=>({sendTelegramText:m.send}));
vi.mock("@/lib/whatsapp/drafts",()=>({latestPending:m.latest}));
vi.mock("@/lib/whatsapp/handle",()=>({processIncoming:m.process}));
vi.mock("@/lib/telegram/branding",()=>({syncTelegramDisplayName:m.syncName}));
import {GET,POST} from "@/app/api/codex/jobs/route";
import {TEAM_SCOPE_REPLY} from "@/lib/codex/conversation-probe";
import {hkToday} from "@/lib/weeks";
import {paWorkerInput,PA_PROBE_ID} from "@/lib/telegram/pa-codex";
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


describe("private PA Codex jobs", () => {
  const paJob = { ...job, kind: "pa" as const, messageId: "telegram-pa:1", telegramMessageId: 23, quotedText: "Ryan 私人上文" };
  beforeEach(() => {
    vi.stubEnv("TELEGRAM_PA_USER_ID", "12345");
    vi.stubEnv("TELEGRAM_PA_BOT_TOKEN", "pa-token");
    vi.stubEnv("TELEGRAM_PA_WEBHOOK_SECRET", "pa-secret");
    vi.stubEnv("TELEGRAM_COACH_BOT_TOKEN", "coach-token");
    vi.stubEnv("TELEGRAM_COACH_WEBHOOK_SECRET", "coach-secret");
    m.listFiles.mockResolvedValue([]);
    m.claim.mockResolvedValue({job:paJob,revision:"r"});
  });

  it("builds the prompt from Ryan's own schedule and private PA history", async () => {
    m.loadTasks.mockResolvedValue([{day:job.today,time:"15:40",name:"測試約見",plan:"測試地點",status:"planned",unneeded:"do not send"}]);
    m.listFiles.mockResolvedValue([{key:"private-key",name:"PA對話-1.json",created_at:"2026-11-12T00:00:00Z"},{key:"uploaded-key",name:"uploaded.txt",created_at:"2026-11-12T00:00:00Z"}]);
    m.readFile.mockResolvedValue({body:Buffer.from(JSON.stringify({user:"先前問題",assistant:"先前答案"}))});
    const prompt = await paWorkerInput({} as never,id,paJob);
    expect(m.listFiles).toHaveBeenCalledWith(expect.anything(),"pa/12345");
    expect(m.readFile).toHaveBeenCalledExactlyOnceWith(expect.anything(),"pa/12345","private-key");
    expect(m.loadTasks).toHaveBeenCalledWith(expect.anything(),job.today,expect.any(String),"staff-a");
    expect(prompt.input).toMatchObject({quoted_reply:paJob.quotedText,conversation:[{user:"先前問題",assistant:"先前答案"}],stored_schedule:[{name:"測試約見"}]});
    expect(JSON.stringify(prompt)).not.toContain("do not send");
  });

  it("answers the original private message and saves the turn in the PA scope", async () => {
    const answer = {response:{kind:"chat",text:"你今日下午有約。"}};
    expect((await POST(request({id,lease,result:answer}))).status).toBe(200);
    expect(m.send).toHaveBeenCalledExactlyOnceWith("12345",answer.response.text,"pa-token",23);
    expect(m.saveFile).toHaveBeenCalledWith(expect.anything(),"pa/12345",expect.stringMatching(/^PA對話-/),expect.any(Buffer),"application/json");
    expect(m.process).not.toHaveBeenCalled();
    expect(m.execute).not.toHaveBeenCalled();
  });

  it("rejects changed PA access before delivering private information", async () => {
    vi.stubEnv("TELEGRAM_PA_USER_ID","54321");
    expect((await POST(request({id,lease,result:{response:{kind:"chat",text:"私人答覆"}}}))).status).toBe(409);
    expect(m.finish).toHaveBeenCalledWith(expect.anything(),id,"r",paJob,"failed");
    expect(m.send).not.toHaveBeenCalled();
    expect(m.saveFile).not.toHaveBeenCalled();
  });

  it("keeps PA model output away from the CRM write and tool paths", async () => {
    expect((await POST(request({id,lease,result}))).status).toBe(200);
    expect(m.enqueue).toHaveBeenCalledWith(expect.anything(),expect.objectContaining({kind:"pa",retry:true}));
    expect(m.process).not.toHaveBeenCalled();
    expect(m.execute).not.toHaveBeenCalled();
    expect(m.send).not.toHaveBeenCalled();
  });

  it("records the synthetic health check without sending Telegram or touching private files", async () => {
    const probe = {...paJob,kind:"health",probe:"pa-chat-v1",messageId:PA_PROBE_ID};
    m.claim.mockResolvedValue({job:probe,revision:"r"});
    expect((await POST(request({id,lease,result:{response:{kind:"chat",text:"星期二下午3點40分，喺九龍公共圖書館。"}}}))).status).toBe(200);
    expect(m.finish).toHaveBeenCalledWith(expect.anything(),id,"r",probe,"done");
    expect(m.send).not.toHaveBeenCalled();
    expect(m.saveFile).not.toHaveBeenCalled();
  });
});

it("delivers the team scope reply without researching a private question or writing to CRM", async () => {
  m.claim.mockResolvedValue({job:{...job,text:"幫我上網搵私人週末想睇嘅電影"},revision:"r"});
  const response={kind:"chat",text:TEAM_SCOPE_REPLY};
  expect((await POST(request({id,lease,result:{response}}))).status).toBe(200);
  expect(m.send).toHaveBeenCalledWith("12345",TEAM_SCOPE_REPLY);
  expect(m.execute).not.toHaveBeenCalled();
  expect(m.enqueue).not.toHaveBeenCalled();
  expect(m.process).not.toHaveBeenCalled();
});
