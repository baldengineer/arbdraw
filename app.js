const canvas = document.querySelector('#waveCanvas');
const ctx = canvas.getContext('2d');
function normalizeDefaults(source={}){
  const finite=(key,fallback)=>Number.isFinite(Number(source[key]))?Number(source[key]):fallback;
  const offsetV=finite('offsetV',0),amplitudeVpp=Math.max(0,finite('amplitudeVpp',10));
  let highLevelV=finite('highLevelV',offsetV+amplitudeVpp/2),lowLevelV=finite('lowLevelV',offsetV-amplitudeVpp/2);
  if(highLevelV<lowLevelV)[highLevelV,lowLevelV]=[lowLevelV,highLevelV];
  return Object.freeze({highLevelV,lowLevelV,offsetV,amplitudeVpp,sampleRateMSa:Math.max(.000001,finite('sampleRateMSa',2500)),sampleCount:Math.max(2,Math.round(finite('sampleCount',10000))),frequencyHz:Math.max(.000001,finite('frequencyHz',750000)),phaseDegrees:finite('phaseDegrees',0),dutyCyclePercent:Math.min(95,Math.max(5,finite('dutyCyclePercent',50)))});
}
const DEFAULT_VALUES=normalizeDefaults(globalThis.ARBDRAW_DEFAULTS);
function createDefaultDocument(){const durationMs=DEFAULT_VALUES.sampleCount/(DEFAULT_VALUES.sampleRateMSa*1000);return {schema:'arbdraw.waveform',version:1,name:'Waveform 01',waveform:{type:'sine',highVoltage:DEFAULT_VALUES.highLevelV,lowVoltage:DEFAULT_VALUES.lowLevelV,durationMs,sampleRateMSa:DEFAULT_VALUES.sampleRateMSa,frequencyHz:DEFAULT_VALUES.frequencyHz,cycles:DEFAULT_VALUES.frequencyHz*durationMs/1000,phaseDegrees:DEFAULT_VALUES.phaseDegrees,dutyCyclePercent:DEFAULT_VALUES.dutyCyclePercent,sampleCount:DEFAULT_VALUES.sampleCount,values:[]}}}
let projectDocument=createDefaultDocument();
const state = { tool:'pencil', zoom:1, history:[], redo:[], drawing:false, lineStart:null };
const documentFields={type:'type',high:'highVoltage',low:'lowVoltage',duration:'durationMs',sampleRate:'sampleRateMSa',frequency:'frequencyHz',cycles:'cycles',phase:'phaseDegrees',duty:'dutyCyclePercent',samples:'sampleCount',data:'values'};
Object.entries(documentFields).forEach(([stateKey,documentKey])=>Object.defineProperty(state,stateKey,{get:()=>projectDocument.waveform[documentKey],set:value=>projectDocument.waveform[documentKey]=value}));
const titles = {sine:'Sine wave',square:'Square wave',triangle:'Triangle wave',ramp:'Ramp wave',pulse:'Pulse wave',dc:'DC level',noise:'White noise',custom:'Custom waveform'};
const $ = id => document.getElementById(id);

function setTheme(theme) {
  document.documentElement.dataset.theme=theme;
  localStorage.setItem('arbdraw-theme',theme);
  document.querySelectorAll('.theme-option').forEach(button=>button.classList.toggle('active',button.dataset.theme===theme));
}
setTheme(localStorage.getItem('arbdraw-theme')||'dark');
document.querySelectorAll('.theme-option').forEach(button=>button.addEventListener('click',()=>setTheme(button.dataset.theme)));
function setLibraryCollapsed(collapsed){document.querySelector('.workspace').classList.toggle('library-collapsed',collapsed);$('libraryToggle').setAttribute('aria-label',collapsed?'Expand preset library':'Collapse preset library');$('libraryToggle').title=collapsed?'Expand presets':'Collapse presets';localStorage.setItem('arbdraw-library-collapsed',String(collapsed));setTimeout(resize,220)}
setLibraryCollapsed(localStorage.getItem('arbdraw-library-collapsed')==='true');
$('libraryToggle').onclick=()=>setLibraryCollapsed(!document.querySelector('.workspace').classList.contains('library-collapsed'));

