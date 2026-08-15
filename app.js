const canvas = document.querySelector('#waveCanvas');
const ctx = canvas.getContext('2d');
function createDefaultDocument(){return {schema:'arbdraw.waveform',version:1,name:'Waveform 01',waveform:{type:'sine',highVoltage:5,lowVoltage:-5,durationMs:.004,sampleRateMSa:2500,cycles:3,phaseDegrees:0,dutyCyclePercent:50,sampleCount:10000,values:[]}}}
let projectDocument=createDefaultDocument();
const state = { tool:'pencil', zoom:1, history:[], redo:[], drawing:false, lineStart:null };
const documentFields={type:'type',high:'highVoltage',low:'lowVoltage',duration:'durationMs',sampleRate:'sampleRateMSa',cycles:'cycles',phase:'phaseDegrees',duty:'dutyCyclePercent',samples:'sampleCount',data:'values'};
Object.entries(documentFields).forEach(([stateKey,documentKey])=>Object.defineProperty(state,stateKey,{get:()=>projectDocument.waveform[documentKey],set:value=>projectDocument.waveform[documentKey]=value}));
const titles = {sine:'Sine wave',square:'Square wave',triangle:'Triangle wave',ramp:'Ramp wave',pulse:'Pulse wave',dc:'DC level',noise:'White noise',free:'Custom waveform'};
const $ = id => document.getElementById(id);

function setTheme(theme) {
  document.documentElement.dataset.theme=theme;
  localStorage.setItem('arbdraw-theme',theme);
  document.querySelectorAll('.theme-option').forEach(button=>button.classList.toggle('active',button.dataset.theme===theme));
}
setTheme(localStorage.getItem('arbdraw-theme')||'dark');
document.querySelectorAll('.theme-option').forEach(button=>button.addEventListener('click',()=>setTheme(button.dataset.theme)));

function showToast(message){$('toast').textContent=message;$('toast').classList.add('show');setTimeout(()=>$('toast').classList.remove('show'),2200)}
function ensureSampleOption(value){let option=[...$('samplesInput').options].find(item=>+item.value===value);if(!option){option=new Option(value,value);$('samplesInput').add(option)}$('samplesInput').value=value}
function renderDocument(){
  document.querySelector('.document-name').value=projectDocument.name;
  $('highInput').value=state.high;$('lowInput').value=state.low;$('offsetInput').value=((state.high+state.low)/2).toFixed(1);$('amplitudeInput').value=(state.high-state.low).toFixed(1);
  $('durationInput').value=Number(state.duration.toPrecision(8));$('cyclesInput').value=state.cycles;$('phaseInput').value=state.phase;$('dutyInput').value=state.duty;$('dutyValue').textContent=state.duty+'%';ensureSampleOption(state.samples);renderTiming();
  document.querySelector('.preset.active')?.classList.remove('active');document.querySelector(`.preset[data-wave="${state.type}"]`)?.classList.add('active');$('propertyTitle').textContent=titles[state.type]||'Custom waveform';draw();
}
function parseProject(raw){
  if(!raw||raw.schema!=='arbdraw.waveform'||raw.version!==1||!raw.waveform)throw new Error('This is not a supported ArbDraw project.');
  const source=raw.waveform,number=(key,fallback)=>Number.isFinite(Number(source[key]))?Number(source[key]):fallback,defaults=createDefaultDocument().waveform;
  const sampleCount=Math.max(2,Math.round(number('sampleCount',defaults.sampleCount))),sampleRateMSa=Math.max(.000001,number('sampleRateMSa',defaults.sampleRateMSa));
  const values=Array.isArray(source.values)&&source.values.length===sampleCount&&source.values.every(Number.isFinite)?source.values.map(Number):[];
  return {schema:'arbdraw.waveform',version:1,name:String(raw.name||'Imported waveform').slice(0,120),waveform:{type:titles[source.type]?source.type:'free',highVoltage:number('highVoltage',defaults.highVoltage),lowVoltage:number('lowVoltage',defaults.lowVoltage),durationMs:sampleCount/(sampleRateMSa*1000),sampleRateMSa,cycles:Math.max(1,number('cycles',defaults.cycles)),phaseDegrees:number('phaseDegrees',defaults.phaseDegrees),dutyCyclePercent:Math.min(95,Math.max(5,number('dutyCyclePercent',defaults.dutyCyclePercent))),sampleCount,values}};
}
function loadProject(raw){projectDocument=parseProject(raw);state.history=[];state.redo=[];renderDocument();if(!state.data.length)generate();else pushHistory();showToast('Project opened')}

