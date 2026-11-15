const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
function calendar() {
  const escape = value => String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const state={date:'2026-11-15',calendarMode:'month',calendarFilter:'all',calendarInstructor:'',query:'',data:{today:'2026-11-15',appointments:[
    {id:1,member_name:'Ana de Teste',kind:'Avaliação',instructor:'Equipe A',starts_at:'2026-11-12T09:00',ends_at:'2026-11-12T09:45',status:'scheduled'},
    {id:2,member_name:'Bruno de Teste',kind:'Treino',instructor:'Equipe B',starts_at:'2026-11-12T09:15',ends_at:'2026-11-12T10:00',status:'scheduled'},
    {id:3,member_name:'Carla de Teste',kind:'Retorno',instructor:'Equipe A',starts_at:'2026-11-20T14:00',ends_at:'2026-11-20T15:00',status:'completed'},
  ]}};
  const context={state,Intl,Date,e:escape,searched:items=>items,formatDate:day=>day,shortDate:day=>day.slice(5),icon:()=>'',button:()=>'',badge:()=>'',action:()=>'',empty:()=>'',header:()=>'',selected:(a,b)=>a===b?' selected':'',statusNames:{scheduled:'Agendado',completed:'Concluído'},addDays:(value,days)=>{const d=new Date(value+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+days);return d.toISOString().slice(0,10);},renderView:()=>{},appointmentForm:value=>{context.form=value;}};
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../sistema/calendar.js'),'utf8'),context);
  return context;
}
test('month view contains 42 days and appointments across the full month',()=>{
  const c=calendar(), html=c.completeAgendaView();
  assert.equal((html.match(/class="month-day /g)||[]).length,42);
  assert.ok(html.includes('2026-10-26')); assert.ok(html.includes('2026-12-06'));
  assert.ok(html.includes('Ana de Teste')); assert.ok(html.includes('Carla de Teste'));
  assert.ok(html.includes('3 agendamentos no período'));
});
test('week view includes all seven days and separates overlapping appointments',()=>{
  const c=calendar();c.state.calendarMode='week';const html=c.completeAgendaView();
  assert.equal((html.match(/class="calendar-day-track /g)||[]).length,7);
  assert.ok(html.includes('Ana de Teste'));assert.ok(html.includes('Bruno de Teste'));
  assert.equal(html.includes('Carla de Teste'),false);
  assert.equal((html.match(/data-lanes="2"/g)||[]).length,2);
});
test('date, situation and responsible filters affect calendar data',()=>{
  const c=calendar();c.state.calendarFilter='completed';assert.equal(c.agendaItems().length,1);
  c.state.calendarFilter='all';c.state.calendarInstructor='Equipe B';assert.equal(c.agendaItems().length,1);
  assert.equal(c.agendaItems()[0].member_name,'Bruno de Teste');
});
test('calendar navigation handles month boundaries and daily detail',()=>{
  const c=calendar();c.state.date='2026-01-31';c.calendarAction('calendar-nav','1');
  assert.equal(c.state.date,'2026-02-01');
  c.calendarAction('calendar-day','2026-11-20');assert.equal(c.state.calendarMode,'day');assert.equal(c.state.date,'2026-11-20');
  c.state.calendarMode='week';c.calendarAction('calendar-nav','-1');assert.equal(c.state.date,'2026-11-13');
});
test('clicking a weekly slot prefills date, time and safe duration',()=>{
  const c=calendar(), control={dataset:{startHour:'5'},getBoundingClientRect:()=>({top:100})};
  c.calendarAction('calendar-slot','2026-11-16',{clientY:148},control);
  assert.equal(c.form.starts_at,'2026-11-16T06:00');assert.equal(c.form.duration_minutes,45);
  c.calendarAction('calendar-slot','2026-11-16',{clientY:2000},control);
  assert.equal(c.form.starts_at,'2026-11-16T23:45');assert.equal(c.form.duration_minutes,15);
});
test('appointment names are escaped in both calendar views',()=>{
  const c=calendar();c.state.data.appointments[0].member_name='<img src=x onerror=alert(1)>';
  assert.equal(c.completeAgendaView().includes('<img src=x'),false);
  c.state.calendarMode='week';assert.equal(c.completeAgendaView().includes('<img src=x'),false);
});