function showToast(message){$('toast').textContent=message;$('toast').classList.add('show');setTimeout(()=>$('toast').classList.remove('show'),2200)}
function renderDocument(){
  document.querySelector('.document-name').value=projectDocument.name;document.querySelector('.document-name').readOnly=true;document.querySelector('.document-name').classList.remove('editing');
  $('highInput').value=state.high;$('lowInput').value=state.low;$('offsetInput').value=((state.high+state.low)/2).toFixed(1);$('amplitudeInput').value=(state.high-state.low).toFixed(1);
  renderFrequency();$('phaseInput').value=state.phase;$('dutyInput').value=state.duty;$('dutyValue').textContent=state.duty+'%';renderTiming();
  document.querySelector('.preset.active')?.classList.remove('active');document.querySelector(`.preset[data-wave="${state.type}"]`)?.classList.add('active');$('propertyTitle').textContent=titles[state.type]||'Custom waveform';draw();
}
function parseProject(raw){
  if(!raw||raw.schema!=='arbdraw.waveform'||raw.version!==1||!raw.waveform)throw new Error('This is not a supported ArbDraw project.');
  const source=raw.waveform,number=(key,fallback)=>Number.isFinite(Number(source[key]))?Number(source[key]):fallback,defaults=createDefaultDocument().waveform;
  const sampleCount=Math.max(2,Math.round(number('sampleCount',defaults.sampleCount))),sampleRateMSa=Math.max(.000001,number('sampleRateMSa',defaults.sampleRateMSa));
  const values=Array.isArray(source.values)&&source.values.length===sampleCount&&source.values.every(Number.isFinite)?source.values.map(Number):[];
  const importedType=source.type==='free'?'custom':source.type;
  const durationMs=sampleCount/(sampleRateMSa*1000),legacyCycles=Math.max(0,number('cycles',defaults.cycles)),frequencyHz=Math.max(.000001,number('frequencyHz',legacyCycles/(durationMs/1000)));
  return {schema:'arbdraw.waveform',version:1,name:String(raw.name||'Imported waveform').slice(0,120),waveform:{type:titles[importedType]?importedType:'custom',highVoltage:number('highVoltage',defaults.highVoltage),lowVoltage:number('lowVoltage',defaults.lowVoltage),durationMs,sampleRateMSa,frequencyHz,cycles:frequencyHz*durationMs/1000,phaseDegrees:number('phaseDegrees',defaults.phaseDegrees),dutyCyclePercent:Math.min(95,Math.max(5,number('dutyCyclePercent',defaults.dutyCyclePercent))),sampleCount,values}};
}
function loadProject(raw){projectDocument=parseProject(raw);state.history=[];state.redo=[];renderDocument();if(!state.data.length)generate();else pushHistory();showToast('Project opened')}

const projectNameInput=document.querySelector('.document-name');
let projectNameBeforeEdit=projectDocument.name;
function beginProjectNameEdit(){if(!projectNameInput.readOnly)return;projectNameBeforeEdit=projectDocument.name;projectNameInput.readOnly=false;projectNameInput.classList.add('editing');projectNameInput.focus();projectNameInput.select()}
function commitProjectNameEdit(cancel=false){if(projectNameInput.readOnly)return;const nextName=cancel?projectNameBeforeEdit:projectNameInput.value.trim();projectDocument.name=nextName||'Untitled project';projectNameInput.value=projectDocument.name;projectNameInput.readOnly=true;projectNameInput.classList.remove('editing')}
projectNameInput.addEventListener('click',beginProjectNameEdit);
projectNameInput.addEventListener('blur',()=>commitProjectNameEdit());
projectNameInput.addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();projectNameInput.blur()}if(event.key==='Escape'){event.preventDefault();commitProjectNameEdit(true);projectNameInput.blur()}});
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
  }}); pushHistory(); draw();if(!$('samplesView').classList.contains('hidden'))renderSamples();
}
function pushHistory(){ state.history.push([...state.data]); if(state.history.length>30)state.history.shift(); state.redo=[]; }
function resize(){ const r=canvas.getBoundingClientRect(), d=devicePixelRatio||1; if(canvas.width!==Math.round(r.width*d)||canvas.height!==Math.round(r.height*d)){canvas.width=Math.round(r.width*d);canvas.height=Math.round(r.height*d)} draw(); }
function voltageBounds(){if(state.high!==state.low)return {high:state.high,low:state.low};const span=Math.max(5,Math.abs(state.high));return {high:state.high+span,low:state.low-span}}
function draw(){ const w=canvas.width,h=canvas.height,d=devicePixelRatio||1; if(!w||!h)return; ctx.clearRect(0,0,w,h); ctx.fillStyle='#090d0f';ctx.fillRect(0,0,w,h); const pad={l:58*d,r:18*d,t:20*d,b:39*d},pw=w-pad.l-pad.r,ph=h-pad.t-pad.b,bounds=voltageBounds();
  ctx.font=`${10*d}px ui-monospace`;ctx.lineWidth=1*d;ctx.textAlign='right';ctx.textBaseline='middle';
  for(let y=0;y<=8;y++){const py=pad.t+ph*y/8, val=bounds.high-(bounds.high-bounds.low)*y/8;ctx.strokeStyle=y===4?'#49605f':'#223033';ctx.beginPath();ctx.moveTo(pad.l,py);ctx.lineTo(w-pad.r,py);ctx.stroke();ctx.fillStyle='#718083';ctx.fillText(val.toFixed(1),pad.l-9*d,py)}
  ctx.textAlign='center';ctx.textBaseline='top';for(let x=0;x<=10;x++){const px=pad.l+pw*x/10;ctx.strokeStyle=x===0?'#405053':'#1e2c2f';ctx.beginPath();ctx.moveTo(px,pad.t);ctx.lineTo(px,h-pad.b);ctx.stroke();ctx.fillStyle='#718083';ctx.fillText((state.duration*x/10).toFixed(2),px,h-pad.b+10*d)}
  if(!state.data.length)return;ctx.save();ctx.beginPath();ctx.rect(pad.l,pad.t,pw,ph);ctx.clip();ctx.strokeStyle='#7bffb2';ctx.shadowColor='#7bffb2';ctx.shadowBlur=5*d;ctx.lineWidth=1.5*d;ctx.beginPath();state.data.forEach((v,i)=>{const x=pad.l+pw*i/(state.data.length-1),y=pad.t+(bounds.high-v)/(bounds.high-bounds.low)*ph;i?ctx.lineTo(x,y):ctx.moveTo(x,y)});ctx.stroke();ctx.restore(); }