document.querySelector('.document-name').addEventListener('input',event=>projectDocument.name=event.target.value);
$('newBtn').onclick=()=>{projectDocument=createDefaultDocument();state.history=[];state.redo=[];renderDocument();generate();showToast('New project created')};
$('saveBtn').onclick=()=>{projectDocument.name=document.querySelector('.document-name').value.trim()||'Untitled waveform';const json=JSON.stringify(projectDocument,null,2),blob=new Blob([json],{type:'application/json'}),a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=projectDocument.name.replace(/[^a-z0-9_-]+/gi,'-').replace(/^-|-$/g,'').toLowerCase()+'.arbdraw.json';a.click();URL.revokeObjectURL(a.href);showToast('Project JSON downloaded')};
$('openBtn').onclick=()=>{$('projectJsonInput').value='';$('openError').textContent='';$('projectFileInput').value='';$('openDialog').showModal()};
$('chooseProjectBtn').onclick=()=>$('projectFileInput').click();
$('projectFileInput').onchange=async event=>{const file=event.target.files[0];if(file){$('projectJsonInput').value=await file.text();$('openError').textContent=''}};
$('importProjectBtn').onclick=()=>{try{loadProject(JSON.parse($('projectJsonInput').value));$('openDialog').close()}catch(error){$('openError').textContent=error instanceof SyntaxError?'The pasted text is not valid JSON.':error.message}};

function generate(type=state.type) {
  state.type=type; const n=state.samples, mid=(state.high+state.low)/2, amp=(state.high-state.low)/2, phase=state.phase*Math.PI/180;
  state.data=Array.from({length:n},(_,i)=>{ const t=i/(n-1), p=(t*state.cycles+state.phase/360)%1; switch(type){
    case 'sine': return mid+amp*Math.sin(2*Math.PI*state.cycles*t+phase);
    case 'square': return p<state.duty/100?state.high:state.low;
    case 'triangle': return mid+amp*(1-4*Math.abs(p-.5));
    case 'ramp': return state.low+(state.high-state.low)*p;
    case 'pulse': return p<state.duty/100?state.high:state.low;
    case 'dc': return mid;
    case 'noise': return mid+(Math.random()*2-1)*amp;
    default: return mid;
  }}); pushHistory(); draw();
}
function pushHistory(){ state.history.push([...state.data]); if(state.history.length>30)state.history.shift(); state.redo=[]; }
function resize(){ const r=canvas.getBoundingClientRect(), d=devicePixelRatio||1; if(canvas.width!==Math.round(r.width*d)||canvas.height!==Math.round(r.height*d)){canvas.width=Math.round(r.width*d);canvas.height=Math.round(r.height*d)} draw(); }
function draw(){ const w=canvas.width,h=canvas.height,d=devicePixelRatio||1; if(!w||!h)return; ctx.clearRect(0,0,w,h); ctx.fillStyle='#090d0f';ctx.fillRect(0,0,w,h); const pad={l:58*d,r:18*d,t:20*d,b:39*d},pw=w-pad.l-pad.r,ph=h-pad.t-pad.b;
  ctx.font=`${10*d}px ui-monospace`;ctx.lineWidth=1*d;ctx.textAlign='right';ctx.textBaseline='middle';
  for(let y=0;y<=8;y++){const py=pad.t+ph*y/8, val=state.high-(state.high-state.low)*y/8;ctx.strokeStyle=y===4?'#49605f':'#223033';ctx.beginPath();ctx.moveTo(pad.l,py);ctx.lineTo(w-pad.r,py);ctx.stroke();ctx.fillStyle='#718083';ctx.fillText(val.toFixed(1),pad.l-9*d,py)}
  ctx.textAlign='center';ctx.textBaseline='top';for(let x=0;x<=10;x++){const px=pad.l+pw*x/10;ctx.strokeStyle=x===0?'#405053':'#1e2c2f';ctx.beginPath();ctx.moveTo(px,pad.t);ctx.lineTo(px,h-pad.b);ctx.stroke();ctx.fillStyle='#718083';ctx.fillText((state.duration*x/10).toFixed(2),px,h-pad.b+10*d)}
  if(!state.data.length)return;ctx.save();ctx.beginPath();ctx.rect(pad.l,pad.t,pw,ph);ctx.clip();ctx.strokeStyle='#7bffb2';ctx.shadowColor='#7bffb2';ctx.shadowBlur=5*d;ctx.lineWidth=1.5*d;ctx.beginPath();state.data.forEach((v,i)=>{const x=pad.l+pw*i/(state.data.length-1),y=pad.t+(state.high-v)/(state.high-state.low||1)*ph;i?ctx.lineTo(x,y):ctx.moveTo(x,y)});ctx.stroke();ctx.restore(); }
