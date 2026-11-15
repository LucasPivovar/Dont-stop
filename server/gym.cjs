const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { promisify } = require('node:util');
const { DatabaseSync } = require('node:sqlite');
const scrypt = promisify(crypto.scrypt);
const ROOT = path.resolve(__dirname, '..');
const METHODS = ['pix', 'dinheiro', 'cartao', 'transferencia'];
class ApiError extends Error { constructor(status, message) { super(message); this.status = status; } }
const fail = (status, message) => { throw new ApiError(status, message); };
const text = (value, max = 200, required = false) => {
  const result = String(value ?? '').trim();
  if ((required && !result) || result.length > max) fail(422, `Preencha os campos corretamente (máximo de ${max} caracteres).`);
  return result;
};
function day(value) {
  const result = String(value || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(result)) fail(422, 'Informe uma data válida.');
  const date = new Date(`${result}T12:00:00Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== result || +result.slice(0, 4) < 1900 || +result.slice(0, 4) > 2200) fail(422, 'Informe uma data válida.');
  return result;
}
function monthAfter(value, anchor) {
  const [y, m] = day(value).split('-').map(Number);
  const next = new Date(Date.UTC(y, m, 1));
  const last = new Date(Date.UTC(next.getUTCFullYear(), next.getUTCMonth() + 1, 0)).getUTCDate();
  next.setUTCDate(Math.min(anchor || +value.slice(-2), last));
  return next.toISOString().slice(0, 10);
}
function dateTime(value) {
  const result = String(value || '');
  if (!/^\d{4}-\d{2}-\d{2}T([01]\d|2[0-3]):[0-5]\d$/.test(result)) fail(422, 'Informe data e horário válidos.');
  day(result.slice(0, 10));
  return result;
}
function amount(value) {
  if (!Number.isSafeInteger(value) || value < 1 || value > 100000000) fail(422, 'Informe um valor maior que zero.');
  return value;
}
function id(value) { if (!Number.isSafeInteger(+value) || +value < 1) fail(422, 'Registro inválido.'); return +value; }
function phone(value) {
  const original = text(value, 30);
  let result = original.replace(/\D/g, '');
  if (result.startsWith('55') && result.length > 11) result = result.slice(2);
  if (original && !/^[1-9]{2}[2-9]\d{7,8}$/.test(result)) fail(422, 'Informe um telefone válido com DDD.');
  return result;
}
function email(value, required = false) {
  const result = text(value, 254, required).toLowerCase();
  if (result && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(result)) fail(422, 'Informe um e-mail válido.');
  return result;
}
async function passwordHash(password) {
  if (typeof password !== 'string' || password.length < 12 || password.length > 128) fail(422, 'Use uma senha de 12 a 128 caracteres.');
  const salt = crypto.randomBytes(16).toString('hex');
  return `${salt}:${(await scrypt(password, salt, 64)).toString('hex')}`;
}
async function passwordMatches(password, stored) {
  if (typeof password !== 'string' || password.length > 128) return false;
  const [salt, hash] = (stored || '').split(':');
  const candidate = await scrypt(password, salt || 'invalid-user-salt', 64);
  const expected = hash ? Buffer.from(hash, 'hex') : Buffer.alloc(64);
  return crypto.timingSafeEqual(candidate, expected) && !!hash;
}
const tokenHash = value => crypto.createHash('sha256').update(value).digest('hex');
const csvCell = value => '"' + String(value ?? '').replace(/^[=+@\-\t\r]/, "'$&").replaceAll('"', '""') + '"';

function openDatabase(filename) {
  if (filename !== ':memory:') fs.mkdirSync(path.dirname(filename), { recursive: true });
  const db = new DatabaseSync(filename);
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE COLLATE NOCASE, password_hash TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('admin','staff')), enabled INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP) STRICT;
    CREATE TABLE IF NOT EXISTS sessions(token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id), expires_at INTEGER NOT NULL) STRICT;
    CREATE TABLE IF NOT EXISTS members(id INTEGER PRIMARY KEY, name TEXT NOT NULL, phone TEXT NOT NULL DEFAULT '', email TEXT NOT NULL DEFAULT '', joined_on TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','inactive')), notes TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP) STRICT;
    CREATE TABLE IF NOT EXISTS plans(id INTEGER PRIMARY KEY, name TEXT NOT NULL, amount_cents INTEGER NOT NULL CHECK(amount_cents>0), notes TEXT NOT NULL DEFAULT '', enabled INTEGER NOT NULL DEFAULT 1) STRICT;
    CREATE TABLE IF NOT EXISTS subscriptions(id INTEGER PRIMARY KEY, member_id INTEGER NOT NULL REFERENCES members(id), plan_id INTEGER NOT NULL REFERENCES plans(id), amount_cents INTEGER NOT NULL CHECK(amount_cents>0), start_date TEXT NOT NULL, end_date TEXT NOT NULL, due_day INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','paused','canceled')), created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP) STRICT;
    CREATE UNIQUE INDEX IF NOT EXISTS one_live_subscription ON subscriptions(member_id) WHERE status IN ('active','paused');
    CREATE TABLE IF NOT EXISTS invoices(id INTEGER PRIMARY KEY, member_id INTEGER NOT NULL REFERENCES members(id), subscription_id INTEGER REFERENCES subscriptions(id), description TEXT NOT NULL, amount_cents INTEGER NOT NULL CHECK(amount_cents>0), due_date TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','paid','canceled')), created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, UNIQUE(subscription_id,due_date)) STRICT;
    CREATE TABLE IF NOT EXISTS payments(id INTEGER PRIMARY KEY, invoice_id INTEGER NOT NULL UNIQUE REFERENCES invoices(id), amount_cents INTEGER NOT NULL CHECK(amount_cents>0), method TEXT NOT NULL CHECK(method IN ('pix','dinheiro','cartao','transferencia')), paid_on TEXT NOT NULL, user_id INTEGER NOT NULL REFERENCES users(id), created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP) STRICT;
    CREATE TABLE IF NOT EXISTS appointments(id INTEGER PRIMARY KEY, member_id INTEGER REFERENCES members(id), contact_name TEXT NOT NULL DEFAULT '', kind TEXT NOT NULL, instructor TEXT NOT NULL, starts_at TEXT NOT NULL, ends_at TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'scheduled' CHECK(status IN ('scheduled','completed','canceled')), notes TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP) STRICT;
    CREATE INDEX IF NOT EXISTS invoices_due ON invoices(status,due_date);
    CREATE INDEX IF NOT EXISTS appointments_time ON appointments(starts_at,status);
    CREATE INDEX IF NOT EXISTS payments_date ON payments(paid_on);
    PRAGMA user_version=1;`);
  if (!db.prepare('SELECT id FROM plans LIMIT 1').get()) {
    const insert = db.prepare('INSERT INTO plans(name,amount_cents,notes) VALUES(?,?,?)');
    insert.run('Horário Livre', 11990, 'Acesso em todos os horários de funcionamento.');
    insert.run('Promocional', 7990, 'Segunda a sexta, das 10h às 16h.');
  }
  return db;
}

