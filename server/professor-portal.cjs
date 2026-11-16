const crypto=require('node:crypto');
async function createProfessorPortal({db,demo,today,body,send,authenticate,passwordHash,passwordMatches,text,email,fail,transaction,memberPortal,secure}){
  const all=(q,...a)=>db.prepare(q).all(...a),one=(q,...a)=>db.prepare(q).get(...a),run=(q,...a)=>db.prepare(q).run(...a);
  db.exec(`CREATE TABLE IF NOT EXISTS professionals(user_id INTEGER PRIMARY KEY REFERENCES users(id),specialty TEXT NOT NULL DEFAULT '') STRICT;
    CREATE TABLE IF NOT EXISTS member_professors(member_id INTEGER PRIMARY KEY REFERENCES members(id),user_id INTEGER NOT NULL REFERENCES professionals(user_id)) STRICT;
    CREATE INDEX IF NOT EXISTS member_professors_user ON member_professors(user_id);`);
  if(demo){
    const hash=await passwordHash('Professor!2026');
    for(const [name,address,specialty] of [['Camila Rocha','professora1@dontstop.local','Musculação e mobilidade'],['Rafael Costa','professor2@dontstop.local','Musculação e condicionamento']])transaction(()=>{
      let user=one('SELECT id FROM users WHERE email=?',address);if(!user){const r=run('INSERT INTO users(name,email,password_hash,role) VALUES(?,?,?,\'staff\')',name,address,hash);user={id:Number(r.lastInsertRowid)};}
      run('INSERT OR IGNORE INTO professionals VALUES(?,?)',user.id,specialty);
    });
    const teachers=all('SELECT user_id FROM professionals ORDER BY user_id');
    all('SELECT id FROM members ORDER BY id').forEach((m,i)=>run('INSERT OR IGNORE INTO member_professors VALUES(?,?)',m.id,teachers[i%teachers.length].user_id));
  }
  const cookieName=demo?'dontstop_professor_demo':'dontstop_professor',hash=value=>crypto.createHash('sha256').update(value).digest('hex');
  const token=req=>(req.headers.cookie||'').split(';').map(x=>x.trim()).find(x=>x.startsWith(cookieName+'='))?.slice(cookieName.length+1);
  const publicTeacher=p=>p?{id:p.id,name:p.name,email:p.email,specialty:p.specialty}:null;
  function teacher(req){const t=token(req),p=t&&one('SELECT u.id,u.name,u.email,p.specialty FROM sessions s JOIN users u ON u.id=s.user_id JOIN professionals p ON p.user_id=u.id WHERE s.token_hash=? AND s.expires_at>? AND u.enabled=1',hash(t),Date.now());if(!p)fail(401,'Entre na sua conta de professor.');return p;}
  const professionals=()=>all('SELECT u.id,u.name,u.email,u.enabled,p.specialty,(SELECT COUNT(*) FROM member_professors a WHERE a.user_id=u.id) member_count FROM professionals p JOIN users u ON u.id=p.user_id ORDER BY u.name COLLATE NOCASE');
  const ownMember=(prof,id)=>{const m=one('SELECT m.id,m.name,m.phone,m.joined_on,m.status FROM members m JOIN member_professors a ON a.member_id=m.id WHERE m.id=? AND a.user_id=?',+id,prof.id);if(!m)fail(404,'Aluno não encontrado entre seus acompanhamentos.');return m;};
  const workouts=id=>all('SELECT * FROM member_workouts WHERE member_id=? ORDER BY weekday',id).map(w=>({...w,exercises:JSON.parse(w.exercises)}));
  const attempts=new Map();
  async function handle(req,res,path){
    const method=req.method;
    if(path==='/api/professor/status'&&method==='GET'){let p=null;try{p=teacher(req);}catch{}return send(res,200,{professional:publicTeacher(p),demo,candidates:demo?professionals().filter(p=>p.enabled).map(publicTeacher):[]});}
    if(path==='/api/professor/login'&&method==='POST'){
      const b=await body(req),key=req.socket.remoteAddress,attempt=attempts.get(key);if(attempt&&attempt.until>Date.now()&&attempt.count>=8)fail(429,'Muitas tentativas. Aguarde 15 minutos.');
      const p=one('SELECT u.*,p.specialty FROM users u JOIN professionals p ON p.user_id=u.id WHERE u.email=? AND u.enabled=1',email(b.email,true));
      if(!await passwordMatches(b.password,p?.password_hash)){attempts.set(key,{count:(attempt?.until>Date.now()?attempt.count:0)+1,until:Date.now()+900000});if(attempts.size>1000)for(const[k,v]of attempts)if(v.until<Date.now())attempts.delete(k);fail(401,'E-mail ou senha inválidos.');}
      attempts.delete(key);const t=crypto.randomBytes(32).toString('base64url');run('DELETE FROM sessions WHERE expires_at<?',Date.now());run('INSERT INTO sessions VALUES(?,?,?)',hash(t),p.id,Date.now()+12*3600000);return send(res,200,{professional:publicTeacher(p)},{'Set-Cookie':`${cookieName}=${t}; HttpOnly; SameSite=Strict; Path=/; Max-Age=43200${secure?'; Secure':''}`});
    }
    if(path.startsWith('/api/professor/')){
      const p=teacher(req);
      if(path==='/api/professor/state'&&method==='GET')return send(res,200,{professional:publicTeacher(p),today:today(),demo,members:all('SELECT m.id,m.name,m.phone,m.joined_on,m.status,(SELECT COUNT(*) FROM member_workouts w WHERE w.member_id=m.id AND w.exercises<>\'[]\') workout_days,(SELECT MAX(l.completed_on) FROM member_workout_logs l WHERE l.member_id=m.id) last_completed FROM members m JOIN member_professors a ON a.member_id=m.id WHERE a.user_id=? ORDER BY m.name COLLATE NOCASE',p.id),completed_today:one('SELECT COUNT(*) n FROM member_workout_logs l JOIN member_professors a ON a.member_id=l.member_id WHERE a.user_id=? AND l.completed_on=?',p.id,today()).n});
      if(path==='/api/professor/logout'&&method==='POST'){await body(req);run('DELETE FROM sessions WHERE token_hash=?',hash(token(req)));return send(res,200,{ok:true},{'Set-Cookie':`${cookieName}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`});}
      if(path==='/api/professor/profile'&&method==='PATCH'){
        const b=await body(req),name=text(b.name??p.name,120,true);let password;
        if(b.password){const previous=one('SELECT password_hash FROM users WHERE id=?',p.id);if(!await passwordMatches(b.current_password,previous.password_hash))fail(422,'A senha atual não confere.');password=await passwordHash(b.password);}
        transaction(()=>{run('UPDATE users SET name=? WHERE id=?',name,p.id);if(password){run('UPDATE users SET password_hash=? WHERE id=?',password,p.id);run('DELETE FROM sessions WHERE user_id=? AND token_hash<>?',p.id,hash(token(req)));}});return send(res,200,{ok:true});
      }
      const match=path.match(/^\/api\/professor\/members\/(\d+)(?:\/workouts\/([0-6]))?$/);
      if(match){const m=ownMember(p,match[1]);if(method==='GET'&&match[2]===undefined)return send(res,200,{member:m,workouts:workouts(m.id),logs:all('SELECT workout_id,completed_on FROM member_workout_logs WHERE member_id=? ORDER BY completed_on DESC LIMIT 90',m.id)});if(method==='POST'&&match[2]!==undefined){const b=await body(req);memberPortal.saveWorkout(m.id,+match[2],{...b,instructor:p.name});return send(res,200,{ok:true});}}
      fail(404,'Ação não encontrada.');
    }
    const actor=authenticate(req);
    if(path==='/api/professionals'&&method==='GET')return send(res,200,{professionals:professionals()});
    const match=path.match(/^\/api\/professionals\/(\d+)$/);
    if((path==='/api/professionals'&&method==='POST')||(match&&method==='PATCH')){
      if(actor.role!=='admin')fail(403,'Somente administradores podem gerenciar acessos profissionais.');const b=await body(req),previous=match?one('SELECT u.* FROM users u JOIN professionals p ON p.user_id=u.id WHERE u.id=?',+match[1]):null;if(match&&!previous)fail(404,'Profissional não encontrado.');
      const name=text(b.name??previous?.name,120,true),address=email(b.email??previous?.email,true),specialty=text(b.specialty??one('SELECT specialty FROM professionals WHERE user_id=?',previous?.id||0)?.specialty,200),enabled=b.enabled===undefined?(previous?.enabled??1):Number(!!b.enabled),password=b.password?await passwordHash(b.password):previous?.password_hash;if(!password)fail(422,'Informe a senha inicial do profissional.');if(one('SELECT id FROM users WHERE email=? AND id<>?',address,previous?.id||0))fail(409,'Esse e-mail já possui acesso.');
      const id=transaction(()=>{let id=previous?.id;if(id){run('UPDATE users SET name=?,email=?,enabled=?,password_hash=? WHERE id=?',name,address,enabled,password,id);run('UPDATE professionals SET specialty=? WHERE user_id=?',specialty,id);if(!enabled||b.password||address!==previous.email)run('DELETE FROM sessions WHERE user_id=?',id);}else{id=Number(run('INSERT INTO users(name,email,password_hash,role,enabled) VALUES(?,?,?,\'staff\',?)',name,address,password,enabled).lastInsertRowid);run('INSERT INTO professionals VALUES(?,?)',id,specialty);}return id;});return send(res,previous?200:201,{id});
    }
    const assignment=path.match(/^\/api\/members\/(\d+)\/professor$/);
    if(assignment&&method==='POST'){
      const b=await body(req),m=one('SELECT id FROM members WHERE id=?',+assignment[1]);if(!m)fail(404,'Mensalista não encontrado.');if(b.professor_id){if(!one('SELECT p.user_id FROM professionals p JOIN users u ON u.id=p.user_id WHERE p.user_id=? AND u.enabled=1',+b.professor_id))fail(422,'Escolha um professor ativo.');run('INSERT INTO member_professors VALUES(?,?) ON CONFLICT(member_id) DO UPDATE SET user_id=excluded.user_id',m.id,+b.professor_id);}else run('DELETE FROM member_professors WHERE member_id=?',m.id);return send(res,200,{ok:true});
    }
    fail(404,'Ação não encontrada.');
  }
  return {handle,professionals};
}
module.exports={createProfessorPortal};