function canvasPoint(e){const r=canvas.getBoundingClientRect(),d=devicePixelRatio||1,p={l:58*d,r:18*d,t:20*d,b:39*d},x=(e.clientX-r.left)*d,y=(e.clientY-r.top)*d,pw=canvas.width-p.l-p.r,ph=canvas.height-p.t-p.b;return {i:Math.max(0,Math.min(state.samples-1,Math.round((x-p.l)/pw*(state.samples-1)))),v:Math.max(state.low,Math.min(state.high,state.high-(y-p.t)/ph*(state.high-state.low)))};}
function editAt(pt,last){if(state.tool==='pan')return;if(state.tool==='erase')pt.v=(state.high+state.low)/2;if(state.tool==='line'&&state.lineStart){const a=state.lineStart,b=pt,lo=Math.min(a.i,b.i),hi=Math.max(a.i,b.i);for(let i=lo;i<=hi;i++)state.data[i]=a.v+(b.v-a.v)*(i-a.i)/(b.i-a.i||1)}else if(last){const lo=Math.min(last.i,pt.i),hi=Math.max(last.i,pt.i);for(let i=lo;i<=hi;i++)state.data[i]=last.v+(pt.v-last.v)*(i-last.i)/(pt.i-last.i||1)}else state.data[pt.i]=pt.v;draw();}
canvas.addEventListener('pointerdown',e=>{state.drawing=true;canvas.setPointerCapture(e.pointerId);const p=canvasPoint(e);state.lineStart=state.tool==='line'?p:null;state.lastPoint=p;editAt(p)});
canvas.addEventListener('pointermove',e=>{const p=canvasPoint(e);$('cursorReadout').style.display='block';$('cursorReadout').innerHTML=`${(p.i/(state.samples-1)*state.duration).toFixed(3)} ms &nbsp; ${p.v.toFixed(3)} V`;if(state.drawing){editAt(p,state.tool==='pencil'||state.tool==='erase'?state.lastPoint:null);state.lastPoint=p}});
canvas.addEventListener('pointerup',e=>{if(state.drawing&&state.tool==='line')editAt(canvasPoint(e));if(state.drawing)pushHistory();state.drawing=false;state.lineStart=null});canvas.addEventListener('pointerleave',()=>{$('cursorReadout').style.display='none'});

document.querySelectorAll('.preset').forEach(b=>{drawMini(b.querySelector('canvas'),b.dataset.wave);b.onclick=()=>{document.querySelector('.preset.active')?.classList.remove('active');b.classList.add('active');$('propertyTitle').textContent=titles[b.dataset.wave];generate(b.dataset.wave)}});
function drawMini(c,type){const x=c.getContext('2d'),w=c.width=110,h=c.height=42;x.strokeStyle='#ff6b2c';x.lineWidth=2;x.beginPath();for(let i=0;i<w;i++){let t=i/(w-1),p=(t*2)%1,y=.5;if(type==='sine')y=.5-.34*Math.sin(t*Math.PI*4);if(type==='square'||type==='pulse')y=p<.5?.2:.8;if(type==='triangle')y=.2+.6*Math.abs(2*p-1);if(type==='ramp')y=.8-.6*p;if(type==='dc')y=.5;if(type==='noise')y=.2+Math.random()*.6;if(type==='free')y=.5;i?x.lineTo(i,y*h):x.moveTo(i,y*h)}x.stroke()}
document.querySelectorAll('.tool[data-tool]').forEach(b=>b.onclick=()=>{document.querySelector('.tool.active')?.classList.remove('active');b.classList.add('active');state.tool=b.dataset.tool});
function renderTiming(){state.sampleRate=state.samples/state.duration/1000;$('sampleStatus').textContent=state.samples.toLocaleString();$('durationStatus').textContent=formatDuration(state.duration);$('rateStatus').textContent=formatRate(state.sampleRate)+' MSa/s';}
function formatRate(value){return value>=100?value.toLocaleString(undefined,{minimumFractionDigits:1,maximumFractionDigits:1}):value>=1?value.toFixed(3):value.toPrecision(4)}
function formatDuration(value){if(value<.001)return (value*1e6).toFixed(2)+' ns';if(value<1)return (value*1000).toFixed(3)+' µs';if(value<1000)return value.toFixed(3)+' ms';return (value/1000).toFixed(3)+' s'}
function syncInputs(){state.high=+$('highInput').value;state.low=+$('lowInput').value;if(state.high<=state.low)state.high=state.low+.1;state.duration=+$('durationInput').value;state.cycles=+$('cyclesInput').value;state.phase=+$('phaseInput').value;state.duty=+$('dutyInput').value;state.samples=+$('samplesInput').value;$('amplitudeInput').value=(state.high-state.low).toFixed(1);$('offsetInput').value=((state.high+state.low)/2).toFixed(1);$('dutyValue').textContent=state.duty+'%';renderTiming();}

