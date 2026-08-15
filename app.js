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
let amplitudeUnitScale=1;
const voltageUnitScales={highInput:1,lowInput:1,offsetInput:1};
let frequencyUnitScale=1,periodUnitScale=.000001;
function displayAmplitude(volts){return Number((volts/amplitudeUnitScale).toPrecision(10))}
function displayVoltage(inputId,volts){return Number((volts/voltageUnitScales[inputId]).toPrecision(10))}
function inputVoltage(inputId){return +$(inputId).value*voltageUnitScales[inputId]}
function displayFrequency(hertz){return Number((hertz/frequencyUnitScale).toPrecision(10))}
function inputFrequency(){return +$('frequencyInput').value*frequencyUnitScale}
function displayPeriod(hertz){return Number(((1/hertz)/periodUnitScale).toPrecision(10))}
function inputPeriodFrequency(){return 1/(+$('periodInput').value*periodUnitScale)}
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
  $('highInput').value=displayVoltage('highInput',state.high);$('lowInput').value=displayVoltage('lowInput',state.low);$('offsetInput').value=displayVoltage('offsetInput',(state.high+state.low)/2);$('amplitudeInput').value=displayAmplitude(state.high-state.low);
  renderFrequency();$('phaseInput').value=state.phase;$('dutyInput').value=state.duty;$('dutyValue').textContent=state.duty+'%';renderTiming();
  document.querySelector('.preset.active')?.classList.remove('active');document.querySelector(`.preset[data-wave="${state.type}"]`)?.classList.add('active');$('propertyTitle').textContent=titles[state.type]||'Custom waveform';updateDutyAvailability(state.type);draw();
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

function generate(type=state.type,recordHistory=true) {
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
  }});if(recordHistory)pushHistory();draw();if(!$('samplesView').classList.contains('hidden'))renderSamples();
}
function cloneWaveform(source=projectDocument.waveform){return {...source,values:[...source.values]}}
function restoreWaveform(snapshot){projectDocument.waveform=cloneWaveform(snapshot);renderDocument()}
function pushHistory(){state.history.push(cloneWaveform());if(state.history.length>30)state.history.shift();state.redo=[]}
function resize(){ const r=canvas.getBoundingClientRect(), d=devicePixelRatio||1; if(canvas.width!==Math.round(r.width*d)||canvas.height!==Math.round(r.height*d)){canvas.width=Math.round(r.width*d);canvas.height=Math.round(r.height*d)} draw(); }
function voltageBounds(){if(state.high!==state.low)return {high:state.high,low:state.low};const span=Math.max(5,Math.abs(state.high));return {high:state.high+span,low:state.low-span}}
function draw(){ const w=canvas.width,h=canvas.height,d=devicePixelRatio||1; if(!w||!h)return; ctx.clearRect(0,0,w,h); ctx.fillStyle='#090d0f';ctx.fillRect(0,0,w,h); const pad={l:58*d,r:18*d,t:20*d,b:39*d},pw=w-pad.l-pad.r,ph=h-pad.t-pad.b,bounds=voltageBounds();
  ctx.font=`${10*d}px ui-monospace`;ctx.lineWidth=1*d;ctx.textAlign='right';ctx.textBaseline='middle';
  for(let y=0;y<=8;y++){const py=pad.t+ph*y/8, val=bounds.high-(bounds.high-bounds.low)*y/8;ctx.strokeStyle=y===4?'#49605f':'#223033';ctx.beginPath();ctx.moveTo(pad.l,py);ctx.lineTo(w-pad.r,py);ctx.stroke();ctx.fillStyle='#718083';ctx.fillText(val.toFixed(1),pad.l-9*d,py)}
  ctx.textAlign='center';ctx.textBaseline='top';for(let x=0;x<=10;x++){const px=pad.l+pw*x/10;ctx.strokeStyle=x===0?'#405053':'#1e2c2f';ctx.beginPath();ctx.moveTo(px,pad.t);ctx.lineTo(px,h-pad.b);ctx.stroke();ctx.fillStyle='#718083';ctx.fillText((state.duration*x/10).toFixed(2),px,h-pad.b+10*d)}
  if(!state.data.length)return;ctx.save();ctx.beginPath();ctx.rect(pad.l,pad.t,pw,ph);ctx.clip();ctx.strokeStyle='#7bffb2';ctx.shadowColor='#7bffb2';ctx.shadowBlur=5*d;ctx.lineWidth=1.5*d;ctx.beginPath();state.data.forEach((v,i)=>{const x=pad.l+pw*i/(state.data.length-1),y=pad.t+(bounds.high-v)/(bounds.high-bounds.low)*ph;i?ctx.lineTo(x,y):ctx.moveTo(x,y)});ctx.stroke();ctx.restore();drawCustomPreview(); }