function canvasPoint(e){const r=canvas.getBoundingClientRect(),d=devicePixelRatio||1,p={l:58*d,r:18*d,t:20*d,b:39*d},x=(e.clientX-r.left)*d,y=(e.clientY-r.top)*d,pw=canvas.width-p.l-p.r,ph=canvas.height-p.t-p.b,bounds=voltageBounds();return {i:Math.max(0,Math.min(state.samples-1,Math.round((x-p.l)/pw*(state.samples-1)))),v:Math.max(bounds.low,Math.min(bounds.high,bounds.high-(y-p.t)/ph*(bounds.high-bounds.low)))};}
function editAt(pt,last){if(state.tool==='pan')return;if(state.tool==='erase')pt.v=(state.high+state.low)/2;if(state.tool==='line'&&state.lineStart){const a=state.lineStart,b=pt,lo=Math.min(a.i,b.i),hi=Math.max(a.i,b.i);for(let i=lo;i<=hi;i++)state.data[i]=a.v+(b.v-a.v)*(i-a.i)/(b.i-a.i||1)}else if(last){const lo=Math.min(last.i,pt.i),hi=Math.max(last.i,pt.i);for(let i=lo;i<=hi;i++)state.data[i]=last.v+(pt.v-last.v)*(i-last.i)/(pt.i-last.i||1)}else state.data[pt.i]=pt.v;draw();}
function selectPreset(type){document.querySelector('.preset.active')?.classList.remove('active');document.querySelector(`.preset[data-wave="${type}"]`)?.classList.add('active');$('propertyTitle').textContent=titles[type]}
function markCustom(){if(state.type!=='custom'){state.type='custom';selectPreset('custom')}}
canvas.addEventListener('pointerdown',e=>{markCustom();state.drawing=true;canvas.setPointerCapture(e.pointerId);const p=canvasPoint(e);if(state.high===state.low&&state.tool!=='pan'){state.high=Math.max(state.high,p.v);state.low=Math.min(state.low,p.v);$('highInput').value=state.high.toFixed(3);$('lowInput').value=state.low.toFixed(3);$('amplitudeInput').value=(state.high-state.low).toFixed(3);$('offsetInput').value=((state.high+state.low)/2).toFixed(3)}state.lineStart=state.tool==='line'?p:null;state.lastPoint=p;editAt(p)});
canvas.addEventListener('pointermove',e=>{const p=canvasPoint(e);$('cursorReadout').style.display='block';$('cursorReadout').innerHTML=`${(p.i/(state.samples-1)*state.duration).toFixed(3)} ms &nbsp; ${p.v.toFixed(3)} V`;if(state.drawing){editAt(p,state.tool==='pencil'||state.tool==='erase'?state.lastPoint:null);state.lastPoint=p}});
canvas.addEventListener('pointerup',e=>{if(state.drawing&&state.tool==='line')editAt(canvasPoint(e));if(state.drawing)pushHistory();state.drawing=false;state.lineStart=null});canvas.addEventListener('pointerleave',()=>{$('cursorReadout').style.display='none'});

