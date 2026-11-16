const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {createGymServer}=require('./gym.cjs');
let app,base,cookie;
before(async()=>{
  app=await createGymServer({demo:true,databasePath:':memory:',today:'2026-11-15'});
  await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
  base=`http://127.0.0.1:${app.server.address().port}`;
  const response=await fetch(base+'/api/auth/login',{method:'POST',headers:{Origin:base,'Content-Type':'application/json'},body:JSON.stringify({email:'demo@dontstop.local',password:'Demonstracao!2026'})});
  assert.equal(response.status,200);cookie=response.headers.get('set-cookie').split(';')[0];
});
after(async()=>{await app.close();});

// Execute the actual client against its API with a minimal DOM adapter.
// This checks behavior and DOM references; it does not replace browser layout QA.
function client(){
  const nodes=new Map(),listeners=new Map();
  const html=fs.readFileSync(path.join(__dirname,'../sistema/index.html'),'utf8');
  function node(){
    const classes=new Set();
    return {innerHTML:'',textContent:'',value:'',hidden:false,open:false,disabled:false,
      classList:{contains:k=>classes.has(k),toggle:(k,on)=>on?classes.add(k):classes.delete(k)},
      addEventListener(){},setAttribute(){},focus(){},showModal(){this.open=true;},close(){this.open=false;},
      querySelectorAll:()=>[]};
  }
  for(const match of html.matchAll(/id="([^"]+)"/g))nodes.set('#'+match[1],node());
  const document={hidden:false,activeElement:{tagName:'BODY',focus(){}},
    querySelector(selector){if(!selector.startsWith('#'))return null;assert.ok(nodes.has(selector),`Missing DOM element ${selector}`);return nodes.get(selector);},
    querySelectorAll:()=>[],addEventListener:(type,handler)=>listeners.set(type,handler)};
  const context=vm.createContext({document,console,Intl,Date,URLSearchParams,
    location:{hash:'#agenda',search:'?demo=1'},history:{replaceState(){}},
    window:{addEventListener(){}},matchMedia:()=>({addEventListener(){}}),
    setInterval:()=>1,clearInterval(){},setTimeout:()=>1,clearTimeout(){},
    FormData:class {constructor(form){return new Map(Object.entries(form.values));}},
    fetch:(url,options={})=>fetch(base+url,{...options,headers:{...options.headers,Origin:base,Cookie:cookie}})});
  for(const file of ['store-tools.js','professional-tools.js','member-tools.js','calendar.js','app.js']){
    let source=fs.readFileSync(path.join(__dirname,'../sistema/'+file),'utf8');
    if(file==='app.js')source=source.replace(/boot\(\);\s*$/,'');
    vm.runInContext(source,context,{filename:file});
  }
  return {nodes,run:source=>vm.runInContext(source,context),context};
}

test('client starts a session and renders every page and calendar mode',async()=>{
  const c=client();await c.run('startSession()');
  assert.equal(c.nodes.get('#shell').hidden,false);
  for(const route of ['visao-geral','mensalistas','agenda','assinaturas','cobrancas','planos','profissionais','equipe']){
    c.run(`navigate('${route}')`);assert.ok(c.nodes.get('#view').innerHTML.includes('<h1'),route);
    assert.equal(c.nodes.get('#view').innerHTML.includes('undefined'),false,route);
  }
  for(const mode of ['month','week','day'])c.run(`state.view='agenda';state.calendarMode='${mode}';renderView()`);
});

test('client opens create, edit, payment, history and account dialogs',async()=>{
  const c=client();await c.run('loadData()');
  for(const call of ['memberForm()','memberForm(state.data.members[0])','subscriptionForm()',
    'invoiceForm()','paymentForm(state.data.invoices[0])','appointmentForm()',
    'appointmentForm(state.data.appointments[0])','planForm()','planForm(state.data.plans[0])',
    'userForm()','userForm(state.data.users[0])','accountForm()','profile(state.data.members[0])']){
    c.run(call);assert.equal(c.nodes.get('#modal').open,true,call);
    assert.ok(c.nodes.get('#modal-content').innerHTML.length>50,call);c.run('closeModal()');
  }
});