function canvasPoint(e){const r=canvas.getBoundingClientRect(),d=devicePixelRatio||1,p={l:58*d,r:18*d,t:20*d,b:39*d},x=(e.clientX-r.left)*d,y=(e.clientY-r.top)*d,pw=canvas.width-p.l-p.r,ph=canvas.height-p.t-p.b,bounds=voltageBounds();return {i:Math.max(0,Math.min(state.samples-1,Math.round((x-p.l)/pw*(state.samples-1)))),v:Math.max(bounds.low,Math.min(bounds.high,bounds.high-(y-p.t)/ph*(bounds.high-bounds.low)))};}
function editAt(pt,last){if(state.tool==='pan')return;if(state.tool==='erase')pt.v=(state.high+state.low)/2;if(state.tool==='line'&&state.lineStart){const a=state.lineStart,b=pt,lo=Math.min(a.i,b.i),hi=Math.max(a.i,b.i);for(let i=lo;i<=hi;i++)state.data[i]=a.v+(b.v-a.v)*(i-a.i)/(b.i-a.i||1)}else if(last){const lo=Math.min(last.i,pt.i),hi=Math.max(last.i,pt.i);for(let i=lo;i<=hi;i++)state.data[i]=last.v+(pt.v-last.v)*(i-last.i)/(pt.i-last.i||1)}else state.data[pt.i]=pt.v;draw();}
const dutyDisabledTypes=new Set(['custom','sine','triangle','ramp','dc','noise']);
function updateDutyAvailability(type){const disabled=dutyDisabledTypes.has(type);$('dutyInput').disabled=disabled;$('dutyInput').closest('.range-label').classList.toggle('disabled',disabled)}
function selectPreset(type){document.querySelector('.preset.active')?.classList.remove('active');document.querySelector(`.preset[data-wave="${type}"]`)?.classList.add('active');$('propertyTitle').textContent=titles[type];updateDutyAvailability(type)}
function markCustom(){if(state.type!=='custom'){state.type='custom';selectPreset('custom')}}
canvas.addEventListener('pointerdown',e=>{markCustom();state.drawing=true;canvas.setPointerCapture(e.pointerId);const p=canvasPoint(e);if(state.high===state.low&&state.tool!=='pan'){state.high=Math.max(state.high,p.v);state.low=Math.min(state.low,p.v);$('highInput').value=displayVoltage('highInput',state.high);$('lowInput').value=displayVoltage('lowInput',state.low);$('amplitudeInput').value=displayAmplitude(state.high-state.low);$('offsetInput').value=displayVoltage('offsetInput',(state.high+state.low)/2)}state.lineStart=state.tool==='line'?p:null;state.lastPoint=p;editAt(p)});
canvas.addEventListener('pointermove',e=>{const p=canvasPoint(e);$('cursorReadout').style.display='block';$('cursorReadout').innerHTML=`${(p.i/(state.samples-1)*state.duration).toFixed(3)} ms &nbsp; ${p.v.toFixed(3)} V`;if(state.drawing){editAt(p,state.tool==='pencil'||state.tool==='erase'?state.lastPoint:null);state.lastPoint=p}});
canvas.addEventListener('pointerup',e=>{if(state.drawing&&state.tool==='line')editAt(canvasPoint(e));if(state.drawing)pushHistory();state.drawing=false;state.lineStart=null});canvas.addEventListener('pointerleave',()=>{$('cursorReadout').style.display='none'});