document.querySelectorAll('.preset').forEach(b=>{drawMini(b.querySelector('canvas'),b.dataset.wave);b.onclick=()=>{selectPreset(b.dataset.wave);if(b.dataset.wave==='custom'){state.type='custom'}else generate(b.dataset.wave)}});
function drawMini(c,type){const x=c.getContext('2d'),w=c.width=110,h=c.height=42;x.strokeStyle='#ff6b2c';x.lineWidth=2;x.beginPath();for(let i=0;i<w;i++){let t=i/(w-1),p=(t*2)%1,y=.5;if(type==='sine')y=.5-.34*Math.sin(t*Math.PI*4);if(type==='square'||type==='pulse')y=p<.5?.2:.8;if(type==='triangle')y=.2+.6*Math.abs(2*p-1);if(type==='ramp')y=.8-.6*p;if(type==='dc')y=.5;if(type==='noise')y=.2+Math.random()*.6;if(type==='custom')y=.5;i?x.lineTo(i,y*h):x.moveTo(i,y*h)}x.stroke()}
document.querySelectorAll('.tool[data-tool]').forEach(b=>b.onclick=()=>{document.querySelector('.tool.active')?.classList.remove('active');b.classList.add('active');state.tool=b.dataset.tool});
function formatSampleTime(index){const seconds=index/(state.samples-1)*state.duration/1000;return seconds===0?'0':seconds.toExponential(9)}
let sampleRenderToken=0;
function renderSamples(){
  const token=++sampleRenderToken,total=state.samples,chunkSize=400,body=$('samplesTableBody'),loading=$('samplesLoading');let index=0;
  $('tableCount').textContent=total.toLocaleString()+' points';body.innerHTML='';loading.classList.remove('done');$('samplesProgress').textContent='0 of '+total.toLocaleString();
  function appendChunk(){if(token!==sampleRenderToken)return;const end=Math.min(index+chunkSize,total),rows=[];for(;index<end;index++)rows.push(`<tr><td>${formatSampleTime(index)}</td><td><input class="sample-voltage" type="number" step="any" data-index="${index}" value="${Number(state.data[index]??0).toPrecision(10)}" aria-label="Voltage at sample ${index+1}"></td></tr>`);body.insertAdjacentHTML('beforeend',rows.join(''));$('samplesProgress').textContent=index.toLocaleString()+' of '+total.toLocaleString();if(index<total)requestAnimationFrame(appendChunk);else loading.classList.add('done')}
  requestAnimationFrame(appendChunk);
}
function setEditorTab(tab){const samples=tab==='samples';$('waveformTab').classList.toggle('active',!samples);$('samplesTab').classList.toggle('active',samples);$('waveformTab').setAttribute('aria-selected',String(!samples));$('samplesTab').setAttribute('aria-selected',String(samples));$('waveformView').classList.toggle('hidden',samples);$('samplesView').classList.toggle('hidden',!samples);if(samples)requestAnimationFrame(renderSamples);else{sampleRenderToken++;resize()}}
$('waveformTab').onclick=()=>setEditorTab('waveform');$('samplesTab').onclick=()=>setEditorTab('samples');
function updateSampleVoltage(input,recordHistory=false){const index=+input.dataset.index,value=Number(input.value);if(!Number.isFinite(value))return;state.data[index]=value;state.high=Math.max(state.high,value);state.low=Math.min(state.low,value);$('highInput').value=state.high;$('lowInput').value=state.low;$('amplitudeInput').value=(state.high-state.low).toFixed(3);$('offsetInput').value=((state.high+state.low)/2).toFixed(3);markCustom();if(recordHistory)pushHistory();draw()}
$('samplesTableBody').addEventListener('input',event=>{const input=event.target.closest('.sample-voltage');if(input)updateSampleVoltage(input)});
$('samplesTableBody').addEventListener('change',event=>{const input=event.target.closest('.sample-voltage');if(input)updateSampleVoltage(input,true)});
function renderTiming(){state.sampleRate=state.samples/state.duration/1000;$('sampleStatus').textContent=state.samples.toLocaleString();$('durationStatus').textContent=formatDuration(state.duration);$('rateStatus').textContent=formatRate(state.sampleRate)+' MSa/s';}
function renderFrequency(){$('frequencyInput').value=Number(state.frequency.toPrecision(10));$('periodInput').value=Number((1e6/state.frequency).toPrecision(10))}
function formatRate(value){return value>=100?value.toLocaleString(undefined,{minimumFractionDigits:1,maximumFractionDigits:1}):value>=1?value.toFixed(3):value.toPrecision(4)}
function formatDuration(value){if(value<.001)return (value*1e6).toFixed(2)+' ns';if(value<1)return (value*1000).toFixed(3)+' µs';if(value<1000)return value.toFixed(3)+' ms';return (value/1000).toFixed(3)+' s'}
function syncInputs(){state.high=+$('highInput').value;state.low=+$('lowInput').value;if(state.high<=state.low)state.high=state.low+.1;state.frequency=Math.max(.000001,+$('frequencyInput').value);state.cycles=state.frequency*state.duration/1000;state.phase=+$('phaseInput').value;state.duty=+$('dutyInput').value;$('amplitudeInput').value=(state.high-state.low).toFixed(1);$('offsetInput').value=((state.high+state.low)/2).toFixed(1);$('dutyValue').textContent=state.duty+'%';renderFrequency();renderTiming();}

