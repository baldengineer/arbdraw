const canvas = document.querySelector('#waveCanvas');
const ctx = canvas.getContext('2d');
const state = { type:'sine', tool:'pencil', high:5, low:-5, duration:1, cycles:3, phase:0, duty:50, samples:1024, zoom:1, data:[], history:[], redo:[], drawing:false, lineStart:null };
const titles = {sine:'Sine wave',square:'Square wave',triangle:'Triangle wave',ramp:'Ramp wave',pulse:'Pulse wave',dc:'DC level',noise:'White noise',free:'Custom waveform'};
const $ = id => document.getElementById(id);

function setTheme(theme) {
  document.documentElement.dataset.theme=theme;
  localStorage.setItem('arbdraw-theme',theme);
  document.querySelectorAll('.theme-option').forEach(button=>button.classList.toggle('active',button.dataset.theme===theme));
}
setTheme(localStorage.getItem('arbdraw-theme')||'dark');
document.querySelectorAll('.theme-option').forEach(button=>button.addEventListener('click',()=>setTheme(button.dataset.theme)));

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
function syncInputs(){state.high=+$('highInput').value;state.low=+$('lowInput').value;if(state.high<=state.low)state.high=state.low+.1;state.duration=+$('durationInput').value;state.cycles=+$('cyclesInput').value;state.phase=+$('phaseInput').value;state.duty=+$('dutyInput').value;state.samples=+$('samplesInput').value;$('amplitudeInput').value=(state.high-state.low).toFixed(1);$('offsetInput').value=((state.high+state.low)/2).toFixed(1);$('dutyValue').textContent=state.duty+'%';$('sampleStatus').textContent=state.samples.toLocaleString();$('durationStatus').textContent=state.duration.toFixed(3)+' ms';$('rateStatus').textContent=(state.samples/state.duration/1000).toFixed(3)+' MSa/s';}
$('applyBtn').onclick=()=>{syncInputs();generate()};$('dutyInput').oninput=()=>{$('dutyValue').textContent=$('dutyInput').value+'%'};
$('amplitudeInput').onchange=()=>{const mid=(+$('highInput').value + +$('lowInput').value)/2,a=+$('amplitudeInput').value/2;$('highInput').value=mid+a;$('lowInput').value=mid-a};$('offsetInput').onchange=()=>{const a=(+$('highInput').value - +$('lowInput').value)/2,m=+$('offsetInput').value;$('highInput').value=m+a;$('lowInput').value=m-a};
$('undoBtn').onclick=()=>{if(state.history.length>1){state.redo.push(state.history.pop());state.data=[...state.history.at(-1)];draw()}};$('redoBtn').onclick=()=>{if(state.redo.length){state.data=state.redo.pop();state.history.push([...state.data]);draw()}};
$('zoomIn').onclick=()=>{state.high*=.8;state.low*=.8;draw()};$('zoomOut').onclick=()=>{state.high*=1.25;state.low*=1.25;draw()};$('fitView').onclick=()=>{syncInputs();draw()};
$('exportBtn').onclick=()=>{const csv='time_s,voltage_v\n'+state.data.map((v,i)=>`${i/(state.samples-1)*state.duration/1000},${v}`).join('\n'),blob=new Blob([csv],{type:'text/csv'}),a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='arbdraw-waveform.csv';a.click();URL.revokeObjectURL(a.href);$('toast').classList.add('show');setTimeout(()=>$('toast').classList.remove('show'),2200)};
new ResizeObserver(resize).observe(canvas);syncInputs();generate();