test('client submits a member, reloads records and preserves failed forms',async()=>{
  const c=client();await c.run('loadData()');
  function form(values){const submit={textContent:'Salvar',disabled:false},error={hidden:true,innerHTML:'',scrollIntoView(){}};return {values,dataset:{form:'member',id:''},querySelector:key=>key==='[type=submit]'?submit:error,submit,error};}
  const valid=form({name:'Novo cadastro pelo painel',phone:'41999990000',joined_on:'2026-11-15',status:'active'});
  c.context.submitted=valid;c.run('memberForm()');await c.run('handleForm(submitted)');
  assert.equal(c.run("state.data.members.some(m=>m.name==='Novo cadastro pelo painel')"),true);
  assert.equal(c.nodes.get('#modal').open,false);assert.equal(valid.submit.disabled,false);
  const invalid=form({name:'',phone:'inválido'});c.context.submitted=invalid;
  c.run('memberForm()');await c.run('handleForm(submitted)');
  assert.equal(invalid.error.hidden,false);assert.ok(invalid.error.innerHTML.includes('role="alert"'));
  assert.equal(c.nodes.get('#modal').open,true);assert.equal(invalid.submit.disabled,false);
});

test('client handles empty data, staff navigation and currency validation',async()=>{
  const c=client();await c.run('loadData()');
  c.run("state.user.role='staff';navigate('equipe')");assert.equal(c.run('state.view'),'visao-geral');
  assert.equal(c.nodes.get('#navigation').innerHTML.includes('href="#equipe"'),false);
  c.run('state.data.members=[];state.data.appointments=[];state.data.invoices=[];state.data.payments=[];state.data.subscriptions=[];state.data.plans=[];state.data.users=[]');
  for(const route of ['visao-geral','mensalistas','agenda','assinaturas','cobrancas','planos'])c.run(`navigate('${route}')`);
  c.run('invoiceForm()');assert.ok(c.nodes.get('#modal-content').innerHTML.includes('Cadastre um mensalista primeiro'));
  assert.equal(c.run("toCents('119,90')"),11990);
  for(const value of ['0','1.234,56','abc','-1'])assert.throws(()=>c.run(`toCents('${value}')`));
});
test('staff opens the member access, benefits and weekly workout editor',async()=>{
  const c=client();await c.run('loadData()');await c.run('openMemberPortal(state.data.members[0].id)');
  const content=c.nodes.get('#modal-content').innerHTML;
  assert.ok(content.includes('Treinos da semana'));assert.ok(content.includes('Telemedicina'));assert.ok(content.includes('Clube de descontos'));assert.ok(content.includes('exercise_name'));
});
test('slash focuses search without inserting text and respects fields, dialogs and modifiers',async()=>{
  const c=client();await c.run('loadData()');let focused=0,prevented=0;c.nodes.get('#search').focus=()=>focused++;
  const event={key:'/',preventDefault:()=>prevented++};c.context.shortcut=event;
  assert.equal(c.run('focusSearchShortcut(shortcut)'),true);assert.equal(focused,1);assert.equal(prevented,1);assert.equal(c.nodes.get('#search').value,'');
  for(const tagName of ['INPUT','TEXTAREA','SELECT']){c.context.document.activeElement={tagName};assert.equal(c.run('focusSearchShortcut(shortcut)'),false);}
  c.context.document.activeElement={tagName:'DIV',isContentEditable:true};assert.equal(c.run('focusSearchShortcut(shortcut)'),false);
  c.context.document.activeElement={tagName:'BODY'};
  for(const flag of ['ctrlKey','metaKey','altKey','isComposing','defaultPrevented']){c.context.shortcut={...event,[flag]:true};assert.equal(c.run('focusSearchShortcut(shortcut)'),false,flag);}
  c.context.shortcut=event;c.nodes.get('#modal').open=true;assert.equal(c.run('focusSearchShortcut(shortcut)'),false);assert.equal(focused,1);
});
test('management shows professionals, member assignments and access controls',async()=>{
  const c=client();await c.run('loadData()');c.run("navigate('profissionais')");assert.ok(c.nodes.get('#view').innerHTML.includes('Camila Rocha'));c.run('assignmentForm(state.data.members[0].id)');assert.ok(c.nodes.get('#modal-content').innerHTML.includes('Professor responsável'));c.run('professionalForm()');assert.ok(c.nodes.get('#modal-content').innerHTML.includes('Especialidade'));await c.run('openMemberPortal(state.data.members[0].id)');const form=c.nodes.get('#modal-content').innerHTML;assert.ok(form.includes('Professor responsável'));assert.ok(form.includes('name="telemedicine"'));assert.ok(form.includes('name="discounts"'));
});
