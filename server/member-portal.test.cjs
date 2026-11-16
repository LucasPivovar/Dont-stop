const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
const {createGymServer}=require('./gym.cjs');
let app,base,staff,member,other,workout;
async function req(path,method='GET',body,cookie){const r=await fetch(base+path,{method,headers:{Origin:base,...(body?{'Content-Type':'application/json'}:{}),...(cookie?{Cookie:cookie}:{})},body:body?JSON.stringify(body):undefined});const raw=await r.text();return {status:r.status,body:r.headers.get('content-type')?.includes('application/json')?JSON.parse(raw):raw,cookie:r.headers.get('set-cookie')?.split(';')[0],setCookie:r.headers.get('set-cookie')};}
before(async()=>{app=await createGymServer({demo:true,databasePath:':memory:',today:'2026-11-16'});await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));base='http://127.0.0.1:'+app.server.address().port;staff=(await req('/api/auth/login','POST',{email:'demo@dontstop.local',password:'Demonstracao!2026'})).cookie;});
after(async()=>app.close());
test('member portal and staff sessions are independent and protected',async()=>{
  assert.equal((await req('/api/member/state')).status,401);assert.equal((await req('/api/member/state','GET',null,staff)).status,401);
  assert.equal((await req('/api/member/login','POST',{email:'aluno1@dontstop.local',password:'errada'})).status,401);
  const login=await req('/api/member/login','POST',{email:'aluno1@dontstop.local',password:'Mensalista!2026'});member=login.cookie;assert.equal(login.status,200);assert.ok(login.setCookie.includes('HttpOnly'));assert.ok(login.setCookie.includes('SameSite=Strict'));
  other=(await req('/api/member/login','POST',{email:'aluno2@dontstop.local',password:'Mensalista!2026'})).cookie;
  assert.equal((await req('/api/state','GET',null,member)).status,401);
  assert.equal((await req('/api/members/2/portal','GET',null,member)).status,401);
});
test('member receives only their own financial and training information',async()=>{
  const data=(await req('/api/member/state','GET',null,member)).body;assert.equal(data.member.id,1);assert.equal(data.subscription.member_id,1);
  for(const w of data.workouts)assert.equal(w.member_id,1);
  const owned=app.db.prepare('SELECT id FROM invoices WHERE member_id=1').all().map(x=>x.id);assert.ok(data.invoices.every(i=>owned.includes(i.id)));
  assert.equal(data.users,undefined);assert.equal(data.member.notes,undefined);assert.equal(JSON.stringify(data).includes('password_hash'),false);assert.equal(data.benefits.telemedicine.enabled,true);assert.equal(data.benefits.telemedicine.url,null);
  workout=data.workouts.find(w=>w.weekday===1);
});
test('training completion enforces ownership, scheduled day and idempotency',async()=>{
  const foreign=app.db.prepare('SELECT id FROM member_workouts WHERE member_id=2 AND weekday=1').get();assert.equal((await req(`/api/member/workouts/${foreign.id}/complete`,'POST',{},member)).status,404);
  const future=app.db.prepare('SELECT id FROM member_workouts WHERE member_id=1 AND weekday=2').get();assert.equal((await req(`/api/member/workouts/${future.id}/complete`,'POST',{},member)).status,422);
  for(let i=0;i<2;i++)assert.equal((await req(`/api/member/workouts/${workout.id}/complete`,'POST',{},member)).status,200);
  assert.equal(app.db.prepare('SELECT COUNT(*) n FROM member_workout_logs WHERE member_id=1').get().n,1);
});
test('staff can assign exercises and control benefits for an individual member',async()=>{
  assert.equal((await req('/api/members/1/workouts/1','POST',{title:'Treino atualizado',instructor:'Professor de teste',notes:'Ajuste individual',exercises:[{name:'Exercício de teste',sets:'3',reps:'12',load:'Carga definida',rest:'60 s'}]},staff)).status,200);
  const result=(await req('/api/member/state','GET',null,member)).body;assert.equal(result.workouts.find(w=>w.weekday===1).title,'Treino atualizado');assert.equal(result.workouts.find(w=>w.weekday===1).exercises[0].name,'Exercício de teste');
  assert.equal((await req('/api/members/1/portal','POST',{email:'aluno1@dontstop.local',telemedicine:false,discounts:true},staff)).status,200);
  const updated=(await req('/api/member/state','GET',null,member)).body;assert.equal(updated.benefits.telemedicine.enabled,false);assert.equal(updated.benefits.discounts.enabled,true);
});
test('staff can provision, reset and disable a member access',async()=>{
  const m=await req('/api/members','POST',{name:'Novo mensalista'},staff);const id=m.body.id;
  assert.equal((await req(`/api/members/${id}/portal`,'POST',{email:'novo@example.com'},staff)).status,422);
  assert.equal((await req(`/api/members/${id}/portal`,'POST',{email:'novo@example.com',password:'AcessoDoAluno!2026',enabled:true},staff)).status,200);
  const login=await req('/api/member/login','POST',{email:'novo@example.com',password:'AcessoDoAluno!2026'});assert.equal(login.status,200);
  assert.equal((await req(`/api/members/${id}/portal`,'POST',{email:'novo@example.com',password:'NovoAcessoAluno!2026',enabled:true},staff)).status,200);
  assert.equal((await req('/api/member/state','GET',null,login.cookie)).status,401);
  assert.equal((await req('/api/member/login','POST',{email:'novo@example.com',password:'AcessoDoAluno!2026'})).status,401);
  assert.equal((await req(`/api/members/${id}/portal`,'POST',{email:'novo@example.com',enabled:false},staff)).status,200);
  assert.equal((await req('/api/member/login','POST',{email:'novo@example.com',password:'NovoAcessoAluno!2026'})).status,401);
});
test('profile validates before updating password and revokes other member sessions',async()=>{
  const second=(await req('/api/member/login','POST',{email:'aluno1@dontstop.local',password:'Mensalista!2026'})).cookie;
  assert.equal((await req('/api/member/profile','PATCH',{phone:'inválido',current_password:'Mensalista!2026',password:'SenhaAtualizada!2026'},member)).status,422);
  assert.equal((await req('/api/member/login','POST',{email:'aluno1@dontstop.local',password:'Mensalista!2026'})).status,200);
  assert.equal((await req('/api/member/profile','PATCH',{name:'Nome atualizado',phone:'41999990000',current_password:'Mensalista!2026',password:'SenhaAtualizada!2026'},member)).status,200);
  assert.equal((await req('/api/member/state','GET',null,second)).status,401);assert.equal((await req('/api/member/state','GET',null,member)).body.member.name,'Nome atualizado');
});
test('inactive members lose access and cannot log in',async()=>{
  assert.equal((await req('/api/members/2','PATCH',{status:'inactive'},staff)).status,200);assert.equal((await req('/api/member/state','GET',null,other)).status,401);assert.equal((await req('/api/member/login','POST',{email:'aluno2@dontstop.local',password:'Mensalista!2026'})).status,401);
});
test('member pages and assets are available with canonical absolute references',async()=>{
  for(const path of ['/mensalista','/mensalista/','/mensalista/app.js','/mensalista/styles.css','/sistema/member-tools.js','/assets/member-icons.svg'])assert.equal((await req(path)).status,200,path);
  assert.equal((await req('/api/member/logout','POST',{},member)).status,200);assert.equal((await req('/api/member/state','GET',null,member)).status,401);
});
