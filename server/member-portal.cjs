const crypto=require('node:crypto');
async function createMemberPortal({db,demo,today,body,send,authenticate,passwordHash,passwordMatches,day,text,phone,email,fail}){
  const all=(sql,...args)=>db.prepare(sql).all(...args),one=(sql,...args)=>db.prepare(sql).get(...args),run=(sql,...args)=>db.prepare(sql).run(...args);
  db.exec(`CREATE TABLE IF NOT EXISTS member_access(member_id INTEGER PRIMARY KEY REFERENCES members(id),email TEXT NOT NULL UNIQUE COLLATE NOCASE,password_hash TEXT NOT NULL,enabled INTEGER NOT NULL DEFAULT 1) STRICT;
    CREATE TABLE IF NOT EXISTS member_sessions(token_hash TEXT PRIMARY KEY,member_id INTEGER NOT NULL REFERENCES members(id),expires_at INTEGER NOT NULL) STRICT;
    CREATE TABLE IF NOT EXISTS member_benefits(member_id INTEGER PRIMARY KEY REFERENCES members(id),telemedicine INTEGER NOT NULL DEFAULT 0,discounts INTEGER NOT NULL DEFAULT 0) STRICT;
    CREATE TABLE IF NOT EXISTS member_workouts(id INTEGER PRIMARY KEY,member_id INTEGER NOT NULL REFERENCES members(id),weekday INTEGER NOT NULL CHECK(weekday BETWEEN 0 AND 6),title TEXT NOT NULL,instructor TEXT NOT NULL DEFAULT '',notes TEXT NOT NULL DEFAULT '',exercises TEXT NOT NULL DEFAULT '[]',UNIQUE(member_id,weekday)) STRICT;
    CREATE TABLE IF NOT EXISTS member_workout_logs(id INTEGER PRIMARY KEY,member_id INTEGER NOT NULL REFERENCES members(id),workout_id INTEGER NOT NULL REFERENCES member_workouts(id),completed_on TEXT NOT NULL,UNIQUE(workout_id,completed_on)) STRICT;`);
  if(demo){
    const hash=await passwordHash('Mensalista!2026');
    for(const m of all('SELECT id FROM members')){
      run('INSERT OR IGNORE INTO member_access VALUES(?,?,?,1)',m.id,`aluno${m.id}@dontstop.local`,hash);
      run('INSERT OR IGNORE INTO member_benefits VALUES(?,1,1)',m.id);
      const titles=['Recuperação','Peito e tríceps','Pernas','Costas e bíceps','Mobilidade','Ombros e abdômen','Treino livre'];
      const names=[[],['Supino reto','Supino inclinado com halteres','Crucifixo na máquina','Tríceps na polia'],['Agachamento guiado','Leg press','Cadeira extensora','Mesa flexora'],['Puxada frontal','Remada baixa','Remada unilateral','Rosca com halteres'],['Mobilidade de quadril','Mobilidade de ombros','Alongamento de posterior'],['Desenvolvimento com halteres','Elevação lateral','Prancha','Abdominal no solo'],['Bicicleta','Mobilidade geral']];
      for(let weekday=0;weekday<7;weekday++)run('INSERT OR IGNORE INTO member_workouts(member_id,weekday,title,instructor,notes,exercises) VALUES(?,?,?,?,?,?)',m.id,weekday,titles[weekday],'Equipe Don’t Stop','Treino ilustrativo da demonstração.',JSON.stringify(names[weekday].map((name,index)=>({name,sets:weekday===4?'2':'3',reps:name==='Prancha'?'30 s':weekday===4?'40 s':'10–12',load:'A definir com o professor',rest:'60 s'}))));
    }
  }
  const cookieName=demo?'dontstop_member_demo':'dontstop_member',hashToken=value=>crypto.createHash('sha256').update(value).digest('hex');
  const token=req=>(req.headers.cookie||'').split(';').map(x=>x.trim()).find(x=>x.startsWith(cookieName+'='))?.slice(cookieName.length+1);
  const member=req=>{const t=token(req);const m=t&&one('SELECT m.id,m.name,m.phone,m.email,m.joined_on,m.status FROM member_sessions s JOIN member_access a ON a.member_id=s.member_id JOIN members m ON m.id=a.member_id WHERE s.token_hash=? AND s.expires_at>? AND a.enabled=1 AND m.status=\'active\'',hashToken(t),Date.now());if(!m)fail(401,'Entre na sua conta de mensalista.');return m;};
  const safeUrl=value=>{try{const u=new URL(value);return u.protocol==='https:'?u.href:null;}catch{return null;}};
  const workouts=id=>all('SELECT * FROM member_workouts WHERE member_id=? ORDER BY weekday',id).map(w=>({...w,exercises:JSON.parse(w.exercises)}));
  const providerUrls={telemedicine:safeUrl(process.env.GYM_TELEMEDICINE_URL),discounts:safeUrl(process.env.GYM_DISCOUNTS_URL)};
  function memberState(m){
    const subscription=one('SELECT s.*,p.name plan_name,p.notes plan_notes FROM subscriptions s JOIN plans p ON p.id=s.plan_id WHERE s.member_id=? ORDER BY CASE WHEN s.status=\'active\' THEN 0 ELSE 1 END,s.id DESC LIMIT 1',m.id)||null;
    const benefits=one('SELECT telemedicine,discounts FROM member_benefits WHERE member_id=?',m.id)||{telemedicine:0,discounts:0};
    return {member:m,today:today(),demo,subscription,workouts:workouts(m.id),logs:all('SELECT workout_id,completed_on FROM member_workout_logs WHERE member_id=? ORDER BY completed_on DESC LIMIT 120',m.id),invoices:all('SELECT id,description,amount_cents,due_date,status FROM invoices WHERE member_id=? ORDER BY due_date DESC,id DESC',m.id).map(i=>({...i,display_status:i.status==='pending'&&i.due_date<today()?'overdue':i.status})),payments:all('SELECT p.invoice_id,p.amount_cents,p.method,p.paid_on FROM payments p JOIN invoices i ON i.id=p.invoice_id WHERE i.member_id=? ORDER BY p.paid_on DESC',m.id),benefits:Object.fromEntries(Object.entries(benefits).map(([key,value])=>[key,{enabled:!!value&&subscription?.status==='active',url:providerUrls[key]}]))};
  }
  const attempts=new Map();
  async function handle(req,res,pathname){
    const method=req.method;
    if(pathname==='/api/member/status'&&method==='GET'){let m=null;try{m=member(req);}catch{}return send(res,200,{member:m,demo,candidates:demo?all('SELECT m.id,m.name,a.email FROM members m JOIN member_access a ON a.member_id=m.id WHERE m.status=\'active\' AND a.enabled=1'):[]});}
    if(pathname==='/api/member/login'&&method==='POST'){
      const b=await body(req),key=req.socket.remoteAddress,attempt=attempts.get(key);if(attempt&&attempt.until>Date.now()&&attempt.count>=8)fail(429,'Muitas tentativas. Aguarde 15 minutos.');
      const a=one('SELECT a.* FROM member_access a JOIN members m ON m.id=a.member_id WHERE a.email=? AND a.enabled=1 AND m.status=\'active\'',email(b.email,true));
      if(!await passwordMatches(b.password,a?.password_hash)){attempts.set(key,{count:(attempt?.until>Date.now()?attempt.count:0)+1,until:Date.now()+900000});if(attempts.size>1000)for(const [k,v] of attempts)if(v.until<Date.now())attempts.delete(k);fail(401,'E-mail ou senha inválidos.');}
      attempts.delete(key);const t=crypto.randomBytes(32).toString('base64url');run('DELETE FROM member_sessions WHERE expires_at<?',Date.now());run('INSERT INTO member_sessions VALUES(?,?,?)',hashToken(t),a.member_id,Date.now()+12*3600000);
      const secure=(process.env.APP_ORIGIN||'').startsWith('https://')||req.headers.origin?.startsWith('https://');
      return send(res,200,{ok:true},{'Set-Cookie':`${cookieName}=${t}; HttpOnly; SameSite=Strict; Path=/; Max-Age=43200${secure?'; Secure':''}`});
    }
    if(pathname.startsWith('/api/member/')){
      const m=member(req);
      if(pathname==='/api/member/state'&&method==='GET')return send(res,200,memberState(m));
      const b=method==='GET'?{}:await body(req);
      if(pathname==='/api/member/logout'&&method==='POST'){run('DELETE FROM member_sessions WHERE token_hash=?',hashToken(token(req)));return send(res,200,{ok:true},{'Set-Cookie':`${cookieName}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`});}
      if(pathname==='/api/member/profile'&&method==='PATCH'){
        const name=text(b.name??m.name,120,true),telephone=phone(b.phone??m.phone);
        if(b.password){const a=one('SELECT password_hash FROM member_access WHERE member_id=?',m.id);if(!await passwordMatches(b.current_password,a.password_hash))fail(422,'A senha atual não confere.');const hash=await passwordHash(b.password);run('UPDATE member_access SET password_hash=? WHERE member_id=?',hash,m.id);run('DELETE FROM member_sessions WHERE member_id=? AND token_hash<>?',m.id,hashToken(token(req)));}
        run('UPDATE members SET name=?,phone=? WHERE id=?',name,telephone,m.id);return send(res,200,{ok:true});
      }
      const match=pathname.match(/^\/api\/member\/workouts\/(\d+)\/complete$/);
      if(match&&method==='POST'){const w=one('SELECT id,weekday FROM member_workouts WHERE id=? AND member_id=?',+match[1],m.id);if(!w)fail(404,'Treino não encontrado.');if(w.weekday!==new Date(today()+'T12:00:00Z').getUTCDay())fail(422,'Conclua o treino no dia programado.');run('INSERT OR IGNORE INTO member_workout_logs(member_id,workout_id,completed_on) VALUES(?,?,?)',m.id,w.id,today());return send(res,200,{ok:true});}
      fail(404,'Ação não encontrada.');
    }
    authenticate(req);
    const match=pathname.match(/^\/api\/members\/(\d+)\/(portal|workouts)(?:\/([0-6]))?$/);if(!match)fail(404,'Ação não encontrada.');
    const m=one('SELECT id FROM members WHERE id=?',+match[1]);if(!m)fail(404,'Mensalista não encontrado.');
    if(method==='GET'&&match[2]==='portal')return send(res,200,{access:one('SELECT email,enabled FROM member_access WHERE member_id=?',m.id)||null,benefits:one('SELECT telemedicine,discounts FROM member_benefits WHERE member_id=?',m.id)||{},workouts:workouts(m.id)});
    const b=await body(req);
    if(match[2]==='portal'&&method==='POST'){
      const previous=one('SELECT * FROM member_access WHERE member_id=?',m.id),address=email(b.email??previous?.email,true);if(one('SELECT member_id FROM member_access WHERE email=? AND member_id<>?',address,m.id))fail(409,'Este e-mail já possui acesso.');
      const hash=b.password?await passwordHash(b.password):previous?.password_hash;if(!hash)fail(422,'Informe a senha inicial do mensalista.');const enabled=b.enabled===undefined?(previous?.enabled??1):Number(!!b.enabled);
      run('INSERT INTO member_access VALUES(?,?,?,?) ON CONFLICT(member_id) DO UPDATE SET email=excluded.email,password_hash=excluded.password_hash,enabled=excluded.enabled',m.id,address,hash,enabled);
      run('INSERT INTO member_benefits VALUES(?,?,?) ON CONFLICT(member_id) DO UPDATE SET telemedicine=excluded.telemedicine,discounts=excluded.discounts',m.id,Number(!!b.telemedicine),Number(!!b.discounts));
      if(!enabled||b.password||address!==previous?.email)run('DELETE FROM member_sessions WHERE member_id=?',m.id);return send(res,200,{ok:true});
    }
    if(match[2]==='workouts'&&match[3]!==undefined&&method==='POST'){
      if(!Array.isArray(b.exercises)||b.exercises.length>30)fail(422,'Informe até 30 exercícios.');
      const exercises=b.exercises.map(x=>({name:text(x.name,120,true),sets:text(x.sets,30,true),reps:text(x.reps,60,true),load:text(x.load,100),rest:text(x.rest,60)}));
      run('INSERT INTO member_workouts(member_id,weekday,title,instructor,notes,exercises) VALUES(?,?,?,?,?,?) ON CONFLICT(member_id,weekday) DO UPDATE SET title=excluded.title,instructor=excluded.instructor,notes=excluded.notes,exercises=excluded.exercises',m.id,+match[3],text(b.title,120,true),text(b.instructor,120),text(b.notes,2000),JSON.stringify(exercises));return send(res,200,{ok:true});
    }
    fail(404,'Ação não encontrada.');
  }
  return {handle};
}
module.exports={createMemberPortal};
