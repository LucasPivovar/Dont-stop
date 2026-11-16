const {test,before,after} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const {createGymServer,monthAfter} = require('./gym.cjs');
const {createBackup} = require('./backup.cjs');
let app, base, cookie='', memberId, subscriptionId, invoiceId, directory;
async function request(route,method='GET',body,settings={}) {
  const response=await fetch(base+route,{method,headers:{...(body?{'Content-Type':'application/json'}:{}),...(method!=='GET'&&!settings.noOrigin?{Origin:settings.origin || base}:{}),...(settings.cookie===false?{}:{Cookie:settings.cookie || cookie})},body:body?JSON.stringify(body):undefined});
  const contentType=response.headers.get('content-type') || '';
  const result=contentType.includes('application/json')?await response.json():await response.text();
  return {status:response.status,body:result,cookie:response.headers.get('set-cookie')?.split(';')[0],setCookie:response.headers.get('set-cookie')};
}
before(async()=>{
  directory=await fs.mkdtemp(path.join(os.tmpdir(),'dont-stop-test-'));
  app=await createGymServer({databasePath:path.join(directory,'gym.sqlite'),today:'2026-11-14'});
  await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
  base=`http://127.0.0.1:${app.server.address().port}`;
});
after(async()=>{
  await app.close();
  const reopened=await createGymServer({databasePath:path.join(directory,'gym.sqlite'),today:'2026-11-14'});
  assert.ok(reopened.db.prepare('SELECT COUNT(*) n FROM members').get().n>=2);
  reopened.db.close();
});
test('protected data and server source are inaccessible before login',async()=>{
  assert.equal((await request('/api/state')).status,401);
  assert.equal((await request('/server/gym.cjs')).status,404);
  assert.equal((await request('/.data/gym.sqlite')).status,404);
  assert.equal((await request('/assets/%2e%2e%2fserver/gym.cjs')).status,403);
  assert.equal((await request('/assets/%2e%2e%2f.data/gym.sqlite')).status,403);
  assert.ok([403,404].includes((await request('/assets/%2e%2e%5cserver/gym.cjs')).status));
  assert.equal((await request('/api/auth/status')).body.setupRequired,true);
});
test('first administrator, secure session cookie, and setup lock',async()=>{
  const setup=await request('/api/auth/setup','POST',{name:'Administrador Teste',email:'admin@example.com',password:'SenhaDeTeste!2026'});
  assert.equal(setup.status,200); assert.ok(setup.cookie); cookie=setup.cookie;
  assert.ok(setup.setCookie.includes('HttpOnly'));assert.ok(setup.setCookie.includes('SameSite=Strict'));
  assert.equal((await request('/api/auth/setup','POST',{name:'Outro',email:'outro@example.com',password:'SenhaDeTeste!2026'})).status,409);
  assert.equal((await request('/api/auth/login','POST',{email:'admin@example.com',password:'incorreta'})).status,401);
  assert.equal((await request('/api/state')).status,200);
});
test('write requests require an accepted same-site origin',async()=>{
  assert.equal((await request('/api/members','POST',{name:'Bloqueado'},{noOrigin:true})).status,403);
  assert.equal((await request('/api/members','POST',{name:'Bloqueado'},{origin:'https://outside.example'})).status,403);
});
test('member validation and persistent record creation',async()=>{
  assert.equal((await request('/api/members','POST',{name:'Teste',phone:'abc'})).status,422);
  assert.equal((await request('/api/members','POST',{name:'Teste',phone:'123'})).status,422);
  const created=await request('/api/members','POST',{name:'Pessoa de Teste',phone:'41999990000',email:'pessoa@example.com',joined_on:'2026-01-31'});
  assert.equal(created.status,201); memberId=created.body.id;
  assert.equal((await request(`/api/members/${memberId}`,'PATCH',{name:'Pessoa atualizada'})).status,200);
  assert.equal((await request('/api/members','POST',{name:'Data inválida',joined_on:'2026-02-30'})).status,422);
});
test('subscriptions produce exactly one first charge and cap month ends',async()=>{
  assert.equal(monthAfter('2026-01-31'), '2026-02-28');
  assert.equal(monthAfter('2028-01-31'), '2028-02-29');
  assert.equal(monthAfter('2026-02-28',31), '2026-03-31');
  const created=await request('/api/subscriptions','POST',{member_id:memberId,plan_id:1,start_date:'2026-01-31',due_date:'2026-01-31'});
  assert.equal(created.status,201); subscriptionId=created.body.id;
  const state=(await request('/api/state')).body;
  const subscription=state.subscriptions.find(s=>s.id===subscriptionId);
  assert.equal(subscription.end_date,'2026-02-28');
  const invoices=state.invoices.filter(i=>i.subscription_id===subscriptionId);
  assert.equal(invoices.length,1); invoiceId=invoices[0].id;
  assert.equal(invoices[0].display_status,'overdue');
  assert.equal((await request('/api/subscriptions','POST',{member_id:memberId,plan_id:1,start_date:'2026-01-31'})).status,409);
});
test('payments are atomic and cannot be recorded twice',async()=>{
  assert.equal((await request(`/api/subscriptions/${subscriptionId}/renew`,'POST',{})).status,409);
  assert.equal((await request(`/api/invoices/${invoiceId}/pay`,'POST',{method:'pix',paid_on:'2026-11-15'})).status,422);
  const results=await Promise.all([request(`/api/invoices/${invoiceId}/pay`,'POST',{method:'pix',paid_on:'2026-01-31'}),request(`/api/invoices/${invoiceId}/pay`,'POST',{method:'pix',paid_on:'2026-01-31'})]);
  assert.deepEqual(results.map(x=>x.status).sort(),[200,409]);
  const state=(await request('/api/state')).body;
  assert.equal(state.payments.filter(p=>p.invoice_id===invoiceId).length,1);
  assert.equal(state.invoices.find(i=>i.id===invoiceId).status,'paid');
});
test('renewal preserves billing day and contracted price',async()=>{
  assert.equal((await request('/api/plans/1','PATCH',{amount_cents:12990})).status,200);
  const renewed=await request(`/api/subscriptions/${subscriptionId}/renew`,'POST',{});
  assert.equal(renewed.status,201);
  const state=(await request('/api/state')).body,invoice=state.invoices.find(i=>i.id===renewed.body.id);
  assert.equal(invoice.due_date,'2026-02-28'); assert.equal(invoice.amount_cents,11990);
  assert.equal(state.subscriptions.find(s=>s.id===subscriptionId).end_date,'2026-03-31');
  assert.equal((await request(`/api/subscriptions/${subscriptionId}/renew`,'POST',{})).status,409);
});
test('agenda prevents conflicts for the same responsible person',async()=>{
  const values={member_id:memberId,kind:'Avaliação física',instructor:'Equipe A',starts_at:'2026-11-15T09:00',duration_minutes:45};
  const first=await request('/api/appointments','POST',values); assert.equal(first.status,201);
  assert.equal((await request('/api/appointments','POST',{...values,starts_at:'2026-11-15T09:15'})).status,409);
  assert.equal((await request('/api/appointments','POST',{...values,instructor:'equipe a'})).status,409);
  assert.equal((await request('/api/appointments','POST',{...values,instructor:'Equipe B'})).status,409);
  assert.equal((await request('/api/appointments','POST',{...values,member_id:null,contact_name:'Visitante de teste',instructor:'Equipe B'})).status,201);
  assert.equal((await request(`/api/appointments/${first.body.id}`,'PATCH',{status:'canceled'})).status,200);
  assert.equal((await request('/api/appointments','POST',values)).status,201);
});
test('appointments support rescheduling, completion and visitors',async()=>{
  const created=await request('/api/appointments','POST',{contact_name:'Visitante fictício',kind:'Treino experimental',instructor:'Equipe C',starts_at:'2026-11-18T10:00',duration_minutes:30});
  assert.equal(created.status,201);
  assert.equal((await request(`/api/appointments/${created.body.id}`,'PATCH',{starts_at:'2026-11-20T14:00',duration_minutes:60})).status,200);
  let item=(await request('/api/state')).body.appointments.find(a=>a.id===created.body.id);
  assert.equal(item.starts_at,'2026-11-20T14:00');assert.equal(item.ends_at,'2026-11-20T15:00');
  assert.equal((await request(`/api/appointments/${created.body.id}`,'PATCH',{status:'completed'})).status,200);
  item=(await request('/api/state')).body.appointments.find(a=>a.id===created.body.id);assert.equal(item.status,'completed');
  assert.equal((await request('/api/appointments','POST',{kind:'Visita',starts_at:'2026-11-18T09:00'})).status,422);
  assert.equal((await request('/api/appointments','POST',{contact_name:'Visitante',kind:'Visita',starts_at:'2026-11-18T23:45',duration_minutes:45})).status,422);
  assert.equal((await request('/api/appointments','POST',{contact_name:'Visitante',kind:'Visita',starts_at:'2026-11-18T23:45',duration_minutes:15})).status,201);
});
test('subscription pause, resumption and cancellation preserve the charge history',async()=>{
  assert.equal((await request(`/api/subscriptions/${subscriptionId}`,'PATCH',{status:'paused'})).status,200);
  assert.equal((await request(`/api/subscriptions/${subscriptionId}/renew`,'POST',{})).status,409);
  assert.equal((await request(`/api/subscriptions/${subscriptionId}`,'PATCH',{status:'active'})).status,200);
  assert.equal((await request(`/api/subscriptions/${subscriptionId}`,'PATCH',{status:'canceled'})).status,200);
  assert.equal((await request(`/api/subscriptions/${subscriptionId}`,'PATCH',{status:'active'})).status,409);
  assert.equal((await request('/api/state')).body.invoices.filter(i=>i.subscription_id===subscriptionId).length,2);
});
test('manual invoices validate values and cancellation keeps the audit record',async()=>{
  assert.equal((await request('/api/invoices','POST',{member_id:memberId,description:'Teste',amount_cents:0,due_date:'2026-11-15'})).status,422);
  const created=await request('/api/invoices','POST',{member_id:memberId,description:'Cobrança avulsa',amount_cents:4500,due_date:'2026-11-15'});
  assert.equal(created.status,201);
  assert.equal((await request(`/api/invoices/${created.body.id}/cancel`,'POST',{})).status,200);
  assert.equal((await request(`/api/invoices/${created.body.id}/pay`,'POST',{method:'pix'})).status,409);
  assert.equal((await request('/api/state')).body.invoices.find(i=>i.id===created.body.id).status,'canceled');
});
test('staff can operate but cannot grant new accounts',async()=>{
  const created=await request('/api/users','POST',{name:'Equipe Teste',email:'staff@example.com',password:'SenhaDaEquipe!2026',role:'staff'});
  assert.equal(created.status,201);
  const logged=await request('/api/auth/login','POST',{email:'staff@example.com',password:'SenhaDaEquipe!2026'});
  const staff=logged.cookie; assert.ok(staff);
  const data=await request('/api/state','GET',undefined,{cookie:staff}); assert.deepEqual(data.body.users,[]);
  assert.equal(JSON.stringify(data.body).includes('password_hash'),false);
  assert.equal((await request('/api/users','POST',{name:'Intruso',email:'intruso@example.com',password:'SenhaDaEquipe!2026'},{cookie:staff})).status,403);
  assert.equal((await request('/api/auth/logout','POST',{}, {cookie:staff})).status,200);
  assert.equal((await request('/api/state','GET',undefined,{cookie:staff})).status,401);
  assert.equal((await request(`/api/users/${created.body.id}`,'PATCH',{enabled:false})).status,200);
  assert.equal((await request('/api/auth/login','POST',{email:'staff@example.com',password:'SenhaDaEquipe!2026'})).status,401);
  assert.equal((await request('/api/users/1','PATCH',{enabled:false})).status,409);
});
test('changing a password requires the old password and revokes other sessions',async()=>{
  const another=await request('/api/auth/login','POST',{email:'admin@example.com',password:'SenhaDeTeste!2026'});
  assert.ok(another.cookie);
  assert.equal((await request('/api/auth/account','PATCH',{password:'NovaSenhaDeTeste!2026',current_password:'incorreta'})).status,422);
  assert.equal((await request('/api/auth/account','PATCH',{name:'Administrador atualizado',password:'NovaSenhaDeTeste!2026',current_password:'SenhaDeTeste!2026'})).status,200);
  assert.equal((await request('/api/state','GET',undefined,{cookie:another.cookie})).status,401);
  assert.equal((await request('/api/auth/login','POST',{email:'admin@example.com',password:'SenhaDeTeste!2026'})).status,401);
  assert.equal((await request('/api/auth/login','POST',{email:'admin@example.com',password:'NovaSenhaDeTeste!2026'})).status,200);
});
test('CSV export neutralizes formula injection',async()=>{
  const name='=HYPERLINK("https://example.com")';
  assert.equal((await request('/api/members','POST',{name})).status,201);
  const csv=await request('/api/export/members.csv'); assert.equal(csv.status,200);
  assert.ok(csv.body.includes('"\'=HYPERLINK'));
});
test('backup preserves records while the live database uses WAL',async()=>{
  const output=await createBackup(path.join(directory,'gym.sqlite'));
  assert.ok(output.startsWith(path.join(directory,'backups')+path.sep));
  const {DatabaseSync}=require('node:sqlite');const restored=new DatabaseSync(output,{readOnly:true});
  assert.equal(restored.prepare('PRAGMA integrity_check').get().integrity_check,'ok');
  assert.equal(restored.prepare('SELECT COUNT(*) n FROM payments').get().n,app.db.prepare('SELECT COUNT(*) n FROM payments').get().n);
  restored.close();
});
test('management page loads all client scripts and assets',async()=>{
  const page=await request('/sistema/');assert.equal(page.status,200);
  assert.ok(page.body.indexOf('src="/sistema/calendar.js"')<page.body.indexOf('src="/sistema/app.js"'));
  for(const asset of ['/sistema/app.js','/sistema/calendar.js','/sistema/styles.css','/assets/management-icons.svg','/assets/logo-dontstop-400.png'])assert.equal((await request(asset)).status,200,asset);
});
test('demo and real environment have separate session cookies and records',async()=>{
  const demo=await createGymServer({demo:true,databasePath:':memory:',today:'2026-11-15'});
  await new Promise(resolve=>demo.server.listen(0,'127.0.0.1',resolve));
  const url=`http://127.0.0.1:${demo.server.address().port}`;
  try{
    const login=await fetch(url+'/api/auth/login',{method:'POST',headers:{Origin:url,'Content-Type':'application/json'},body:JSON.stringify({email:'demo@dontstop.local',password:'Demonstracao!2026'})});
    assert.equal(login.status,200);const token=login.headers.get('set-cookie').split(';')[0];assert.ok(token.startsWith('gym_demo_session='));
    const data=await (await fetch(url+'/api/state',{headers:{Cookie:token}})).json();
    assert.equal(data.demo,true);assert.ok(new Set(data.appointments.map(a=>a.starts_at.slice(0,10))).size>5);
    assert.equal((await request('/api/state','GET',undefined,{cookie:token})).status,401);
    assert.equal((await fetch(url+'/api/state',{headers:{Cookie:cookie}})).status,401);
  }finally{await demo.close();}
});