function beginTimingEdit(control){if(control.classList.contains('editing'))return;document.querySelector('.timing-control.editing')?.classList.remove('editing');const kind=control.dataset.timing,input=kind==='rate'?$('rateEdit'):$('samplesEdit');input.value=kind==='rate'?state.sampleRate:state.samples;control.classList.add('editing');input.focus();input.select()}
function commitTimingEdit(control,cancel=false){if(!control.classList.contains('editing'))return;const kind=control.dataset.timing,input=kind==='rate'?$('rateEdit'):$('samplesEdit'),value=Number(input.value);control.classList.remove('editing');if(cancel||!Number.isFinite(value)||value<=0)return;if(kind==='rate'){state.sampleRate=Math.max(.000001,value);state.duration=state.samples/(state.sampleRate*1000);state.cycles=state.frequency*state.duration/1000;renderTiming();draw()}else{state.samples=Math.max(2,Math.round(value));state.duration=state.samples/(state.sampleRate*1000);state.cycles=state.frequency*state.duration/1000;renderTiming();generate()}}
document.querySelectorAll('.timing-control.editable').forEach(control=>{const input=control.querySelector('input');control.addEventListener('click',()=>beginTimingEdit(control));control.addEventListener('keydown',event=>{if(!control.classList.contains('editing')&&(event.key==='Enter'||event.key===' ')){event.preventDefault();beginTimingEdit(control)}});input.addEventListener('click',event=>event.stopPropagation());input.addEventListener('blur',()=>commitTimingEdit(control));input.addEventListener('keydown',event=>{event.stopPropagation();if(event.key==='Enter'){event.preventDefault();input.blur()}if(event.key==='Escape'){event.preventDefault();commitTimingEdit(control,true);control.focus()}})});
$('applyBtn').onclick=()=>{syncInputs();generate()};$('dutyInput').oninput=()=>{$('dutyValue').textContent=$('dutyInput').value+'%'};
$('frequencyInput').addEventListener('input',()=>{const value=+$('frequencyInput').value;if(value>0)$('periodInput').value=Number((1e6/value).toPrecision(10))});
$('periodInput').addEventListener('input',()=>{const value=+$('periodInput').value;if(value>0)$('frequencyInput').value=Number((1e6/value).toPrecision(10))});
$('amplitudeInput').onchange=()=>{const mid=(+$('highInput').value + +$('lowInput').value)/2,a=+$('amplitudeInput').value/2;$('highInput').value=mid+a;$('lowInput').value=mid-a};$('offsetInput').onchange=()=>{const a=(+$('highInput').value - +$('lowInput').value)/2,m=+$('offsetInput').value;$('highInput').value=m+a;$('lowInput').value=m-a};
$('undoBtn').onclick=()=>{if(state.history.length>1){state.redo.push(state.history.pop());state.data=[...state.history.at(-1)];draw()}};$('redoBtn').onclick=()=>{if(state.redo.length){state.data=state.redo.pop();state.history.push([...state.data]);draw()}};
$('zoomIn').onclick=()=>{state.high*=.8;state.low*=.8;draw()};$('zoomOut').onclick=()=>{state.high*=1.25;state.low*=1.25;draw()};$('fitView').onclick=()=>{syncInputs();draw()};
$('exportBtn').onclick=()=>{const csv='time_s,voltage_v\n'+state.data.map((v,i)=>`${i/(state.samples-1)*state.duration/1000},${v}`).join('\n'),blob=new Blob([csv],{type:'text/csv'}),a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='arbdraw-waveform.csv';a.click();URL.revokeObjectURL(a.href);showToast('Waveform exported as CSV')};
new ResizeObserver(resize).observe(canvas);renderDocument();generate();
