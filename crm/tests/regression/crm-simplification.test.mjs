import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const ownerId = 'test-agent';
const day = '2026-11-02';

// Load the real server actions without Next or live credentials; database access is mocked.
async function runtime(db = {}) {
  const context = vm.createContext({ Buffer, console, process: { env: { DATA_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64') } } });
  const cache = new Map();
  const stubs = {
    'server-only': {},
    zod: await import('zod'),
    'next/navigation': { redirect() { throw new Error('redirect'); } },
    'next/cache': { revalidatePath() {} },
    '@/lib/auth': { requireUser: async () => ({ supabase: db, profile: { id: ownerId } }) },
  };
  function synthetic(key, exports) {
    return new vm.SyntheticModule(Object.keys(exports), function () {
      for (const [k, v] of Object.entries(exports)) this.setExport(k, v);
    }, { context, identifier: key });
  }
  async function get(spec, parent = resolve(root, 'entry.ts')) {
    const key = spec in stubs || spec.startsWith('node:') ? spec : spec.startsWith('@/') ? resolve(root, spec.slice(2) + '.ts') : resolve(dirname(parent), spec.endsWith('.ts') ? spec : spec + '.ts');
    if (cache.has(key)) return cache.get(key);
    let module;
    if (key in stubs) module = synthetic(key, stubs[key]);
    else if (key.startsWith('node:')) module = synthetic(key, await import(key));
    else module = new vm.SourceTextModule(stripTypeScriptTypes(await readFile(key, 'utf8')), { context, identifier: key });
    cache.set(key, module);
    return module;
  }
  return async (file) => {
    const module = await get('@/' + file.replace(/\.ts$/, ''));
    if (module.status === 'unlinked') await module.link((spec, parent) => get(spec, parent.identifier));
    if (module.status === 'linked') await module.evaluate();
    return module.namespace;
  };
}

function database(initial = []) {
  const rows = structuredClone(initial), writes = [], filters = [];
  return { rows, writes, filters, from(table) {
    assert.equal(table, 'activity_days');
    let op = 'select', payload, conditions = [];
    const q = {
      select() { return q; },
      eq(k, v) { conditions.push([k, v]); filters.push([k, v]); return q; },
      gte() { return q; }, lte() { return q; },
      update(value) { op = 'update'; payload = value; return q; },
      insert(value) { op = 'insert'; payload = value; return q; },
      then(ok, fail) {
        const matches = rows.filter(r => conditions.every(([k, v]) => r[k] === v));
        if (op === 'update') for (const row of matches) Object.assign(row, structuredClone(payload));
        if (op === 'insert') rows.push(structuredClone(payload));
        if (op !== 'select') writes.push({ op, payload });
        return Promise.resolve({ data: op === 'select' ? matches : null, error: null }).then(ok, fail);
      },
    };
    return q;
  } };
}

const plain = v => JSON.parse(JSON.stringify(v));

test('all historical network categories remain visible in the three agreed columns', async () => {
  const load = await runtime();
  const { SEASONS, normalizeSeason } = await load('lib/seasons.ts');
  assert.deepEqual(plain(SEASONS.map(x => x.label)), ['Fact Finding', 'Needs', 'Presentation']);
  assert.deepEqual(['SPRING', 'SUMMER', 'AUTUMN', 'WINTER', null, 'NONE'].map(normalizeSeason), ['SPRING', 'SUMMER', 'AUTUMN', 'SPRING', 'SPRING', 'SPRING']);
});

test('seven historical client stages map to five visible columns without losing signed/issued status', async () => {
  const { boardStage } = await (await runtime())('lib/stages.ts');
  assert.deepEqual(['RR', 'NR1', 'NR2', 'FNA', 'PC', 'SIGNED', 'ISSUED'].map(boardStage), ['MEETING', 'MEETING', 'FOLLOWUP', 'FOLLOWUP', 'PROPOSAL', 'SIGNED', 'ISSUED']);
});

test('breakfast saves encrypted, survives reload, and preserves lunch and old activity counts', async () => {
  const db = database([{ id: 'existing', owner_id: ownerId, day, r: 9, rr: 4, appts: {} }]);
  const load = await runtime(db);
  const secure = await load('lib/secure.ts');
  db.rows[0].appts = secure.encryptColumn(`${ownerId}:${day}`, 'appts', {}, { lunch: '舊午餐', dinner: '舊晚飯' });
  const { saveActivityWeekAction } = await load('app/(app)/activity/actions.ts');
  const result = await saveActivityWeekAction(day, [{ day, appts: { breakfast: '九點見面', lunch: '舊午餐', dinner: '舊晚飯', tea: '' } }]);
  assert.equal(result.ok, true);
  assert.deepEqual(Object.keys(db.writes[0].payload), ['appts']);
  assert.equal(db.rows[0].r, 9);
  assert.equal(db.rows[0].rr, 4);
  assert.ok(!JSON.stringify(db.rows[0].appts).includes('九點見面'));
  const { loadWeek } = await load('lib/activity-data.ts');
  const reloaded = await loadWeek(db, ownerId, day);
  assert.equal(reloaded.length, 7);
  assert.deepEqual(plain(reloaded[0].appts), { breakfast: '九點見面', lunch: '舊午餐', dinner: '舊晚飯' });
  assert.ok(db.filters.some(([k, v]) => k === 'owner_id' && v === ownerId));
});

test('a new breakfast inserts only the owner, date, and encrypted appointments', async () => {
  const db = database();
  const load = await runtime(db);
  const { saveActivityWeekAction } = await load('app/(app)/activity/actions.ts');
  assert.equal((await saveActivityWeekAction(day, [{ day, appts: { breakfast: '早餐約會' } }])).ok, true);
  assert.deepEqual(Object.keys(db.writes[0].payload).sort(), ['appts', 'day', 'owner_id']);
  assert.equal(db.rows[0].owner_id, ownerId);
});

test('invalid dates cannot write calendar data', async () => {
  const db = database();
  const { saveActivityWeekAction } = await (await runtime(db))('app/(app)/activity/actions.ts');
  assert.equal((await saveActivityWeekAction(day, [{ day: '2026-11-10', appts: { breakfast: 'x' } }])).ok, false);
  assert.equal(db.writes.length, 0);
});

test('WhatsApp breakfast preview has no scores and confirmation sends no activity increments', async () => {
  const load = await runtime();
  const { applyDraft, describeDraft, hasContent } = await load('lib/whatsapp/apply.ts');
  const extraction = { client: {}, fields: [], checks: [], stage: '', season: '', activity: { r: 3, n: 0, a: 1, rr: 1, nr: 0, pc: 0 }, appointment: { slot: 'breakfast', text: '九點早餐' }, date: day, summary: '' };
  const draft = { texts: [], today: day, target: { mode: 'none' }, extraction };
  assert.match(describeDraft(draft), /上午 appointment：九點早餐/);
  assert.doesNotMatch(describeDraft(draft), /A\+1|RR\+1|活動分/);
  assert.equal(hasContent({ ...draft, extraction: { ...extraction, appointment: { slot: '', text: '' } } }), false);
  const calls = [];
  const admin = {
    from() { const q = { select() { return q; }, eq() { return q; }, maybeSingle: async () => ({ data: null, error: null }) }; return q; },
    rpc: async (name, args) => { calls.push({ name, args }); return { error: null }; },
  };
  await applyDraft(admin, ownerId, draft);
  assert.equal(calls[0].name, 'wa_add_activity');
  assert.deepEqual(plain(calls[0].args.p_counts), {});
  const { decryptColumn } = await load('lib/secure.ts');
  assert.equal(decryptColumn(`${ownerId}:${day}`, 'appts', calls[0].args.p_appts).breakfast, '九點早餐');
});

function linkedDatabase(seed, beforeWrite) {
  const tables=structuredClone(seed), writes=[];
  return {tables,writes,from(table){
    const rows=tables[table] ||= [];let op='select',payload,filters=[],start=0,end=Infinity;
    function matches(row){return filters.every(f=>f(row));}
    function result(single=false){
      if(op!=='select') beforeWrite?.(table,tables);
      const selected=rows.filter(matches).slice(start,end+1);
      if(op==='update') {for(const row of selected) Object.assign(row,structuredClone(payload)); if(selected.length) writes.push({table,payload:structuredClone(payload)});}
      if(op==='insert'){rows.push(structuredClone(payload));writes.push({table,payload:structuredClone(payload)});}
      const data=op==='insert'?null:structuredClone(single ? selected[0] || null : selected);
      return Promise.resolve({data,error:null});
    }
    const q={select(){return q;},eq(k,v){filters.push(row=>row[k]===v);return q;},in(k,v){filters.push(row=>v.includes(row[k]));return q;},gte(k,v){filters.push(row=>row[k]>=v);return q;},lte(k,v){filters.push(row=>row[k]<=v);return q;},order(){return q;},range(a,b){start=a;end=b;return q;},insert(v){op='insert';payload=v;return q;},update(v){op='update';payload=v;return q;},single(){return result(true);},maybeSingle(){return result(true);},then(ok,fail){return result().then(ok,fail);}};return q;
  }};
}
const clientId='00000000-0000-4000-8000-000000000001';
const taskId='00000000-0000-4000-8000-000000000002';

test('mission progress counts real completed tasks and excludes cancelled work',async()=>{
  const f=await (await runtime())('lib/followups.ts');
  assert.deepEqual(plain(f.missionProgress([{status:'done'},{status:'planned'},{status:'cancelled'}])),{done:1,total:2,percent:50});
  assert.equal(f.missionProgress([]).percent,0);
  assert.equal(f.overdueTask({day:'2026-11-01',status:'done'},day),false);
  assert.equal(f.overdueTask({day:'2026-11-01',status:'blocked'},day),true);
  const first=f.nextClientTask([{client_id:clientId,day:'2026-11-04',time:'10:00',status:'planned'},{client_id:clientId,day:'2026-11-02',time:'10:00',status:'done'},{client_id:clientId,day:'2026-11-03',status:'planned'}],clientId);
  assert.equal(first.day,'2026-11-03');
});

test('linked task validates ownership and uses the actual client name',async()=>{
  const db=linkedDatabase({clients:[{id:clientId,owner_id:ownerId,info:{}}],daily_tasks:[]});
  const load=await runtime(db),secure=await load('lib/secure.ts');
  db.tables.clients[0].info=secure.encryptColumn(clientId,'info',{}, {name:'真實客名'});
  const {createTask}=await load('app/(app)/today/actions.ts');
  const input={day,category:'appointment',stage:'needs',name:'錯誤顯示名',plan:'講解方案',client_id:clientId,time:'09:30'};
  assert.equal((await createTask(input)).error,'');
  const row=db.tables.daily_tasks[0],info=secure.decryptColumn(row.id,'info',row.info);
  assert.equal(info.client_id,clientId);assert.equal(info.name,'真實客名');assert.equal(info.time,'09:30');
  assert.equal('client_id' in row,false);
  assert.notEqual((await createTask({...input,client_id:'00000000-0000-4000-8000-000000000099'})).error,'');
  assert.notEqual((await createTask({...input,time:'29:99'})).error,'');
  assert.equal(db.tables.daily_tasks.length,1);
  assert.equal((await createTask({...input,time:'',period:'afternoon'})).error,'');
  const periodRow=db.tables.daily_tasks[1],periodInfo=secure.decryptColumn(periodRow.id,'info',periodRow.info);
  assert.equal(periodInfo.period,'afternoon');assert.equal(periodInfo.time || '','');
  assert.equal('period' in periodRow,false);
});

test('calendar rejects cross-owner links and preserves valid encrypted linking metadata',async()=>{
  const db=linkedDatabase({clients:[{id:clientId,owner_id:ownerId}],activity_days:[]});
  const load=await runtime(db), {saveActivityWeekAction}=await load('app/(app)/activity/actions.ts');
  assert.equal((await saveActivityWeekAction(day,[{day,appts:{breakfast:'傾方案',breakfast_client_id:clientId,breakfast_time:'08:45'}}])).ok,true);
  const secure=await load('lib/secure.ts'),info=secure.decryptColumn(`${ownerId}:${day}`,'appts',db.tables.activity_days[0].appts);
  assert.equal(info.breakfast_client_id,clientId);assert.equal(info.breakfast_time,'08:45');
  db.tables.clients[0].owner_id='another-agent';
  assert.equal((await saveActivityWeekAction(day,[{day,appts:{breakfast_client_id:clientId}}])).ok,false);
  assert.equal(db.writes.length,1);
});

test('task result edits preserve original plan and link and do not advance client stage',async()=>{
  const db=linkedDatabase({daily_tasks:[{id:taskId,owner_id:ownerId,updated_at:'2026-11-02T00:00:00Z',status:'planned',info:{}}],clients:[{id:clientId,owner_id:ownerId,stage:'RR'}]});
  const load=await runtime(db),secure=await load('lib/secure.ts');
  db.tables.daily_tasks[0].info=secure.encryptColumn(taskId,'info',{}, {name:'客戶',plan:'原定安排',client_id:clientId,time:'09:00'});
  const {updateTask}=await load('app/(app)/today/actions.ts');
  assert.equal((await updateTask({id:taskId,updated_at:'2026-11-02T00:00:00Z',status:'done',result:'已完成見面'})).error,'');
  const info=secure.decryptColumn(taskId,'info',db.tables.daily_tasks[0].info);
  assert.equal(info.plan,'原定安排');assert.equal(info.client_id,clientId);assert.equal(info.result,'已完成見面');
  assert.equal(db.tables.clients[0].stage,'RR');
  assert.notEqual((await updateTask({id:taskId,updated_at:'stale-version',status:'done',result:'覆蓋'})).error,'');
});

test('contact history is encrypted, preserves client information, and uses optimistic locking',async()=>{
  let conflict=false;
  const db=linkedDatabase({clients:[{id:clientId,owner_id:ownerId,updated_at:'v1',info:{}}]},(table,tables)=>{if(conflict&&table==='clients')tables.clients[0].updated_at='changed';});
  const load=await runtime(db),secure=await load('lib/secure.ts');
  db.tables.clients[0].info=secure.encryptColumn(clientId,'info',{}, {name:'客戶',occupation:'工程師'});
  const {addContactEventAction}=await load('app/(app)/clients/actions.ts');
  assert.equal((await addContactEventAction(clientId,'傾過退休目標','contact',day)).ok,true);
  const info=secure.decryptColumn(clientId,'info',db.tables.clients[0].info);
  assert.equal(info.name,'客戶');assert.equal(info.occupation,'工程師');assert.equal(info.last_contact_at,day);
  assert.equal(JSON.parse(info.contact_history)[0].text,'傾過退休目標');
  assert.ok(!JSON.stringify(db.tables.clients[0].info).includes('退休目標'));
  conflict=true;
  assert.equal((await addContactEventAction(clientId,'另一個視窗','note',day)).ok,false);
  assert.equal(db.writes.length,1);
});

test('moving either board keeps the three follow-up phases in sync',async()=>{
  const db=linkedDatabase({clients:[{id:clientId,owner_id:ownerId,stage:'RR'}]});
  const load=await runtime(db),actions=await load('app/(app)/clients/actions.ts');
  assert.equal((await actions.moveSeasonAction(clientId,'SUMMER')).ok,true);
  assert.equal(db.tables.clients[0].stage,'PC');
  assert.equal((await actions.moveStageAction(clientId,'FOLLOWUP')).ok,true);
  assert.equal(db.tables.clients[0].season,'AUTUMN');
  await actions.moveStageAction(clientId,'SIGNED');
  await actions.moveSeasonAction(clientId,'SPRING');
  assert.equal(db.tables.clients[0].stage,'SIGNED');
});

test('a linked calendar appointment is a real next step even without a separate task',async()=>{
  const f=await (await runtime())('lib/followups.ts');
  const appointments=[{day:'2026-11-03',time:'08:45',client_id:clientId,text:'早餐講方案',label:'早餐',slot:'breakfast'}];
  assert.equal(f.nextClientStep([],appointments,clientId,day).plan,'早餐講方案');
  assert.equal(f.nextClientStep([],appointments,clientId,'2026-11-04'),null);
  const overdue=[{client_id:clientId,day:'2026-11-01',status:'planned',plan:'未完成電話'}];
  assert.equal(f.nextClientStep(overdue,appointments,clientId,day).plan,'未完成電話');
});

test('malformed existing history is not overwritten by a new note',async()=>{
  const db=linkedDatabase({clients:[{id:clientId,owner_id:ownerId,updated_at:'v1',info:{}}]});
  const load=await runtime(db),secure=await load('lib/secure.ts');
  db.tables.clients[0].info=secure.encryptColumn(clientId,'info',{}, {name:'客戶',contact_history:'damaged-json'});
  const {addContactEventAction}=await load('app/(app)/clients/actions.ts');
  assert.equal((await addContactEventAction(clientId,'新備註','note',day)).ok,false);
  assert.equal(db.writes.length,0);
});

test('all write paths reject conflicting phase updates and never silently unsign a client',async()=>{
  const {pipelinePatch}=await (await runtime())('lib/seasons.ts');
  assert.deepEqual(plain(pipelinePatch({stage:'FNA'})),{stage:'NR2',season:'AUTUMN'});
  assert.deepEqual(plain(pipelinePatch({stage:'FNA',season:'AUTUMN'})),{stage:'NR2',season:'AUTUMN'});
  assert.throws(()=>pipelinePatch({stage:'FNA',season:'SUMMER'}));
  assert.throws(()=>pipelinePatch({season:'SPRING'},'SIGNED'));
  assert.deepEqual(plain(pipelinePatch({stage:'NR2',season:'AUTUMN'},'SIGNED')),{stage:'NR2',season:'AUTUMN'});
});

test('WhatsApp prepared tasks preserve optional linking and reject cross-owner clients',async()=>{
  const db=linkedDatabase({clients:[{id:clientId,owner_id:ownerId,info:{}}]});
  const load=await runtime(db),secure=await load('lib/secure.ts');
  db.tables.clients[0].info=secure.encryptColumn(clientId,'info',{}, {name:'客戶'});
  const {prepareTasks}=await load('lib/whatsapp/tasks.ts');
  const input={operation:'create',day,category:'appointment',stage:'needs',name:'客戶',plan:'見面',status:'planned',result:'',client_id:clientId,time:'09:30'};
  const prepared=await prepareTasks(db,ownerId,[input]);
  const info=secure.decryptColumn(prepared[0].id,'info',prepared[0].info);
  assert.equal(info.client_id,clientId);assert.equal(info.time,'09:30');
  db.tables.clients[0].owner_id='someone-else';
  await assert.rejects(()=>prepareTasks(db,ownerId,[input]));
});
