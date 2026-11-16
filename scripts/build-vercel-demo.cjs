const fs=require('node:fs/promises');
const path=require('node:path');
const {createGymServer}=require('../server/gym.cjs');
const root=path.resolve(__dirname,'..'),output=path.join(root,'dist-demo');
async function build(){
  await fs.mkdir(output,{recursive:true});
  for(const file of ['index.html','styles.css','script.js','plate-scroll.js','card-motion.js','assets','sistema','mensalista','professor'])await fs.cp(path.join(root,file),path.join(output,file),{recursive:true});
  await fs.mkdir(path.join(output,'demo'),{recursive:true});
  await fs.copyFile(path.join(root,'demo/api.js'),path.join(output,'demo/api.js'));
  await fs.copyFile(path.join(root,'demo/member-api.js'),path.join(output,'demo/member-api.js'));
  await fs.copyFile(path.join(root,'demo/professor-api.js'),path.join(output,'demo/professor-api.js'));
  await fs.copyFile(path.join(root,'demo/store-api.js'),path.join(output,'demo/store-api.js'));
  const app=await createGymServer({demo:true,databasePath:':memory:'});
  try{
    const all=sql=>app.db.prepare(sql).all();
    const fixture={today:new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date()),demo:true,
      user:app.db.prepare('SELECT id,name,email,role FROM users LIMIT 1').get(),
      members:all('SELECT * FROM members'),plans:all('SELECT * FROM plans'),subscriptions:all('SELECT * FROM subscriptions'),invoices:all('SELECT * FROM invoices'),payments:all('SELECT * FROM payments'),appointments:all('SELECT * FROM appointments'),users:all('SELECT id,name,email,role,enabled FROM users'),member_access:all('SELECT member_id,email,enabled FROM member_access'),member_benefits:all('SELECT * FROM member_benefits'),member_workouts:all('SELECT * FROM member_workouts').map(w=>({...w,exercises:JSON.parse(w.exercises)})),member_workout_logs:[],professional_profiles:all('SELECT * FROM professionals'),member_professors:all('SELECT * FROM member_professors'),store_products:all('SELECT * FROM store_products'),store_variants:all('SELECT * FROM store_variants'),store_orders:[],store_order_items:[]};
    await fs.writeFile(path.join(output,'demo/fixture.json'),JSON.stringify(fixture));
  }finally{app.db.close();}
  const adapters=['store-api.js','professor-api.js','member-api.js','api.js'].map(name=>'<script src="/demo/'+name+'" defer></script>').join('\n');
  for(const [page,entry] of [['sistema','/sistema/calendar.js'],['mensalista','/mensalista/app.js'],['professor','/professor/app.js']]){
    const file=path.join(output,page,'index.html');let html=await fs.readFile(file,'utf8');const tag='<script src="'+entry+'" defer></script>';if(!html.includes(tag))throw Error('Script principal não encontrado: '+page);html=html.replace(tag,adapters+'\n'+tag);await fs.writeFile(file,html);
  }
  let site=await fs.readFile(path.join(output,'index.html'),'utf8');
  site=site.replaceAll('<a href="/mensalista/">Área do mensalista</a>','<a href="/mensalista/">Área do mensalista</a>\n        <a href="/sistema/">Equipe</a>');
  await fs.writeFile(path.join(output,'index.html'),site);
  console.log('Demonstração estática criada em dist-demo: site + sistema com dados fictícios.');
}
if(require.main===module)build().catch(error=>{console.error(error.message);process.exitCode=1;});
module.exports={build};
