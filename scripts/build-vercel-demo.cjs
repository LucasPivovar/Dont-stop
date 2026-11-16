const fs=require('node:fs/promises');
const path=require('node:path');
const {createGymServer}=require('../server/gym.cjs');
const root=path.resolve(__dirname,'..'),output=path.join(root,'dist-demo');
async function build(){
  await fs.mkdir(output,{recursive:true});
  for(const file of ['index.html','styles.css','script.js','plate-scroll.js','card-motion.js','assets','sistema'])await fs.cp(path.join(root,file),path.join(output,file),{recursive:true});
  await fs.mkdir(path.join(output,'demo'),{recursive:true});
  await fs.copyFile(path.join(root,'demo/api.js'),path.join(output,'demo/api.js'));
  const app=await createGymServer({demo:true,databasePath:':memory:'});
  try{
    const all=sql=>app.db.prepare(sql).all();
    const fixture={today:new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date()),demo:true,
      user:app.db.prepare('SELECT id,name,email,role FROM users LIMIT 1').get(),
      members:all('SELECT * FROM members'),plans:all('SELECT * FROM plans'),subscriptions:all('SELECT * FROM subscriptions'),invoices:all('SELECT * FROM invoices'),payments:all('SELECT * FROM payments'),appointments:all('SELECT * FROM appointments'),users:all('SELECT id,name,email,role,enabled FROM users')};
    await fs.writeFile(path.join(output,'demo/fixture.json'),JSON.stringify(fixture));
  }finally{app.db.close();}
  let system=await fs.readFile(path.join(output,'sistema/index.html'),'utf8');
  system=system.replace('<script src="./calendar.js" defer>','<script src="/demo/api.js" defer></script>\n  <script src="./calendar.js" defer>');
  await fs.writeFile(path.join(output,'sistema/index.html'),system);
  let site=await fs.readFile(path.join(output,'index.html'),'utf8');
  site=site.replaceAll('<a href="#unidades">Localização</a>','<a href="#unidades">Localização</a>\n        <a href="/sistema/">Sistema</a>');
  await fs.writeFile(path.join(output,'index.html'),site);
  console.log('Demonstração estática criada em dist-demo: site + sistema com dados fictícios.');
}
if(require.main===module)build().catch(error=>{console.error(error.message);process.exitCode=1;});
module.exports={build};
