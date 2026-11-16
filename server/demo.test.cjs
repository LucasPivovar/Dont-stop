const {test,before}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const {build}=require('../scripts/build-vercel-demo.cjs');
const {createDemoApi}=require('../demo/api.js');
let fixture;
before(async()=>{await build();fixture=JSON.parse(await fs.readFile(path.join(__dirname,'../dist-demo/demo/fixture.json'),'utf8'));});
function demo(){const values=new Map();const storage={getItem:k=>values.get(k),setItem:(k,v)=>values.set(k,v)};const clock=()=>new Date('2026-11-20T15:00:00Z');return {api:createDemoApi(fixture,storage,clock),storage,clock};}
test('static build exposes only public files and starts with fictional records',async()=>{
  const {api}=demo(),result=await api.handle('/api/state');assert.equal(result.status,200);assert.equal(result.body.today,'2026-11-20');assert.equal(result.body.members.length,8);assert.equal(result.body.appointments.length,16);assert.equal(result.body.demo,true);
  assert.equal(JSON.stringify(fixture).includes('password_hash'),false);
  const system=await fs.readFile(path.join(__dirname,'../dist-demo/sistema/index.html'),'utf8');assert.ok(system.indexOf('/demo/api.js')<system.indexOf('/sistema/calendar.js'));
  for(const file of ['server/gym.cjs','.data/gym.sqlite','.env','.git/config'])await assert.rejects(fs.access(path.join(__dirname,'../dist-demo',file)));
});
test('system assets resolve identically with and without the final slash',async()=>{
  const system=await fs.readFile(path.join(__dirname,'../dist-demo/sistema/index.html'),'utf8');
  const assets=[...system.matchAll(/(?:src|href)="([^\"]+\.(?:js|css))"/g)].map(match=>match[1]).filter(value=>!value.startsWith('https:'));
  assert.ok(assets.includes('/demo/api.js'));
  assert.ok(assets.includes('/sistema/app.js'));
  for(const asset of assets){
    assert.equal(new URL(asset,'https://example.com/sistema').pathname,new URL(asset,'https://example.com/sistema/').pathname);
    await fs.access(path.join(__dirname,'../dist-demo',asset));
  }
});
test('static demo persists members, plans and subscriptions across reloads',async()=>{
  const {api,storage,clock}=demo();const member=await api.handle('/api/members','POST',{name:'Pessoa fictícia',phone:'41999990000',joined_on:'2026-11-20'});assert.equal(member.status,201);
  const plan=await api.handle('/api/plans','POST',{name:'Plano de teste',amount_cents:9900,enabled:true});assert.equal(plan.status,201);
  const sub=await api.handle('/api/subscriptions','POST',{member_id:member.body.id,plan_id:plan.body.id,start_date:'2026-11-20',due_date:'2026-11-20'});assert.equal(sub.status,201);
  assert.equal((await api.handle('/api/subscriptions','POST',{member_id:member.body.id,plan_id:plan.body.id})).status,409);
  const reloaded=createDemoApi(fixture,storage,clock),state=(await reloaded.handle('/api/state')).body;assert.equal(state.members.length,9);assert.ok(state.invoices.some(i=>i.subscription_id===sub.body.id&&i.amount_cents===9900));
});
test('static payment and renewal use the contracted price and reject duplicate payment',async()=>{
  const {api}=demo();let data=(await api.handle('/api/state')).body;const invoice=data.invoices.find(i=>i.status==='pending');
  assert.equal((await api.handle(`/api/subscriptions/${invoice.subscription_id}/renew`,'POST',{})).status,409);
  assert.equal((await api.handle(`/api/invoices/${invoice.id}/pay`,'POST',{method:'pix',paid_on:'2026-11-20'})).status,200);
  assert.equal((await api.handle(`/api/invoices/${invoice.id}/pay`,'POST',{method:'pix'})).status,409);
  const sub=data.subscriptions.find(s=>s.id===invoice.subscription_id);await api.handle(`/api/plans/${sub.plan_id}`,'PATCH',{amount_cents:99999});
  assert.equal((await api.handle(`/api/subscriptions/${sub.id}/renew`,'POST',{})).status,201);
  data=(await api.handle('/api/state')).body;assert.ok(data.invoices.some(i=>i.subscription_id===sub.id&&i.status==='pending'&&i.amount_cents===sub.amount_cents));
});
test('static appointments support visitors, conflicts, rescheduling, completion and cancellation',async()=>{
  const {api}=demo(),body={contact_name:'Visitante fictício',starts_at:'2026-11-25T22:00',duration_minutes:45,instructor:'Responsável de teste',kind:'Treino experimental'};
  const created=await api.handle('/api/appointments','POST',body);assert.equal(created.status,201);
  assert.equal((await api.handle('/api/appointments','POST',{...body,instructor:'responsável de teste'})).status,409);
  assert.equal((await api.handle(`/api/appointments/${created.body.id}`,'PATCH',{starts_at:'2026-11-26T22:00'})).status,200);
  assert.equal((await api.handle(`/api/appointments/${created.body.id}`,'PATCH',{status:'completed'})).status,200);
  assert.equal((await api.handle('/api/appointments','POST',body)).status,201);
  assert.equal((await api.handle(`/api/appointments/${created.body.id}`,'PATCH',{status:'canceled'})).status,200);
});
test('static team accounts, role limits, logout and account updates work',async()=>{
  const {api}=demo();const created=await api.handle('/api/users','POST',{name:'Equipe fictícia',email:'teste@example.com',password:'AcessoFicticio!2026',role:'staff'});assert.equal(created.status,201);
  await api.handle('/api/auth/logout','POST',{});assert.equal((await api.handle('/api/state')).status,401);
  assert.equal((await api.handle('/api/auth/login','POST',{email:'teste@example.com',password:'incorreta'})).status,401);
  assert.equal((await api.handle('/api/auth/login','POST',{email:'teste@example.com',password:'AcessoFicticio!2026'})).status,200);
  assert.deepEqual((await api.handle('/api/state')).body.users,[]);
  assert.equal((await api.handle('/api/users','POST',{name:'Outro'})).status,403);
  assert.equal((await api.handle('/api/auth/account','PATCH',{name:'Equipe atualizada'})).status,200);
  assert.equal((await api.handle('/api/auth/status')).body.user.name,'Equipe atualizada');
});
test('static reset restores fixtures and failed storage does not change data',async()=>{
  const {api,storage}=demo();await api.handle('/api/members','POST',{name:'Cadastro temporário'});api.reset();assert.equal((await api.handle('/api/state')).body.members.length,8);
  storage.setItem=()=>{throw Error('QuotaExceededError');};assert.equal((await api.handle('/api/members','POST',{name:'Não deve salvar'})).status,507);assert.equal((await api.handle('/api/state')).body.members.length,8);
});
