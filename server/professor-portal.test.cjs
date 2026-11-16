const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
const {createGymServer}=require('./gym.cjs');
let app,base,staff,p1,p2,t1,t2,studentId,foreignId;
async function req(path,method='GET',data,cookie){const r=await fetch(base+path,{method,headers:{Origin:base,...(data?{'Content-Type':'application/json'}:{}),...(cookie?{Cookie:cookie}:{})},body:data?JSON.stringify(data):undefined});const text=await r.text();return {status:r.status,body:r.headers.get('content-type')?.includes('application/json')?JSON.parse(text):text,cookie:r.headers.get('set-cookie')?.split(';')[0],setCookie:r.headers.get('set-cookie')};}
before(async()=>{app=await createGymServer({demo:true,databasePath:':memory:',today:'2026-11-16'});await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));base='http://127.0.0.1:'+app.server.address().port;staff=(await req('/api/auth/login','POST',{email:'demo@dontstop.local',password:'Demonstracao!2026'})).cookie;const profiles=(await req('/api/professor/status')).body.candidates;t1=profiles.find(p=>p.email==='professora1@dontstop.local');t2=profiles.find(p=>p.id!==t1.id);});
after(async()=>app.close());
test('professors use independent authenticated sessions',async()=>{
  assert.equal((await req('/api/professor/state')).status,401);assert.equal((await req('/api/professor/state','GET',null,staff)).status,401);
  assert.equal((await req('/api/professor/login','POST',{email:t1.email,password:'errada'})).status,401);
  const login=await req('/api/professor/login','POST',{email:t1.email,password:'Professor!2026'});assert.equal(login.status,200);assert.ok(login.setCookie.includes('HttpOnly'));assert.ok(login.setCookie.includes('SameSite=Strict'));p1=login.cookie;
  p2=(await req('/api/professor/login','POST',{email:t2.email,password:'Professor!2026'})).cookie;
  const copied=p1.replace('dontstop_professor_demo=','gym_demo_session=');assert.equal((await req('/api/state','GET',null,copied)).status,401);
  assert.equal((await req('/api/auth/login','POST',{email:t1.email,password:'Professor!2026'})).status,403);
});
test('professors see only assigned students without financial data or benefits controls',async()=>{
  const own=(await req('/api/professor/state','GET',null,p1)).body,other=(await req('/api/professor/state','GET',null,p2)).body;assert.equal(own.members.length,4);assert.equal(other.members.length,4);assert.ok(own.members.every(m=>!other.members.some(x=>x.id===m.id)));studentId=own.members[0].id;foreignId=other.members[0].id;
  assert.equal(own.invoices,undefined);assert.equal(own.payments,undefined);assert.ok(own.members.every(m=>m.notes===undefined));assert.equal((await req(`/api/professor/members/${foreignId}`,'GET',null,p1)).status,404);
  for(const path of ['/api/state','/api/professionals',`/api/members/${studentId}/portal`])assert.equal((await req(path,'GET',null,p1)).status,401,path);
  assert.equal((await req(`/api/members/${studentId}/portal`,'POST',{telemedicine:true},p1)).status,401);
});
test('professor saves the assigned student workout and student sees its author',async()=>{
  const body={title:'Treino do professor',instructor:'Não pode falsificar autoria',notes:'Rotina individual',exercises:[{name:'Exercício de demonstração',sets:'3',reps:'12',load:'Definida pelo professor',rest:'60 s'}]};
  assert.equal((await req(`/api/professor/members/${foreignId}/workouts/1`,'POST',body,p1)).status,404);
  assert.equal((await req(`/api/professor/members/${studentId}/workouts/1`,'POST',body,p1)).status,200);
  const cookie=(await req('/api/member/login','POST',{email:`aluno${studentId}@dontstop.local`,password:'Mensalista!2026'})).cookie;
  const state=(await req('/api/member/state','GET',null,cookie)).body;assert.equal(state.professor.id,t1.id);assert.equal(state.professor.name,t1.name);assert.equal(state.workouts.find(w=>w.weekday===1).instructor,t1.name);assert.equal(state.workouts.find(w=>w.weekday===1).title,body.title);
  assert.equal((await req(`/api/members/${studentId}/professor`,'POST',{professor_id:t2.id},cookie)).status,401);
});
test('reassignment immediately removes access from former professor',async()=>{
  assert.equal((await req(`/api/members/${studentId}/professor`,'POST',{professor_id:999999},staff)).status,422);assert.equal((await req(`/api/professor/members/${studentId}`,'GET',null,p1)).status,200);
  assert.equal((await req(`/api/members/${studentId}/professor`,'POST',{professor_id:t2.id},staff)).status,200);assert.equal((await req(`/api/professor/members/${studentId}`,'GET',null,p1)).status,404);assert.equal((await req(`/api/professor/members/${studentId}`,'GET',null,p2)).status,200);
  assert.equal((await req(`/api/members/${studentId}/professor`,'POST',{professor_id:null},staff)).status,200);assert.equal((await req(`/api/professor/members/${studentId}`,'GET',null,p2)).status,404);
});
test('only admins provision professionals and resets or disable revoke sessions',async()=>{
  const team=await req('/api/users','POST',{name:'Recepção',email:'reception@example.com',password:'Recepcao!2026',role:'staff'},staff);assert.equal(team.status,201);const reception=(await req('/api/auth/login','POST',{email:'reception@example.com',password:'Recepcao!2026'})).cookie;
  const details={name:'Professor Novo',email:'prof.novo@example.com',password:'ProfessorNovo!2026',specialty:'Musculação'};assert.equal((await req('/api/professionals','POST',details,reception)).status,403);const created=await req('/api/professionals','POST',details,staff);assert.equal(created.status,201);
  const login=await req('/api/professor/login','POST',{email:details.email,password:details.password});assert.equal(login.status,200);assert.equal((await req(`/api/professionals/${created.body.id}`,'PATCH',{password:'SenhaDoProfessor!2026'},staff)).status,200);assert.equal((await req('/api/professor/state','GET',null,login.cookie)).status,401);
  assert.equal((await req(`/api/professionals/${created.body.id}`,'PATCH',{enabled:false},staff)).status,200);assert.equal((await req('/api/professor/login','POST',{email:details.email,password:'SenhaDoProfessor!2026'})).status,401);
});
test('member access editor assigns professor and enables benefits independently',async()=>{
  const result=await req(`/api/members/${studentId}/portal`,'POST',{email:`aluno${studentId}@dontstop.local`,professor_id:t1.id,telemedicine:true,discounts:false},staff);assert.equal(result.status,200);
  const portal=(await req(`/api/members/${studentId}/portal`,'GET',null,staff)).body;assert.equal(portal.professor_id,t1.id);assert.equal(portal.benefits.telemedicine,1);assert.equal(portal.benefits.discounts,0);assert.ok(portal.professionals.some(p=>p.id===t1.id));
});
test('professor changes own password without keeping other sessions alive',async()=>{
  const second=(await req('/api/professor/login','POST',{email:t1.email,password:'Professor!2026'})).cookie;
  assert.equal((await req('/api/professor/profile','PATCH',{name:'Não salvar',current_password:'errada',password:'NovaSenhaProfessor!2026'},p1)).status,422);
  assert.equal((await req('/api/professor/profile','PATCH',{name:'Camila Atualizada',current_password:'Professor!2026',password:'NovaSenhaProfessor!2026'},p1)).status,200);assert.equal((await req('/api/professor/state','GET',null,second)).status,401);assert.equal((await req('/api/professor/state','GET',null,p1)).body.professional.name,'Camila Atualizada');
});
test('professional pages load and logout revokes only the professor session',async()=>{
  for(const path of ['/professor','/professor/','/professor/app.js','/professor/styles.css','/sistema/professional-tools.js','/assets/fonts/stardos-stencil-bold.ttf'])assert.equal((await req(path)).status,200,path);
  assert.equal((await req('/api/professor/logout','POST',{},p1)).status,200);assert.equal((await req('/api/professor/state','GET',null,p1)).status,401);assert.equal((await req('/api/state','GET',null,staff)).status,200);
});