document.querySelectorAll('.preset').forEach(b=>{drawMini(b.querySelector('canvas'),b.dataset.wave);b.onclick=()=>{selectPreset(b.dataset.wave);if(b.dataset.wave==='custom'){state.type='custom';drawCustomPreview()}else generate(b.dataset.wave)}});
function drawMini(c,type){const x=c.getContext('2d'),w=c.width=110,h=c.height=42;x.strokeStyle='#ff6b2c';x.lineWidth=2;x.beginPath();for(let i=0;i<w;i++){let t=i/(w-1),p=(t*2)%1,y=.5;if(type==='sine')y=.5-.34*Math.sin(t*Math.PI*4);if(type==='square'||type==='pulse')y=p<.5?.2:.8;if(type==='triangle')y=.2+.6*Math.abs(2*p-1);if(type==='ramp')y=.8-.6*p;if(type==='dc')y=.5;if(type==='noise')y=.2+Math.random()*.6;if(type==='custom')y=.5;i?x.lineTo(i,y*h):x.moveTo(i,y*h)}x.stroke()}
function drawCustomPreview(){const preset=document.querySelector('.preset[data-wave="custom"]'),c=preset?.querySelector('canvas');if(!preset?.classList.contains('active')||!c||!state.data.length)return;const x=c.getContext('2d'),w=c.width=220,h=c.height=68,pad=5,values=state.data;let min=Infinity,max=-Infinity;for(const value of values){if(value<min)min=value;if(value>max)max=value}const span=max-min;x.clearRect(0,0,w,h);x.strokeStyle=getComputedStyle(document.documentElement).getPropertyValue('--orange').trim()||'#ff6b2c';x.lineWidth=3;x.beginPath();for(let px=0;px<w;px++){const index=Math.round(px/(w-1)*(values.length-1)),y=span?pad+(max-values[index])/span*(h-pad*2):h/2;px?x.lineTo(px,y):x.moveTo(px,y)}x.stroke()}
document.querySelectorAll('.tool[data-tool]').forEach(b=>b.onclick=()=>{document.querySelector('.tool.active')?.classList.remove('active');b.classList.add('active');state.tool=b.dataset.tool});
function formatSampleTime(index){const seconds=index/(state.samples-1)*state.duration/1000;return seconds===0?'0':seconds.toExponential(9)}
let sampleRenderToken=0;
function renderSamples(){
  const token=++sampleRenderToken,total=state.samples,chunkSize=400,body=$('samplesTableBody'),loading=$('samplesLoading');let index=0;
  $('tableCount').textContent=total.toLocaleString()+' points';body.innerHTML='';loading.classList.remove('done');$('samplesProgress').textContent='0 of '+total.toLocaleString();
  function appendChunk(){if(token!==sampleRenderToken)return;const end=Math.min(index+chunkSize,total),rows=[];for(;index<end;index++)rows.push(`<tr><td>${formatSampleTime(index)}</td><td><input class="sample-voltage" type="number" step="any" data-index="${index}" value="${Number(state.data[index]??0).toPrecision(10)}" aria-label="Voltage at sample ${index+1}"></td></tr>`);body.insertAdjacentHTML('beforeend',rows.join(''));$('samplesProgress').textContent=index.toLocaleString()+' of '+total.toLocaleString();if(index<total)requestAnimationFrame(appendChunk);else loading.classList.add('done')}
  requestAnimationFrame(appendChunk);
}
function renderJson(){const text=JSON.stringify(projectDocument,null,2),lines=text.split('\n').length,bytes=new TextEncoder().encode(text).byteLength;$('jsonOutput').textContent=text;$('jsonStats').textContent=`${lines.toLocaleString()} lines · ${bytes.toLocaleString()} bytes`}
function setEditorTab(tab){for(const name of ['waveform','samples','json']){const active=name===tab;$(name+'Tab').classList.toggle('active',active);$(name+'Tab').setAttribute('aria-selected',String(active));$(name+'View').classList.toggle('hidden',!active)}if(tab==='samples')requestAnimationFrame(renderSamples);else sampleRenderToken++;if(tab==='waveform')resize();if(tab==='json')renderJson()}
$('waveformTab').onclick=()=>setEditorTab('waveform');$('samplesTab').onclick=()=>setEditorTab('samples');$('jsonTab').onclick=()=>setEditorTab('json');
$('copyJsonBtn').onclick=async()=>{const text=JSON.stringify(projectDocument,null,2);try{if(navigator.clipboard&&isSecureContext)await navigator.clipboard.writeText(text);else{const area=document.createElement('textarea');area.value=text;area.style.position='fixed';area.style.opacity='0';document.body.append(area);area.select();document.execCommand('copy');area.remove()}showToast('Project JSON copied')}catch{showToast('Could not access the clipboard')}};
function updateSampleVoltage(input,recordHistory=false){const index=+input.dataset.index,value=Number(input.value);if(!Number.isFinite(value))return;state.data[index]=value;state.high=Math.max(state.high,value);state.low=Math.min(state.low,value);$('highInput').value=displayVoltage('highInput',state.high);$('lowInput').value=displayVoltage('lowInput',state.low);$('amplitudeInput').value=displayAmplitude(state.high-state.low);$('offsetInput').value=displayVoltage('offsetInput',(state.high+state.low)/2);markCustom();if(recordHistory)pushHistory();draw()}
$('samplesTableBody').addEventListener('input',event=>{const input=event.target.closest('.sample-voltage');if(input)updateSampleVoltage(input)});
$('samplesTableBody').addEventListener('change',event=>{const input=event.target.closest('.sample-voltage');if(input)updateSampleVoltage(input,true)});
function renderTiming(){state.sampleRate=state.samples/state.duration/1000;$('samplesEdit').value=state.samples;$('rateEdit').value=Number(state.sampleRate.toPrecision(10));const duration=formatDurationParts(state.duration);$('durationEdit').value=duration.value;$('durationUnit').textContent=duration.unit;}
function renderFrequency(){$('frequencyInput').value=displayFrequency(state.frequency);$('periodInput').value=displayPeriod(state.frequency)}
function formatRate(value){return value>=100?value.toLocaleString(undefined,{minimumFractionDigits:1,maximumFractionDigits:1}):value>=1?value.toFixed(3):value.toPrecision(4)}
function formatDuration(value){if(value<.001)return (value*1e6).toFixed(2)+' ns';if(value<1)return (value*1000).toFixed(3)+' µs';if(value<1000)return value.toFixed(3)+' ms';return (value/1000).toFixed(3)+' s'}
function formatDurationParts(value){if(value<.001)return {value:(value*1e6).toFixed(2),unit:'ns'};if(value<1)return {value:(value*1000).toFixed(3),unit:'µs'};if(value<1000)return {value:value.toFixed(3),unit:'ms'};return {value:(value/1000).toFixed(3),unit:'s'}}
function syncInputs(){state.high=inputVoltage('highInput');state.low=inputVoltage('lowInput');if(state.high<state.low)[state.high,state.low]=[state.low,state.high];state.frequency=Math.max(.000001,inputFrequency());state.cycles=state.frequency*state.duration/1000;state.phase=+$('phaseInput').value;state.duty=+$('dutyInput').value;$('highInput').value=displayVoltage('highInput',state.high);$('lowInput').value=displayVoltage('lowInput',state.low);$('amplitudeInput').value=displayAmplitude(state.high-state.low);$('offsetInput').value=displayVoltage('offsetInput',(state.high+state.low)/2);$('dutyValue').textContent=state.duty+'%';renderFrequency();renderTiming();}