function beginTimingEdit(control){if(control.classList.contains('editing'))return;document.querySelector('.timing-control.editing')?.classList.remove('editing');const kind=control.dataset.timing,input=kind==='rate'?$('rateEdit'):$('samplesEdit');input.value=kind==='rate'?state.sampleRate:state.samples;control.classList.add('editing');input.focus();input.select()}
function commitTimingEdit(control,cancel=false){if(!control.classList.contains('editing'))return;const kind=control.dataset.timing,input=kind==='rate'?$('rateEdit'):$('samplesEdit'),value=Number(input.value);control.classList.remove('editing');if(cancel||!Number.isFinite(value)||value<=0)return;if(kind==='rate'){state.sampleRate=Math.max(.000001,value);state.duration=state.samples/(state.sampleRate*1000);$('durationInput').value=Number(state.duration.toPrecision(8));renderTiming();draw()}else{state.samples=Math.max(2,Math.round(value));state.duration=state.samples/(state.sampleRate*1000);let option=[...$('samplesInput').options].find(item=>+item.value===state.samples);if(!option){option=new Option(state.samples,state.samples);$('samplesInput').add(option)}$('samplesInput').value=state.samples;$('durationInput').value=Number(state.duration.toPrecision(8));renderTiming();generate()}}
document.querySelectorAll('.timing-control.editable').forEach(control=>{const input=control.querySelector('input');control.addEventListener('click',()=>beginTimingEdit(control));control.addEventListener('keydown',event=>{if(!control.classList.contains('editing')&&(event.key==='Enter'||event.key===' ')){event.preventDefault();beginTimingEdit(control)}});input.addEventListener('click',event=>event.stopPropagation());input.addEventListener('blur',()=>commitTimingEdit(control));input.addEventListener('keydown',event=>{event.stopPropagation();if(event.key==='Enter'){event.preventDefault();input.blur()}if(event.key==='Escape'){event.preventDefault();commitTimingEdit(control,true);control.focus()}})});
$('applyBtn').onclick=()=>{syncInputs();generate()};$('dutyInput').oninput=()=>{$('dutyValue').textContent=$('dutyInput').value+'%'};
$('amplitudeInput').onchange=()=>{const mid=(+$('highInput').value + +$('lowInput').value)/2,a=+$('amplitudeInput').value/2;$('highInput').value=mid+a;$('lowInput').value=mid-a};$('offsetInput').onchange=()=>{const a=(+$('highInput').value - +$('lowInput').value)/2,m=+$('offsetInput').value;$('highInput').value=m+a;$('lowInput').value=m-a};
$('undoBtn').onclick=()=>{if(state.history.length>1){state.redo.push(state.history.pop());state.data=[...state.history.at(-1)];draw()}};$('redoBtn').onclick=()=>{if(state.redo.length){state.data=state.redo.pop();state.history.push([...state.data]);draw()}};
$('zoomIn').onclick=()=>{state.high*=.8;state.low*=.8;draw()};$('zoomOut').onclick=()=>{state.high*=1.25;state.low*=1.25;draw()};$('fitView').onclick=()=>{syncInputs();draw()};
$('exportBtn').onclick=()=>{const csv='time_s,voltage_v\n'+state.data.map((v,i)=>`${i/(state.samples-1)*state.duration/1000},${v}`).join('\n'),blob=new Blob([csv],{type:'text/csv'}),a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='arbdraw-waveform.csv';a.click();URL.revokeObjectURL(a.href);showToast('Waveform exported as CSV')};
new ResizeObserver(resize).observe(canvas);syncInputs();generate();
