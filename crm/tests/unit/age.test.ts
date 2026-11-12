import {describe,it,expect} from "vitest";
import {normalizeAge,ageLabel} from "@/lib/age";
import {applyDraft,describeDraft,type Draft} from "@/lib/whatsapp/apply";
import {decryptColumn} from "@/lib/secure";
import {validatePatch} from "@/lib/bridge/schema";
import {vi,afterEach} from "vitest";
afterEach(()=>vi.unstubAllEnvs());
describe("preserve age uncertainty in the age field",()=>{
 it("retains decades, estimates and ranges without inventing precision",()=>{for(const [raw,want] of [["50幾歲","50幾"],["五十幾歲","50幾"],["五十多歲","50幾"],["約55歲","約55"],["大約55歲","約55"],["50至59歲","50-59"],["50–59","50-59"],["50歲左右","50左右"],["55歲","55"],["",""]])expect(normalizeAge(raw)).toBe(want);});
 it("rejects unrelated prose and impossible or inverted ages",()=>{for(const raw of ["保守，想退休","兒子50歲","60歲退休","999","59-50","-5","53幾"])expect(normalizeAge(raw)).toBeNull();});
 it("formats ages without duplicate units",()=>{expect(ageLabel("50幾歲")).toBe("50幾歲");expect(ageLabel("約55")).toBe("約55歲");expect(ageLabel("50左右")).toBe("50歲左右");expect(ageLabel("50-59")).toBe("50-59歲");});
 it("accepts the same representation at the bridge boundary",()=>{expect(()=>validatePatch({info:{age:"50幾"}})).not.toThrow();expect(()=>validatePatch({info:{age:"50-59"}})).not.toThrow();expect(()=>validatePatch({info:{age:"60歲退休"}})).toThrow();});
 it("previews and encrypts approximate age in basic info without moving it to personality",async()=>{
  vi.stubEnv("DATA_ENCRYPTION_KEY",Buffer.alloc(32,12).toString("base64"));
  const draft:Draft={channel:"telegram",texts:["新客陳生50幾歲"],today:"2026-11-06",target:{mode:"new",id:"client-a",name:"陳生"},extraction:{client:{name:"陳生",age:"50幾歲",gender:"",occupation:"",marital:""},fields:[],checks:[],stage:"",season:"",activity:{r:0,n:0,a:0,rr:0,nr:0,pc:0},appointment:{slot:"",text:""},date:"2026-11-06",summary:"",tasks:[]}};
  const rpc=vi.fn().mockResolvedValue({error:null});await applyDraft({rpc} as never,"staff-a",draft);
  const patch=rpc.mock.calls[0][1].p_patch;expect(decryptColumn("client-a","info",patch.info).age).toBe("50幾");expect(patch.form_rr).toBeUndefined();expect(describeDraft(draft)).toContain("50幾歲");expect(describeDraft(draft)).not.toContain("歲歲");
  const existing={...draft,target:{mode:"existing" as const,id:"client-a",name:"陳生"}};expect(describeDraft(existing)).toContain("【基本資料（空白欄位會補填）】\n年齡：50幾歲");
 });
});