function commitTimingInput(kind){const input=kind==='rate'?$('rateEdit'):$('samplesEdit'),value=Number(input.value);if(!Number.isFinite(value)||value<=0){renderTiming();return}if(kind==='rate'){if(Math.abs(value-state.sampleRate)<=Math.max(1,state.sampleRate)*1e-10){renderTiming();return}state.sampleRate=Math.max(.000001,value);state.duration=state.samples/(state.sampleRate*1000);state.cycles=state.frequency*state.duration/1000;renderTiming();pushHistory();draw()}else{const samples=Math.max(2,Math.round(value));if(samples===state.samples){renderTiming();return}state.samples=samples;state.duration=state.samples/(state.sampleRate*1000);state.cycles=state.frequency*state.duration/1000;renderTiming();generate()}}
for(const kind of ['rate','samples']){const input=$(kind==='rate'?'rateEdit':'samplesEdit');input.addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();input.blur()}if(event.key==='Escape'){event.preventDefault();renderTiming();input.blur()}});input.addEventListener('blur',()=>commitTimingInput(kind))}
function propertiesDiffer(){const values=[inputVoltage('highInput'),inputVoltage('lowInput'),inputFrequency(),+$('phaseInput').value,+$('dutyInput').value],current=[state.high,state.low,state.frequency,state.phase,state.duty];return values.some((value,index)=>!Number.isFinite(value)||Math.abs(value-current[index])>Math.max(1,Math.abs(current[index]))*1e-10)}
function propertiesValid(){return [$('highInput'),$('lowInput'),$('frequencyInput'),$('phaseInput'),$('dutyInput')].every(input=>Number.isFinite(+input.value))&&inputFrequency()>0}
function applyProperties(){if(!propertiesValid()||!propertiesDiffer())return;syncInputs();generate()}
$('dutyInput').oninput=()=>{if($('dutyInput').disabled)return;state.duty=+$('dutyInput').value;$('dutyValue').textContent=state.duty+'%';generate(state.type,false)};
$('dutyInput').addEventListener('change',()=>pushHistory());
$('frequencyInput').addEventListener('input',()=>{const value=inputFrequency();if(value>0)$('periodInput').value=displayPeriod(value)});
$('periodInput').addEventListener('input',()=>{const value=inputPeriodFrequency();if(value>0)$('frequencyInput').value=displayFrequency(value)});
$('amplitudeInput').oninput=()=>{const mid=(inputVoltage('highInput')+inputVoltage('lowInput'))/2,a=Math.max(0,+$('amplitudeInput').value)*amplitudeUnitScale/2;$('highInput').value=displayVoltage('highInput',mid+a);$('lowInput').value=displayVoltage('lowInput',mid-a)};
$('offsetInput').oninput=()=>{const a=(inputVoltage('highInput')-inputVoltage('lowInput'))/2,m=inputVoltage('offsetInput');$('highInput').value=displayVoltage('highInput',m+a);$('lowInput').value=displayVoltage('lowInput',m-a)};
document.querySelectorAll('.inspector input').forEach(input=>{input.addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();input.blur()}});input.addEventListener('blur',applyProperties)});
const propertyDefaultMap={highInput:'highLevelV',lowInput:'lowLevelV',offsetInput:'offsetV',amplitudeInput:'amplitudeVpp',frequencyInput:'frequencyHz',periodInput:'frequencyHz',phaseInput:'phaseDegrees',dutyInput:'dutyCyclePercent'};
function setPropertyInputDefault(input){const key=propertyDefaultMap[input.id];if(!key)return;input.value=input.id==='periodInput'?displayPeriod(DEFAULT_VALUES.frequencyHz):input.id==='frequencyInput'?displayFrequency(DEFAULT_VALUES.frequencyHz):input.id==='amplitudeInput'?displayAmplitude(DEFAULT_VALUES.amplitudeVpp):voltageUnitScales[input.id]?displayVoltage(input.id,DEFAULT_VALUES[key]):DEFAULT_VALUES[key];input.dispatchEvent(new Event('input',{bubbles:true}));applyProperties()}
$('defaultAllBtn').onclick=()=>{$('highInput').value=displayVoltage('highInput',DEFAULT_VALUES.highLevelV);$('lowInput').value=displayVoltage('lowInput',DEFAULT_VALUES.lowLevelV);$('offsetInput').value=displayVoltage('offsetInput',DEFAULT_VALUES.offsetV);$('amplitudeInput').value=displayAmplitude(DEFAULT_VALUES.amplitudeVpp);$('frequencyInput').value=displayFrequency(DEFAULT_VALUES.frequencyHz);$('periodInput').value=displayPeriod(DEFAULT_VALUES.frequencyHz);$('phaseInput').value=DEFAULT_VALUES.phaseDegrees;$('dutyInput').value=DEFAULT_VALUES.dutyCyclePercent;$('dutyValue').textContent=DEFAULT_VALUES.dutyCyclePercent+'%';applyProperties()};
let contextPropertyInput=null;
document.querySelectorAll('.inspector input').forEach(input=>input.addEventListener('contextmenu',event=>{event.preventDefault();contextPropertyInput=input;const menu=$('propertyContextMenu'),width=150,height=42;menu.style.left=Math.min(event.clientX,innerWidth-width-8)+'px';menu.style.top=Math.min(event.clientY,innerHeight-height-8)+'px';menu.classList.add('open');$('setFieldDefaultBtn').focus()}));
function closePropertyContextMenu(){$('propertyContextMenu').classList.remove('open')}
$('setFieldDefaultBtn').onclick=()=>{if(contextPropertyInput)setPropertyInputDefault(contextPropertyInput);closePropertyContextMenu()};
function closeAmplitudeUnitMenu(){$('amplitudeUnitMenu').classList.remove('open');$('amplitudeUnitBtn').setAttribute('aria-expanded','false')}
$('amplitudeUnitBtn').onclick=event=>{event.stopPropagation();const button=$('amplitudeUnitBtn'),menu=$('amplitudeUnitMenu'),rect=button.getBoundingClientRect();menu.style.left=Math.min(rect.left,innerWidth-100)+'px';menu.style.top=rect.bottom+4+'px';menu.classList.add('open');button.setAttribute('aria-expanded','true');menu.querySelectorAll('button').forEach(option=>option.setAttribute('aria-checked',String(+option.dataset.scale===amplitudeUnitScale)))};
$('amplitudeUnitMenu').querySelectorAll('button').forEach(option=>option.onclick=()=>{amplitudeUnitScale=+option.dataset.scale;$('amplitudeUnitBtn').textContent=option.dataset.label;$('amplitudeInput').dispatchEvent(new Event('input',{bubbles:true}));applyProperties();closeAmplitudeUnitMenu()});
let activeVoltageUnitInput=null;
function closeVoltageUnitMenu(){$('voltageUnitMenu').classList.remove('open');document.querySelectorAll('.voltage-unit-button').forEach(button=>button.setAttribute('aria-expanded','false'))}
document.querySelectorAll('.voltage-unit-button').forEach(button=>button.onclick=event=>{event.stopPropagation();activeVoltageUnitInput=button.dataset.input;const menu=$('voltageUnitMenu'),rect=button.getBoundingClientRect();menu.style.left=Math.min(rect.left,innerWidth-100)+'px';menu.style.top=rect.bottom+4+'px';menu.classList.add('open');button.setAttribute('aria-expanded','true');menu.querySelectorAll('button').forEach(option=>option.setAttribute('aria-checked',String(+option.dataset.scale===voltageUnitScales[activeVoltageUnitInput])))});
function selectVoltageUnit(inputId,scale,label){voltageUnitScales[inputId]=scale;document.querySelector(`.voltage-unit-button[data-input="${inputId}"]`).textContent=label;$(inputId).dispatchEvent(new Event('input',{bubbles:true}));applyProperties();closeVoltageUnitMenu()}
$('voltageUnitMenu').querySelectorAll('button').forEach(option=>option.onclick=()=>{if(activeVoltageUnitInput)selectVoltageUnit(activeVoltageUnitInput,+option.dataset.scale,option.dataset.label)});
const voltageSuffixes={u:{scale:.000001,label:'µV'},m:{scale:.001,label:'mV'},v:{scale:1,label:'V'}};
for(const inputId of Object.keys(voltageUnitScales))$(inputId).addEventListener('keydown',event=>{const unit=voltageSuffixes[event.key.toLowerCase()];if(!unit||event.ctrlKey||event.metaKey||event.altKey)return;event.preventDefault();selectVoltageUnit(inputId,unit.scale,unit.label)});
function closeTimingUnitMenus(){for(const id of ['frequency','period']){$(id+'UnitMenu').classList.remove('open');$(id+'UnitBtn').setAttribute('aria-expanded','false')}}
function openTimingUnitMenu(kind){const button=$(kind+'UnitBtn'),menu=$(kind+'UnitMenu'),rect=button.getBoundingClientRect(),scale=kind==='frequency'?frequencyUnitScale:periodUnitScale;menu.style.left=Math.min(rect.left,innerWidth-100)+'px';menu.style.top=rect.bottom+4+'px';menu.classList.add('open');button.setAttribute('aria-expanded','true');menu.querySelectorAll('button').forEach(option=>option.setAttribute('aria-checked',String(+option.dataset.scale===scale)))}
function selectTimingUnit(kind,scale,label){if(kind==='frequency')frequencyUnitScale=scale;else periodUnitScale=scale;$(kind+'UnitBtn').textContent=label;$(kind+'Input').dispatchEvent(new Event('input',{bubbles:true}));applyProperties();closeTimingUnitMenus()}
for(const kind of ['frequency','period']){$(kind+'UnitBtn').onclick=event=>{event.stopPropagation();openTimingUnitMenu(kind)};$(kind+'UnitMenu').querySelectorAll('button').forEach(option=>option.onclick=()=>selectTimingUnit(kind,+option.dataset.scale,option.dataset.label))}
const frequencySuffixes={h:{scale:1,label:'Hz'},H:{scale:1,label:'Hz'},k:{scale:1000,label:'kHz'},K:{scale:1000,label:'kHz'},m:{scale:.001,label:'mHz'},M:{scale:1000000,label:'MHz'},g:{scale:1000000000,label:'GHz'},G:{scale:1000000000,label:'GHz'}},periodSuffixes={s:{scale:1,label:'s'},m:{scale:.001,label:'ms'},M:{scale:1000000,label:'Ms'},u:{scale:.000001,label:'µs'},U:{scale:.000001,label:'µs'},n:{scale:.000000001,label:'ns'},N:{scale:.000000001,label:'ns'}};
$('frequencyInput').addEventListener('keydown',event=>{const unit=frequencySuffixes[event.key];if(!unit||event.ctrlKey||event.metaKey||event.altKey)return;event.preventDefault();selectTimingUnit('frequency',unit.scale,unit.label)});
$('periodInput').addEventListener('keydown',event=>{const unit=periodSuffixes[event.key];if(!unit||event.ctrlKey||event.metaKey||event.altKey)return;event.preventDefault();selectTimingUnit('period',unit.scale,unit.label)});
document.addEventListener('pointerdown',event=>{if(!$('propertyContextMenu').contains(event.target))closePropertyContextMenu();if(!$('amplitudeUnitMenu').contains(event.target)&&event.target!==$('amplitudeUnitBtn'))closeAmplitudeUnitMenu();if(!$('voltageUnitMenu').contains(event.target)&&!event.target.closest?.('.voltage-unit-button'))closeVoltageUnitMenu();if(!event.target.closest?.('#frequencyUnitMenu,#periodUnitMenu,#frequencyUnitBtn,#periodUnitBtn'))closeTimingUnitMenus()});document.addEventListener('keydown',event=>{if(event.key==='Escape'){closePropertyContextMenu();closeAmplitudeUnitMenu();closeVoltageUnitMenu();closeTimingUnitMenus()}});window.addEventListener('blur',()=>{closePropertyContextMenu();closeAmplitudeUnitMenu();closeVoltageUnitMenu();closeTimingUnitMenus()});
function undoWaveform(){if(state.history.length>1){state.redo.push(state.history.pop());restoreWaveform(state.history.at(-1))}}
function redoWaveform(){if(state.redo.length){const snapshot=state.redo.pop();state.history.push(cloneWaveform(snapshot));restoreWaveform(snapshot)}}
$('undoBtn').onclick=undoWaveform;$('redoBtn').onclick=redoWaveform;
document.addEventListener('keydown',event=>{const editing=event.target.matches?.('input, textarea, select, [contenteditable="true"]');if(editing)return;const modifier=event.ctrlKey||event.metaKey;if(!modifier)return;const key=event.key.toLowerCase();if(key==='z'&&!event.shiftKey){event.preventDefault();undoWaveform()}else if((key==='z'&&event.shiftKey)||(key==='y'&&event.ctrlKey)){event.preventDefault();redoWaveform()}});
$('zoomIn').onclick=()=>{state.high*=.8;state.low*=.8;draw()};$('zoomOut').onclick=()=>{state.high*=1.25;state.low*=1.25;draw()};$('fitView').onclick=()=>{syncInputs();draw()};
$('exportBtn').onclick=()=>{const csv='time_s,voltage_v\n'+state.data.map((v,i)=>`${i/(state.samples-1)*state.duration/1000},${v}`).join('\n'),blob=new Blob([csv],{type:'text/csv'}),a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='arbdraw-waveform.csv';a.click();URL.revokeObjectURL(a.href);showToast('Waveform exported as CSV')};
new ResizeObserver(resize).observe(canvas);renderDocument();generate();
