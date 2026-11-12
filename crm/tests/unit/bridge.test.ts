import { describe,it,expect,vi,beforeEach } from "vitest";
import { generateKeyPairSync,sign } from "node:crypto";
import { authenticate } from "@/lib/bridge/auth";
import { handleCommand } from "@/lib/bridge/handle";
import { commandSchema } from "@/lib/bridge/schema";
import { encryptColumn } from "@/lib/secure";
import type { SupabaseClient } from "@supabase/supabase-js";
const keypair=generateKeyPairSync("ed25519");const pub=keypair.publicKey.export({format:"pem",type:"spki"}).toString();
const staff={id:'11111111-1111-4111-8111-111111111111',role:'agent' as const,phone:'10000000001',messageId:'test'};
const manager={id:'22222222-2222-4222-8222-222222222222',role:'admin' as const,phone:'10000000002',messageId:'test'};
function token(overrides={}) {const b=Buffer.from(JSON.stringify({aud:"ryan-crm-whatsapp-v1",phone:staff.phone,sub:staff.id,role:staff.role,iat:1000,exp:2000,messageId:"test",...overrides})).toString('base64url');return 'Bearer '+b+'.'+sign(null,Buffer.from(b),keypair.privateKey).toString('base64url');}
function mockDb(role='agent',active=true) {
 const calls:{table:string;operation:string;filters:Record<string,unknown>;value?:unknown}[]=[];
 const rows=[{id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',owner_id:manager.id,updated_at:'2026-10-23T00:00:00Z',info:{}},{id:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',owner_id:staff.id,updated_at:'2026-10-23T00:00:00Z',info:{}}];
 const from=(table:string)=>{
  const call={table,operation:'select',filters:{} as Record<string,unknown>,value:undefined as unknown};calls.push(call);
  let single=false;
  const q:any={select:()=>q,eq:(k:string,v:unknown)=>{call.filters[k]=v;return q;},order:()=>q,range:()=>q,limit:()=>q,
   insert:(v:unknown)=>{call.operation='insert';call.value=v;return q;},update:(v:unknown)=>{call.operation='update';call.value=v;return q;},delete:()=>{call.operation='delete';return q;},
   maybeSingle:()=>{single=true;return q;},single:()=>{single=true;return q;},then:(resolve:any)=>{
    if(table==='profiles') return Promise.resolve(resolve({data:{id:call.filters.id,role,active,full_name:'test',whatsapp:null},error:null}));
    if(table==='clients') {
     const found=rows.filter(r=>Object.entries(call.filters).every(([k,v])=>(r as any)[k]===v));
     return Promise.resolve(resolve({data:single?found[0]??null:found,error:null}));
    }
    return Promise.resolve(resolve({data:{id:'journal'},error:null}));
   }};return q;
 };return {db:{from} as unknown as SupabaseClient,calls,rows};
}
beforeEach(()=>{process.env.DATA_ENCRYPTION_KEY=Buffer.alloc(32,9).toString('base64');});
describe('signed bridge identity',()=>{
 it('accepts the exact signed phone/profile pair',()=>expect(authenticate(token(),1500,pub).id).toBe(staff.id));
 it('rejects expired, future, long-lived, wrong-audience and invalid claims',()=>{
  for(const c of [{exp:1400},{iat:1600},{exp:9999},{aud:'other'},{sub:'invalid'},{phone:'999'}]) expect(()=>authenticate(token(c),1500,pub)).toThrow();
 });
 it('rejects unsigned and tampered tokens',()=>{expect(()=>authenticate(null,1500,pub)).toThrow();expect(()=>authenticate(token()+'x',1500,pub)).toThrow();});
});
describe('server ownership enforcement',()=>{
 it('filters staff lists by her fixed owner id',async()=>{const m=mockDb();const r:any=await handleCommand(m.db,staff,{action:'list'});expect(r.clients).toHaveLength(1);expect(r.clients[0].owner_id).toBe(staff.id);});
 it('rejects another owner in a list or create before reading clients or writing',async()=>{for(const c of [{action:'list',owner_id:manager.id},{action:'create',operation_id:'cccccccc-cccc-4ccc-8ccc-cccccccccccc',owner_id:manager.id,patch:{info:{name:'test'}}}]) {const m=mockDb();await expect(handleCommand(m.db,staff,c)).rejects.toMatchObject({status:403});expect(m.calls.filter(c=>c.table==='clients')).toHaveLength(0);}});
 it('denies cross-owner get, update and delete even with a known UUID',async()=>{for(const action of ['get','update','delete']) {const m=mockDb();const c:any={action,id:m.rows[0].id};if(action!=='get')Object.assign(c,{operation_id:'cccccccc-cccc-4ccc-8ccc-cccccccccccc',expected_updated_at:m.rows[0].updated_at});if(action==='update')c.patch={stage:'MEETING'};if(action==='delete')c.confirmed_name='test';await expect(handleCommand(m.db,staff,c)).rejects.toMatchObject({status:404});expect(m.calls.some(c=>c.operation!=='select')).toBe(false);}});
 it('rechecks active role on every request',async()=>{for(const [role,active] of [['agent',false],['admin',true]] as const) await expect(handleCommand(mockDb(role,active).db,staff,{action:'whoami'})).rejects.toMatchObject({status:403});});
 it('allows manager to list team clients',async()=>{const r:any=await handleCommand(mockDb('admin').db,manager,{action:'list'});expect(r.clients).toHaveLength(2);});
 it('denies staff staff access',async()=>{await expect(handleCommand(mockDb().db,staff,{action:'staff'})).rejects.toMatchObject({status:403});});
 it('rejects stale updates without writes',async()=>{const m=mockDb();await expect(handleCommand(m.db,staff,{action:'update',id:m.rows[1].id,operation_id:'cccccccc-cccc-4ccc-8ccc-cccccccccccc',expected_updated_at:'2026-10-22T00:00:00Z',patch:{stage:'MEETING'}})).rejects.toMatchObject({status:409});expect(m.calls.some(c=>c.operation!=='select')).toBe(false);});
 it('adds owner and timestamp predicates to updates and stores encrypted backup first',async()=>{const m=mockDb();const r:any=await handleCommand(m.db,staff,{action:'update',id:m.rows[1].id,operation_id:'cccccccc-cccc-4ccc-8ccc-cccccccccccc',expected_updated_at:m.rows[1].updated_at,patch:{info:{occupation:'test'}}});expect(r.ok).toBe(true);const write=m.calls.find(c=>c.table==='clients'&&c.operation==='update')!;expect(write.filters).toEqual({id:m.rows[1].id,owner_id:staff.id,updated_at:m.rows[1].updated_at});const journal:any=m.calls.find(c=>c.table==='wa_drafts'&&c.operation==='insert')!.value;expect(journal.payload).toMatch(/^v1\./);expect(journal.payload).not.toContain('occupation');});
 it('rejects owner reassignment, unknown actions and raw SQL',()=>{for(const c of [{action:'sql',sql:'select *'},{action:'update',id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',operation_id:'cccccccc-cccc-4ccc-8ccc-cccccccccccc',expected_updated_at:'2026-10-23T00:00:00Z',patch:{owner_id:manager.id}}]) expect(commandSchema.safeParse(c).success).toBe(false);});
});