async function createGymServer(options = {}) {
  const db = openDatabase(options.databasePath || process.env.GYM_DATABASE || path.join(ROOT, '.data', 'gym.sqlite'));
  const demo = !!options.demo;
  const sessionCookieName = demo ? 'gym_demo_session' : 'gym_session';
  const originSetting = options.origin || process.env.APP_ORIGIN;
  const configuredOrigin = originSetting ? new URL(originSetting).origin : null;
  if (configuredOrigin && !/^https?:\/\//.test(configuredOrigin)) throw Error('APP_ORIGIN deve ser uma origem HTTP ou HTTPS.');
  const today = () => options.today || new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const one = (sql, ...args) => db.prepare(sql).get(...args);
  const all = (sql, ...args) => db.prepare(sql).all(...args);
  const run = (sql, ...args) => db.prepare(sql).run(...args);
  const exists = (table, value) => { const row = one(`SELECT * FROM ${table} WHERE id=?`, id(value)); if (!row) fail(404, 'Registro não encontrado.'); return row; };
  const transaction = fn => { db.exec('BEGIN IMMEDIATE'); try { const result = fn(); db.exec('COMMIT'); return result; } catch (error) { db.exec('ROLLBACK'); throw error; } };
  const failures = new Map();
  if (demo && !one('SELECT id FROM users LIMIT 1')) {
    const hash = await passwordHash('Demonstracao!2026');
    const adminId = Number(run('INSERT INTO users(name,email,password_hash,role) VALUES(?,?,?,?)', 'Equipe de demonstração', 'demo@dontstop.local', hash, 'admin').lastInsertRowid);
    const names = ['Ana Martins', 'Bruno Almeida', 'Carolina Lima', 'Diego Santos', 'Eduarda Costa', 'Felipe Rocha', 'Gabriela Souza', 'Henrique Alves'];
    transaction(() => names.forEach((name, i) => {
      const memberId = Number(run('INSERT INTO members(name,email,joined_on,notes) VALUES(?,?,?,?)', name, `aluno${i+1}@example.com`, today(), 'Cadastro fictício para demonstração.').lastInsertRowid);
      const due = new Date(`${today()}T12:00:00Z`); due.setUTCDate(due.getUTCDate() + i - 3);
      const date = due.toISOString().slice(0, 10);
      const price = i % 2 ? 7990 : 11990;
      const subId = Number(run('INSERT INTO subscriptions(member_id,plan_id,amount_cents,start_date,end_date,due_day) VALUES(?,?,?,?,?,?)', memberId, i % 2 + 1, price, date, monthAfter(date), +date.slice(-2)).lastInsertRowid);
      const invoiceId = Number(run('INSERT INTO invoices(member_id,subscription_id,description,amount_cents,due_date) VALUES(?,?,?,?,?)', memberId, subId, 'Mensalidade • demonstração', price, date).lastInsertRowid);
      if (i % 3 === 0) {
        run("UPDATE invoices SET status='paid' WHERE id=?", invoiceId);
        run('INSERT INTO payments(invoice_id,amount_cents,method,paid_on,user_id) VALUES(?,?,?,?,?)', invoiceId, price, 'pix', today(), adminId);
      }
      if (i < 4) run('INSERT INTO appointments(member_id,kind,instructor,starts_at,ends_at) VALUES(?,?,?,?,?)', memberId, ['Avaliação física','Treino experimental','Acompanhamento','Avaliação física'][i], 'Equipe Don’t Stop', `${today()}T${String(9+i*2).padStart(2,'0')}:00`, `${today()}T${String(9+i*2).padStart(2,'0')}:45`);
    }));
  }
  if (demo) {
    db.exec('CREATE TABLE IF NOT EXISTS demo_meta(key TEXT PRIMARY KEY,value TEXT NOT NULL) STRICT');
    if (!one("SELECT key FROM demo_meta WHERE key='calendar-example-v1'")) {
      const members=all('SELECT id FROM members ORDER BY id LIMIT 8');
      transaction(() => {
        [-3,-1,0,1,2,3,5,7,9,12,16,20].forEach((offset,index)=>{
          if(!members.length)return;
          const date=new Date(today()+'T12:00:00Z');date.setUTCDate(date.getUTCDate()+offset);
          const day=date.toISOString().slice(0,10),hour=9+index%5;
          const starts=`${day}T${String(hour).padStart(2,'0')}:00`,ends=`${day}T${String(hour).padStart(2,'0')}:45`;
          const instructor=index%2?'Equipe Don’t Stop':'Professor de demonstração';
          if(!one("SELECT id FROM appointments WHERE instructor=? AND status='scheduled' AND starts_at<? AND ends_at>?",instructor,ends,starts))run('INSERT INTO appointments(member_id,kind,instructor,starts_at,ends_at,notes) VALUES(?,?,?,?,?,?)',members[index%members.length].id,index%3?'Acompanhamento':'Treino experimental',instructor,starts,ends,'Agendamento fictício do ambiente de demonstração.');
        });
        run("INSERT INTO demo_meta VALUES('calendar-example-v1',?)",today());
      });
    }
  }

  function send(res, status, data, headers = {}) {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
    res.end(JSON.stringify(data));
  }
  function cookie(req) {
    const prefix=sessionCookieName+'=';
    const value = (req.headers.cookie || '').split(';').map(s => s.trim()).find(s => s.startsWith(prefix));
    return value?.slice(prefix.length) || '';
  }
  function authenticate(req) {
    const token = cookie(req);
    const user = token && one('SELECT u.id,u.name,u.email,u.role FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>? AND u.enabled=1', tokenHash(token), Date.now());
    if (!user) fail(401, 'Entre na sua conta para continuar.');
    return user;
  }
  async function session(req, res, user) {
    const token = crypto.randomBytes(32).toString('base64url');
    run('DELETE FROM sessions WHERE expires_at<?', Date.now());
    run('INSERT INTO sessions VALUES(?,?,?)', tokenHash(token), user.id, Date.now() + 12 * 60 * 60 * 1000);
    const secure = (configuredOrigin || '').startsWith('https://');
    send(res, 200, { user: { id: user.id, name: user.name, email: user.email, role: user.role } }, { 'Set-Cookie': `${sessionCookieName}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=43200${secure ? '; Secure' : ''}` });
  }
  async function body(req) {
    if (!(req.headers['content-type'] || '').startsWith('application/json')) fail(415, 'Envie os dados como JSON.');
    const origin = req.headers.origin;
    const port = server.address().port;
    const allowed = configuredOrigin ? [configuredOrigin] : [`http://127.0.0.1:${port}`, `http://localhost:${port}`];
    if (!allowed.includes(origin)) fail(403, 'Origem da solicitação não autorizada.');
    let data = '';
    for await (const chunk of req) { data += chunk; if (Buffer.byteLength(data) > 65536) fail(413, 'Dados acima do limite permitido.'); }
    try { const parsed = JSON.parse(data || '{}'); if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') throw Error(); return parsed; }
    catch { fail(400, 'Os dados enviados não são válidos.'); }
  }
  const invoiceWithStatus = row => ({ ...row, display_status: row.status === 'pending' && row.due_date < today() ? 'overdue' : row.status });

  async function api(req, res, pathname) {
    const method = req.method;
    if (pathname === '/api/auth/status' && method === 'GET') {
      let user = null; try { user = authenticate(req); } catch {}
      return send(res, 200, { user, setupRequired: !one('SELECT id FROM users LIMIT 1'), demo, today: today() });
    }
    if (pathname === '/api/auth/setup' && method === 'POST') {
      const b = await body(req);
      const local = ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress) && /^(localhost|127\.0\.0\.1):\d+$/.test(req.headers.host || '');
      if (!local && (!process.env.GYM_SETUP_TOKEN || b.setup_token !== process.env.GYM_SETUP_TOKEN)) fail(403, 'A configuração inicial deve ser feita localmente ou com o código do administrador.');
      if (one('SELECT id FROM users LIMIT 1')) fail(409, 'O sistema já possui um administrador.');
      const name = text(b.name, 120, true), address = email(b.email, true), hash = await passwordHash(b.password);
      // Recheck after the asynchronous password hash to prevent two initial administrators.
      if (one('SELECT id FROM users LIMIT 1')) fail(409, 'O sistema já foi configurado.');
      const userId = Number(run('INSERT INTO users(name,email,password_hash,role) VALUES(?,?,?,?)', name, address, hash, 'admin').lastInsertRowid);
      return session(req, res, { id: userId, name, email: address, role: 'admin' });
    }
    if (pathname === '/api/auth/login' && method === 'POST') {
      const b = await body(req), key = req.socket.remoteAddress;
      const attempt = failures.get(key);
      if (attempt && attempt.count >= 8 && attempt.until > Date.now()) fail(429, 'Muitas tentativas. Aguarde 15 minutos para tentar novamente.');
      const user = one('SELECT * FROM users WHERE email=? AND enabled=1', email(b.email, true));
      if (!await passwordMatches(b.password, user?.password_hash)) {
        const previous = attempt?.until > Date.now() ? attempt.count : 0;
        failures.set(key, { count: previous + 1, until: Date.now() + 900000 });
        if (failures.size > 1000) for (const [k, v] of failures) if (v.until < Date.now()) failures.delete(k);
        fail(401, 'E-mail ou senha incorretos.');
      }
      failures.delete(key);
      return session(req, res, user);
    }
    const user = authenticate(req);
    if (pathname === '/api/state' && method === 'GET') return send(res, 200, {
      today: today(), demo, user,
      members: all('SELECT * FROM members ORDER BY name COLLATE NOCASE'),
      plans: all('SELECT * FROM plans ORDER BY enabled DESC,id'),
      subscriptions: all('SELECT s.*,m.name member_name,p.name plan_name FROM subscriptions s JOIN members m ON m.id=s.member_id JOIN plans p ON p.id=s.plan_id ORDER BY s.created_at DESC,s.id DESC'),
      invoices: all('SELECT i.*,m.name member_name,m.phone member_phone FROM invoices i JOIN members m ON m.id=i.member_id ORDER BY i.due_date,i.id').map(invoiceWithStatus),
      payments: all('SELECT p.*,m.name member_name FROM payments p JOIN invoices i ON i.id=p.invoice_id JOIN members m ON m.id=i.member_id ORDER BY p.paid_on DESC,p.id DESC'),
      appointments: all("SELECT a.*,COALESCE(m.name,NULLIF(a.contact_name,''),'Visitante') member_name FROM appointments a LEFT JOIN members m ON m.id=a.member_id ORDER BY a.starts_at"),
      users: user.role === 'admin' ? all('SELECT id,name,email,role,enabled FROM users ORDER BY name') : [],
    });
    if (pathname === '/api/export/members.csv' && method === 'GET') {
      const rows = [['Nome', 'WhatsApp', 'E-mail', 'Cadastro', 'Situação'], ...all('SELECT name,phone,email,joined_on,status FROM members ORDER BY name').map(m => [m.name,m.phone,m.email,m.joined_on,m.status === 'active' ? 'Ativo' : 'Inativo'])];
      res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="mensalistas.csv"', 'Cache-Control': 'no-store' });
      return res.end('\uFEFF' + rows.map(row => row.map(csvCell).join(';')).join('\r\n'));
    }
    if (!['POST','PATCH'].includes(method)) fail(404, 'Página não encontrada.');
    const b = await body(req);
    if (pathname === '/api/auth/logout' && method === 'POST') {
      run('DELETE FROM sessions WHERE token_hash=?', tokenHash(cookie(req)));
      return send(res, 200, { ok: true }, { 'Set-Cookie': `${sessionCookieName}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0` });
    }
    if (pathname === '/api/users' && method === 'POST') {
      if (user.role !== 'admin') fail(403, 'Apenas administradores podem cadastrar a equipe.');
      const hash = await passwordHash(b.password);
      const result = run('INSERT INTO users(name,email,password_hash,role) VALUES(?,?,?,?)', text(b.name,120,true),email(b.email,true),hash,b.role === 'admin' ? 'admin' : 'staff');
      return send(res, 201, { id: Number(result.lastInsertRowid) });
    }
    if (pathname === '/api/auth/account' && method === 'PATCH') {
      const name = text(b.name ?? user.name,120,true);
      let hash;
      if (b.password) {
        const previous = one('SELECT password_hash FROM users WHERE id=?',user.id);
        if (!await passwordMatches(b.current_password,previous.password_hash)) fail(422,'A senha atual não confere.');
        hash = await passwordHash(b.password);
      }
      if (hash) {
        run('UPDATE users SET name=?,password_hash=? WHERE id=?',name,hash,user.id);
        run('DELETE FROM sessions WHERE user_id=? AND token_hash<>?',user.id,tokenHash(cookie(req)));
      } else run('UPDATE users SET name=? WHERE id=?',name,user.id);
      return send(res,200,{ok:true});
    }
    const userMatch = pathname.match(/^\/api\/users\/(\d+)$/);
    if (userMatch && method === 'PATCH') {
      if (user.role !== 'admin') fail(403,'Apenas administradores podem alterar acessos.');
      const target = exists('users',userMatch[1]);
      if (target.id === user.id) fail(409,'Use Minha conta para alterar seu perfil. Seu próprio acesso não pode ser desativado aqui.');
      const name = text(b.name ?? target.name,120,true), address = email(b.email ?? target.email,true);
      const role = b.role ?? target.role, enabled = b.enabled === undefined ? target.enabled : (b.enabled ? 1 : 0);
      if (!['admin','staff'].includes(role)) fail(422,'Escolha um perfil válido.');
      const hash = b.password ? await passwordHash(b.password) : target.password_hash;
      transaction(() => {
        if (target.role === 'admin' && target.enabled && (role !== 'admin' || !enabled) && one("SELECT COUNT(*) n FROM users WHERE role='admin' AND enabled=1").n<=1) fail(409,'Mantenha pelo menos um administrador ativo.');
        run('UPDATE users SET name=?,email=?,role=?,enabled=?,password_hash=? WHERE id=?',name,address,role,enabled,hash,target.id);
        if (!enabled || b.password || role !== target.role) run('DELETE FROM sessions WHERE user_id=?',target.id);
      });
      return send(res,200,{ok:true});
    }
    const memberMatch = pathname.match(/^\/api\/members\/(\d+)$/);
    if ((pathname === '/api/members' && method === 'POST') || (memberMatch && method === 'PATCH')) {
      const existing = memberMatch ? exists('members', memberMatch[1]) : {};
      const status = b.status ?? existing.status ?? 'active';
      if (!['active','inactive'].includes(status)) fail(422, 'Situação inválida.');
      const values = [text(b.name ?? existing.name,120,true),phone(b.phone ?? existing.phone),email(b.email ?? existing.email),day(b.joined_on ?? existing.joined_on ?? today()),status,text(b.notes ?? existing.notes,2000)];
      if (memberMatch) run('UPDATE members SET name=?,phone=?,email=?,joined_on=?,status=?,notes=? WHERE id=?', ...values,existing.id);
      else values.push(Number(run('INSERT INTO members(name,phone,email,joined_on,status,notes) VALUES(?,?,?,?,?,?)', ...values).lastInsertRowid));
      return send(res, memberMatch ? 200 : 201, { id: existing.id || values.at(-1) });
    }
    const planMatch = pathname.match(/^\/api\/plans\/(\d+)$/);
    if ((pathname === '/api/plans' && method === 'POST') || (planMatch && method === 'PATCH')) {
      const previous = planMatch ? exists('plans', planMatch[1]) : {};
      const values = [text(b.name ?? previous.name,100,true),amount(b.amount_cents ?? previous.amount_cents),text(b.notes ?? previous.notes,500),b.enabled === undefined ? (previous.enabled ?? 1) : (b.enabled ? 1 : 0)];
      const result = planMatch ? run('UPDATE plans SET name=?,amount_cents=?,notes=?,enabled=? WHERE id=?',...values,previous.id) : run('INSERT INTO plans(name,amount_cents,notes,enabled) VALUES(?,?,?,?)',...values);
      return send(res, planMatch ? 200 : 201, { id: previous.id || Number(result.lastInsertRowid) });
    }
    if (pathname === '/api/subscriptions' && method === 'POST') {
      const member = exists('members', b.member_id), plan = exists('plans', b.plan_id);
      if (member.status !== 'active' || !plan.enabled) fail(409, 'Escolha um mensalista e um plano ativos.');
      const date = day(b.start_date || today());
      const due = day(b.due_date || date);
      if (due < date) fail(422, 'O primeiro vencimento não pode ser anterior ao início da assinatura.');
      const subId = transaction(() => {
        if (one("SELECT id FROM subscriptions WHERE member_id=? AND status IN ('active','paused')", member.id)) fail(409, 'Este mensalista já possui uma assinatura ativa ou pausada.');
        const result = run('INSERT INTO subscriptions(member_id,plan_id,amount_cents,start_date,end_date,due_day) VALUES(?,?,?,?,?,?)',member.id,plan.id,plan.amount_cents,date,monthAfter(due),+due.slice(-2));
        const newId = Number(result.lastInsertRowid);
        run('INSERT INTO invoices(member_id,subscription_id,description,amount_cents,due_date) VALUES(?,?,?,?,?)',member.id,newId,`Mensalidade • ${plan.name}`,plan.amount_cents,due);
        return newId;
      });
      return send(res, 201, { id: subId });
    }
    const subscriptionMatch = pathname.match(/^\/api\/subscriptions\/(\d+)(?:\/(renew))?$/);
    if (subscriptionMatch) {
      const sub = exists('subscriptions', subscriptionMatch[1]);
      if (subscriptionMatch[2] && method === 'POST') {
        if (sub.status !== 'active') fail(409, 'Somente assinaturas ativas podem ser renovadas.');
        const invoiceId = transaction(() => {
          if (one("SELECT id FROM invoices WHERE subscription_id=? AND status='pending'",sub.id)) fail(409, 'Registre o pagamento da cobrança atual antes de renovar.');
          const previous = one('SELECT due_date FROM invoices WHERE subscription_id=? ORDER BY due_date DESC LIMIT 1',sub.id);
          const due = previous ? monthAfter(previous.due_date,sub.due_day) : sub.start_date;
          const plan = exists('plans',sub.plan_id);
          const result = run('INSERT INTO invoices(member_id,subscription_id,description,amount_cents,due_date) VALUES(?,?,?,?,?)',sub.member_id,sub.id,`Mensalidade • ${plan.name}`,sub.amount_cents,due);
          run('UPDATE subscriptions SET end_date=? WHERE id=?',monthAfter(due,sub.due_day),sub.id);
          return Number(result.lastInsertRowid);
        });
        return send(res, 201, { id: invoiceId });
      }
      if (method === 'PATCH' && !subscriptionMatch[2]) {
        if (!['active','paused','canceled'].includes(b.status)) fail(422, 'Situação inválida.');
        if (sub.status === 'canceled' && b.status !== 'canceled') fail(409, 'Cadastre uma nova assinatura para retomar um contrato cancelado.');
        run('UPDATE subscriptions SET status=? WHERE id=?',b.status,sub.id);
        return send(res, 200, { ok: true });
      }
    }
    if (pathname === '/api/invoices' && method === 'POST') {
      const member = exists('members',b.member_id);
      const result = run('INSERT INTO invoices(member_id,description,amount_cents,due_date) VALUES(?,?,?,?)',member.id,text(b.description,180,true),amount(b.amount_cents),day(b.due_date));
      return send(res, 201, { id: Number(result.lastInsertRowid) });
    }
    const invoiceMatch = pathname.match(/^\/api\/invoices\/(\d+)\/(pay|cancel)$/);
    if (invoiceMatch && method === 'POST') {
      const invoice = exists('invoices',invoiceMatch[1]);
      transaction(() => {
        if (invoice.status !== 'pending') fail(409, 'Esta cobrança já foi paga ou cancelada.');
        if (invoiceMatch[2] === 'pay') {
          if (!METHODS.includes(b.method)) fail(422, 'Escolha uma forma de pagamento.');
          const paidOn = day(b.paid_on || today());
          if (paidOn > today()) fail(422, 'O pagamento não pode ter uma data futura.');
          run('INSERT INTO payments(invoice_id,amount_cents,method,paid_on,user_id) VALUES(?,?,?,?,?)',invoice.id,invoice.amount_cents,b.method,paidOn,user.id);
          run("UPDATE invoices SET status='paid' WHERE id=?",invoice.id);
        } else run("UPDATE invoices SET status='canceled' WHERE id=?",invoice.id);
      });
      return send(res, 200, { ok: true });
    }
    const appointmentMatch = pathname.match(/^\/api\/appointments\/(\d+)$/);
    if ((pathname === '/api/appointments' && method === 'POST') || (appointmentMatch && method === 'PATCH')) {
      const previous = appointmentMatch ? exists('appointments',appointmentMatch[1]) : {};
      const merged = { ...previous,...b };
      const memberId = merged.member_id ? exists('members',merged.member_id).id : null;
      const contactName = text(merged.contact_name,120,!memberId);
      const start = dateTime(merged.starts_at);
      const duration = b.duration_minutes === undefined && previous.ends_at ? (Date.parse(previous.ends_at+'Z')-Date.parse(previous.starts_at+'Z'))/60000 : +(b.duration_minutes || 45);
      if (!Number.isInteger(duration) || duration < 15 || duration > 240) fail(422, 'A duração deve ser de 15 a 240 minutos.');
      const end = new Date(Date.parse(start+'Z') + duration*60000).toISOString().slice(0,16);
      if (end.slice(0,10)!==start.slice(0,10) && !end.endsWith('T00:00')) fail(422,'O agendamento deve terminar até a meia-noite. Ajuste a duração.');
      const instructor = text(merged.instructor || 'Equipe Don’t Stop',100,true).replace(/\s+/g,' ');
      const status = merged.status || 'scheduled';
      if (!['scheduled','completed','canceled'].includes(status)) fail(422, 'Situação inválida.');
      if (status === 'scheduled' && one("SELECT id FROM appointments WHERE instructor=? COLLATE NOCASE AND status='scheduled' AND starts_at<? AND ends_at>? AND id<>?",instructor,end,start,previous.id || 0)) fail(409, 'Esse responsável já tem um agendamento nesse horário. Escolha outro horário ou responsável.');
      if (status === 'scheduled' && memberId && one("SELECT id FROM appointments WHERE member_id=? AND status='scheduled' AND starts_at<? AND ends_at>? AND id<>?",memberId,end,start,previous.id || 0)) fail(409,'Este mensalista já possui um agendamento nesse horário.');
      const values = [memberId,contactName,text(merged.kind,100,true),instructor,start,end,status,text(merged.notes,2000)];
      const result = appointmentMatch ? run('UPDATE appointments SET member_id=?,contact_name=?,kind=?,instructor=?,starts_at=?,ends_at=?,status=?,notes=? WHERE id=?',...values,previous.id) : run('INSERT INTO appointments(member_id,contact_name,kind,instructor,starts_at,ends_at,status,notes) VALUES(?,?,?,?,?,?,?,?)',...values);
      return send(res, appointmentMatch ? 200 : 201, { id: previous.id || Number(result.lastInsertRowid) });
    }
    fail(404, 'Ação não encontrada.');
  }

  const types = { '.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg' };
  const marketingFiles = new Set(['/index.html','/styles.css','/script.js','/plate-scroll.js','/card-motion.js']);
  const server = http.createServer(async (req,res) => {
    res.setHeader('X-Content-Type-Options','nosniff');
    res.setHeader('Referrer-Policy','same-origin');
    res.setHeader('X-Frame-Options','DENY');
    res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'");
    try {
      const pathname = decodeURIComponent(new URL(req.url,'http://localhost').pathname);
      if (pathname.startsWith('/api/')) return await api(req,res,pathname);
      if (!['GET','HEAD'].includes(req.method)) fail(405,'Método não permitido.');
      if (pathname === '/sistema') { res.writeHead(302,{Location:'/sistema/'}); return res.end(); }
      const target = pathname === '/' ? '/index.html' : pathname === '/sistema/' ? '/sistema/index.html' : pathname;
      if (!marketingFiles.has(target) && !target.startsWith('/assets/') && !['/sistema/index.html','/sistema/app.js','/sistema/calendar.js','/sistema/styles.css'].includes(target)) fail(404,'Página não encontrada.');
      const file = path.resolve(ROOT,'.'+target);
      if (!file.startsWith(ROOT+path.sep)) fail(403,'Acesso não autorizado.');
      if (target.startsWith('/assets/') && !file.startsWith(path.join(ROOT,'assets')+path.sep)) fail(403,'Acesso não autorizado.');
      const contents = await fs.promises.readFile(file).catch(() => fail(404,'Arquivo não encontrado.'));
      res.writeHead(200,{'Content-Type':types[path.extname(file)] || 'application/octet-stream','Cache-Control':'no-cache'});
      res.end(req.method === 'HEAD' ? undefined : contents);
    } catch (error) {
      if (res.headersSent) return res.end();
      let status = error.status || 500, message = error.message;
      if (String(error.code).startsWith('ERR_SQLITE')) { status=409; message='Não foi possível salvar. Verifique registros duplicados ou vínculos existentes.'; }
      if (status === 500) { console.error('Request failed:',error.code || error.name); message='Não foi possível concluir a operação. Tente novamente.'; }
      send(res,status,{error:message});
    }
  });
  server.requestTimeout = 15000;
  server.headersTimeout = 10000;
  return { server, db, close: () => new Promise(resolve => server.close(() => { db.close(); resolve(); })) };
}

if (require.main === module) {
  const demo = process.argv.includes('--demo');
  const port = +(process.env.PORT || (demo ? 3101 : 3100));
  createGymServer({ demo, databasePath: demo ? path.join(ROOT,'.data','demo.sqlite') : undefined }).then(({server,close}) => {
    server.listen(port,process.env.HOST || '127.0.0.1',() => console.log(`Gestão Don't Stop: http://127.0.0.1:${port}/sistema/${demo ? ' (demonstração)' : ''}`));
    const stop=()=>close().then(()=>process.exit(0));
    process.once('SIGINT',stop);process.once('SIGTERM',stop);
  }).catch(error => { console.error(error); process.exitCode=1; });
}
module.exports = { createGymServer, monthAfter };
