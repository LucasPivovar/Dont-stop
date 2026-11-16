const {test,before}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const {build}=require('../scripts/build-vercel-demo.cjs');
const {createDemoApi}=require('../demo/api.js');
let fixture;
before(async()=>{await build();fixture=JSON.parse(await fs.readFile(path.join(__dirname,'../dist-demo/demo/fixture.json'),'utf8'));});
function demo(){const values=new Map();const storage={getItem:k=>values.get(k),setItem:(k,v)=>values.set(k,v)};const clock=()=>new Date('2026-11-20T15:00:00Z');return {api:createDemoApi(fixture,storage,clock),storage,clock};}

test('all portals load demo dependencies in order before their entry point',async()=>{
  for(const page of ['sistema','mensalista','professor']){
    const html=await fs.readFile(path.join(__dirname,'../dist-demo',page,'index.html'),'utf8');
    const scripts=['/demo/store-api.js','/demo/professor-api.js','/demo/member-api.js','/demo/api.js','/'+page+'/'+(page==='sistema'?'calendar.js':'app.js')];
    let previous=-1;for(const script of scripts){const at=html.indexOf('src="'+script+'"');assert.ok(at>previous,`${page}: ${script}`);previous=at;}
  }
});

test('static shop reserves stock once, invoices separately and cancels without a charge',async()=>{
  const {api,storage,clock}=demo();await api.handle('/api/member/login','POST',{email:'aluno1@dontstop.local',password:'Mensalista!2026'});
  const catalog=(await api.handle('/api/member/store')).body,p=catalog.products[0],v=p.variants[0];
  const order={items:[{variant_id:v.id,quantity:1}],expected_total_cents:p.price_cents,payment_option:'monthly',request_key:'static-order-0000001'};
  assert.equal((await api.handle('/api/member/store/orders','POST',order)).status,422);
  order.monthly_authorized=true;const a=await api.handle('/api/member/store/orders','POST',order);assert.equal(a.status,201);assert.equal((await api.handle('/api/member/store/orders','POST',order)).body.id,a.body.id);
  let state=(await api.handle('/api/member/store')).body;assert.equal(state.products.find(x=>x.id===p.id).variants[0].stock,v.stock-1);assert.equal(state.orders[0].payment_status,'invoiced');
  const reload=createDemoApi(fixture,storage,clock);assert.equal((await reload.handle('/api/member/store')).body.orders.length,1);
  await api.handle('/api/member/logout','POST',{});await api.handle('/api/member/login','POST',{email:'aluno2@dontstop.local',password:'Mensalista!2026'});assert.equal((await api.handle('/api/member/store')).body.orders.length,0);assert.equal((await api.handle(`/api/member/store/orders/${a.body.id}/cancel`,'POST',{})).status,404);
  await api.handle('/api/member/login','POST',{email:'aluno1@dontstop.local',password:'Mensalista!2026'});assert.equal((await api.handle(`/api/member/store/orders/${a.body.id}/cancel`,'POST',{})).status,200);await api.handle(`/api/member/store/orders/${a.body.id}/cancel`,'POST',{});
  state=(await api.handle('/api/member/store')).body;assert.equal(state.products.find(x=>x.id===p.id).variants[0].stock,v.stock);assert.equal(state.orders[0].status,'canceled');
});
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
test('member portal uses canonical public assets and receives demo adapter before app',async()=>{
  const html=await fs.readFile(path.join(__dirname,'../dist-demo/mensalista/index.html'),'utf8');
  assert.ok(html.indexOf('/demo/member-api.js')<html.indexOf('/demo/api.js'));assert.ok(html.indexOf('/demo/api.js')<html.indexOf('/mensalista/app.js'));
  const assets=[...html.matchAll(/(?:src|href)="([^\"]+\.(?:js|css))"/g)].map(match=>match[1]).filter(x=>!x.startsWith('https:'));
  for(const asset of assets){assert.equal(new URL(asset,'https://example.com/mensalista').pathname,new URL(asset,'https://example.com/mensalista/').pathname);await fs.access(path.join(__dirname,'../dist-demo',asset));}
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
test('static member portal isolates each member and remembers completed workouts',async()=>{
  const {api,storage,clock}=demo();assert.equal((await api.handle('/api/member/state')).status,401);
  const login=await api.handle('/api/member/login','POST',{email:'aluno2@dontstop.local',password:'Mensalista!2026'});assert.equal(login.status,200);
  let state=(await api.handle('/api/member/state')).body;assert.equal(state.member.id,2);assert.equal(state.users,undefined);assert.ok(state.workouts.every(w=>w.member_id===2));assert.ok(state.invoices.every(i=>i.member_id===2));assert.equal(state.benefits.telemedicine.enabled,true);
  const own=state.workouts.find(w=>w.weekday===5),foreign=fixture.member_workouts.find(w=>w.member_id===1&&w.weekday===5);
  assert.equal((await api.handle(`/api/member/workouts/${foreign.id}/complete`,'POST',{})).status,404);
  for(let i=0;i<2;i++)assert.equal((await api.handle(`/api/member/workouts/${own.id}/complete`,'POST',{})).status,200);
  state=(await createDemoApi(fixture,storage,clock).handle('/api/member/state')).body;assert.equal(state.logs.length,1);
  assert.equal((await api.handle('/api/state')).body.user.role,'admin');
});
test('static staff edits member access and workouts used in the member portal',async()=>{
  const {api}=demo();const member=await api.handle('/api/members','POST',{name:'Mensalista do portal'}),id=member.body.id;
  assert.equal((await api.handle(`/api/members/${id}/portal`,'POST',{email:'portal@example.com',password:'PortalDoAluno!2026',enabled:true,telemedicine:true})).status,200);
  assert.equal((await api.handle(`/api/members/${id}/workouts/5`,'POST',{title:'Treino individual',instructor:'Professor',exercises:[{name:'Exercício individual',sets:'3',reps:'12'}]})).status,200);
  assert.equal((await api.handle('/api/member/login','POST',{email:'portal@example.com',password:'PortalDoAluno!2026'})).status,200);
  const state=(await api.handle('/api/member/state')).body;assert.equal(state.workouts[0].title,'Treino individual');assert.equal(state.benefits.telemedicine.enabled,false);
  await api.handle(`/api/members/${id}/portal`,'POST',{email:'portal@example.com',enabled:false});assert.equal((await api.handle('/api/member/state')).status,401);
});
test('static professors see assigned students and publish workouts to the member portal',async()=>{
  const {api}=demo();const options=(await api.handle('/api/professor/status')).body.candidates,teacher=options.find(p=>p.email==='professora1@dontstop.local');
  assert.equal((await api.handle('/api/professor/login','POST',{email:teacher.email,password:'Professor!2026'})).status,200);
  const state=(await api.handle('/api/professor/state')).body;assert.equal(state.members.length,4);assert.equal(state.invoices,undefined);const member=state.members[0],foreign=fixture.members.find(m=>!state.members.some(x=>x.id===m.id));
  assert.equal((await api.handle(`/api/professor/members/${foreign.id}`)).status,404);
  assert.equal((await api.handle(`/api/professor/members/${member.id}/workouts/5`,'POST',{title:'Treino individual do professor',instructor:'Não usar',exercises:[{name:'Exercício de teste',sets:'3',reps:'12'}]})).status,200);
  await api.handle('/api/member/login','POST',{email:`aluno${member.id}@dontstop.local`,password:'Mensalista!2026'});const portal=(await api.handle('/api/member/state')).body;assert.equal(portal.professor.id,teacher.id);assert.equal(portal.workouts.find(w=>w.weekday===5).instructor,teacher.name);
  const other=options.find(p=>p.id!==teacher.id);await api.handle(`/api/members/${member.id}/professor`,'POST',{professor_id:other.id});assert.equal((await api.handle(`/api/professor/members/${member.id}`)).status,404);
});
test('static management creates professional accounts and controls each benefit separately',async()=>{
  const {api}=demo();const created=await api.handle('/api/professionals','POST',{name:'Profissional Teste',email:'novo.professor@example.com',password:'ProfessorNovo!2026',specialty:'Musculação'});assert.equal(created.status,201);
  const memberId=fixture.members[0].id;assert.equal((await api.handle(`/api/members/${memberId}/portal`,'POST',{email:`aluno${memberId}@dontstop.local`,professor_id:created.body.id,telemedicine:false,discounts:true})).status,200);
  const access=(await api.handle(`/api/members/${memberId}/portal`)).body;assert.equal(access.professor_id,created.body.id);assert.equal(access.benefits.telemedicine,0);assert.equal(access.benefits.discounts,1);
  assert.equal((await api.handle('/api/professor/login','POST',{email:'novo.professor@example.com',password:'ProfessorNovo!2026'})).status,200);assert.equal((await api.handle('/api/professor/state')).body.members.length,1);
  assert.equal((await api.handle('/api/auth/login','POST',{email:'novo.professor@example.com',password:'ProfessorNovo!2026'})).status,403);
  await api.handle(`/api/professionals/${created.body.id}`,'PATCH',{enabled:false});assert.equal((await api.handle('/api/professor/state')).status,401);
});
test('static professional portal includes its demo adapter before the application',async()=>{
  const html=await fs.readFile(path.join(__dirname,'../dist-demo/professor/index.html'),'utf8');assert.ok(html.indexOf('/demo/professor-api.js')<html.indexOf('/demo/api.js'));assert.ok(html.indexOf('/demo/api.js')<html.indexOf('/professor/app.js'));
  for(const asset of [...html.matchAll(/(?:href|src)="(\/(?:professor|sistema|demo)\/[^\"]+\.(?:css|js))"/g)].map(x=>x[1])){await fs.access(path.join(__dirname,'../dist-demo',asset));assert.equal(new URL(asset,'https://example.com/professor').pathname,new URL(asset,'https://example.com/professor/').pathname);}
});
