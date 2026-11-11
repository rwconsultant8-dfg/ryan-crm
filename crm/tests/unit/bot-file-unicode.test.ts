import {beforeEach,afterEach,describe,it,expect,vi} from "vitest";
import type {SupabaseClient} from "@supabase/supabase-js";
import {saveBotFile,readBotFile,listBotFiles} from "@/lib/telegram/files";
import {encryptValue} from "@/lib/crypto";
const key=Buffer.alloc(32,11),scope="coach/staff-a";
// The storage service accepts ASCII object keys, independent of the file's contents.
const validObjectKey=/^[A-Za-z0-9_/!.*'() &$=@;:+,?-]*$/;
function storage(){
 const objects=new Map<string,string>();
 const upload=vi.fn(async(path:string,body:string)=>{if(!validObjectKey.test(path))return{error:{code:"InvalidKey",statusCode:"400"}};objects.set(path,body);return{error:null};});
 const bucket={upload,download:vi.fn(async(path:string)=>({data:objects.has(path)?new Blob([objects.get(path)!]):null,error:objects.has(path)?null:{code:"NoSuchKey",statusCode:"404"}})),list:vi.fn(async(prefix:string)=>({data:[...objects.keys()].filter(p=>p.startsWith(prefix+"/")).map(p=>({id:p,name:p.slice(prefix.length+1),created_at:"2026-11-06T06:38:00Z"})),error:null}))};
 const admin={storage:{getBucket:async()=>({data:{public:false},error:null}),from:()=>bucket}};
 return{admin:admin as unknown as SupabaseClient,objects,upload};
}
beforeEach(()=>vi.stubEnv("DATA_ENCRYPTION_KEY",key.toString("base64")));afterEach(()=>vi.unstubAllEnvs());
describe("Unicode Bot File persistence",()=>{
 it("archives Cantonese updates with storage-safe keys and preserves the Chinese display name and content",async()=>{
  const db=storage(),name="更新-2026-11-06.txt",text="測試客戶資料，等確認後先寫入。";
  const stored=await saveBotFile(db.admin,scope,name,Buffer.from(text),"text/plain");
  expect(validObjectKey.test(`${scope}/${stored}`)).toBe(true);
  const file=await readBotFile(db.admin,scope,stored);expect(file.name).toBe(name);expect(file.body.toString()).toBe(text);
  expect((await listBotFiles(db.admin,scope))[0]).toMatchObject({key:stored,name});
  expect(db.objects.get(`${scope}/${stored}`)).not.toContain(text);
 });
 it("accepts Unicode, emoji and percent signs in original attachment names",async()=>{const db=storage(),name="客戶資料%🧾.pdf";const stored=await saveBotFile(db.admin,scope,name,Buffer.from([0,1,2]));expect(validObjectKey.test(stored)).toBe(true);expect((await readBotFile(db.admin,scope,stored)).name).toBe(name);expect((await listBotFiles(db.admin,scope))[0].name).toBe(name);});
 it("keeps long encoded names inside the validated key limit",async()=>{const db=storage(),name="更".repeat(120);const stored=await saveBotFile(db.admin,scope,name,Buffer.from("x"));expect(stored.length).toBeLessThanOrEqual(600);expect((await listBotFiles(db.admin,scope))[0].name).toBe(name);});
 it("continues listing and decrypting legacy credential files without rewriting them",async()=>{const db=storage(),stored="00000000-0000-4000-8000-000000000001--coach-credentials.json.enc",path=`coach/settings/${stored}`;db.objects.set(path,encryptValue(key,`bot-file:${path}`,JSON.stringify({name:"coach-credentials.json",mime:"application/json",body:Buffer.from("existing-secret-placeholder").toString("base64")})));expect((await listBotFiles(db.admin,"coach/settings"))[0].name).toBe("coach-credentials.json");expect((await readBotFile(db.admin,"coach/settings",stored)).body.toString()).toBe("existing-secret-placeholder");expect(db.upload).not.toHaveBeenCalled();});
});
