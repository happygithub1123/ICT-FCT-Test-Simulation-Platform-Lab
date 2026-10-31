/* DiodeLab 3D - offline, dependency-free native WebGL + JavaScript
 * Educational current-source/ADC/MCU demonstration, NOT an instrument driver.
 */
'use strict';
const $ = id => document.getElementById(id);
const CFG = { target:1, compliance:12, min:5.8, max:7.3, device:'tvs', speed:1 };
const PHASES = [
  {key:'switch',time:.65,name:'继电器切换'},
  {key:'excite',time:1.7,name:'恒流源激励'},
  {key:'sample',time:1.3,name:'ADC连续采样'},
  {key:'judge',time:.55,name:'判断结果'}
];
let running=false, queue=[], direction='forward', phaseIndex=-1, phaseTime=0, totalTime=0, lastFrame=0;
let targetResult=null, measuredV=0, measuredI=0, adcCode=0, afeV=0, chartTime=0, trace=[], graphAccumulator=0, sampleAccumulator=0;
let results={forward:null,reverse:null}, elapsedSinceStart=0;
let logCounter=0;
const showDir=d=>d==='forward'?'正向 +':'反向 −';
const clamp=(v,a,b)=>Math.min(b,Math.max(a,v));
const formatV=v=>(v<0?'':'+' )+v.toFixed(3);
function log(message,type='info'){
  const wrapper=document.createElement('div');wrapper.className='logline '+type;
  const timestamp=document.createElement('span');timestamp.className='logtime';timestamp.textContent='['+String(++logCounter).padStart(2,'0')+']';
  const label=document.createElement('span');label.className='logmsg';label.textContent=message;
  wrapper.append(timestamp,label);$('eventLog').appendChild(wrapper);$('eventLog').scrollTop=$('eventLog').scrollHeight;
  if($('eventLog').children.length>100)$('eventLog').removeChild($('eventLog').firstChild);
}
function readControls(){
  CFG.target=parseFloat($('testCurrent').value)||1;
  CFG.compliance=parseFloat($('limitVoltage').value)||12;
  CFG.min=Math.max(0,Number($('specMin').value));
  CFG.max=Math.max(0,Number($('specMax').value));
  CFG.device=$('deviceType').value;
  CFG.speed=Number($('simSpeed').value)||1;
  $('currentValue').innerHTML=CFG.target.toFixed(2)+' <small>mA</small>';
  $('limitValue').innerHTML=CFG.compliance.toFixed(1)+' <small>V</small>';
  document.querySelectorAll('.goal-current').forEach(x=>x.textContent=CFG.target.toFixed(2)+' mA');
}
function setDefaultSpec(){
  let isTvs=$('deviceType').value==='tvs';
  $('specMin').value=isTvs?'5.8':'0.48';
  $('specMax').value=isTvs?'7.3':'0.85';
  $('limitHint').textContent=isTvs?'TVS 示意范围':'仅适用于正向压降';
  readControls(); rebuildMesh();
  if(!running)clearMeasurement(false);
}
// V/I model: at regulated current, idealized forward diode VF or idealized bidirectional TVS Vz.
// 1mA reverse bias for an ordinary diode is usually NOT feasible below a safe 15V ceiling.
function computeDevice(dir,cfg){
  const i=cfg.target;
  const sign=dir==='forward'?1:-1;
  let required=0, actual=i, regulated=true, reason='';
  if(cfg.device==='tvs'){
    required=6.4+0.25*Math.log(i)+(dir==='reverse'?0.06:-0.03);
  }else if(dir==='forward'){
    required=0.625+0.059*Math.log(i);
  }else{
    required=70; // illustrative ordinary diode reverse avalanche voltage well beyond selected compliance
    regulated=false;
    actual=0.000008; // mA = 8 nA leakage estimate; not a universal silicon diode specification
    reason='普通二极管在此反向限压下不导通，无法建立规定的1mA';
  }
  let voltage=required;
  if(required>cfg.compliance){
    regulated=false;
    voltage=cfg.compliance;
    if(cfg.device==='tvs')actual=Math.min(.004,Math.max(0.000001,i*Math.exp((cfg.compliance-required)/.22)));
    else if(dir==='forward') actual=Math.min(i*.01,Math.max(0.000001,i*Math.exp((cfg.compliance-required)/.025)));
    if(!reason)reason='恒流源触及电压上限，实际电流不足，测得的不是规定电流下的电压';
  }
  voltage=Math.max(.0001,voltage);
  // ADC quantization: absolute voltage is attenuated 1/5 and polarity is recorded separately.
  const voltageNoise=(Math.sin(i*10.7+(dir==='reverse'?11:0))+.4*Math.sin(i*31.5))*.002;
  const adc=clamp(Math.round(clamp((voltage+voltageNoise)/5/3.3,0,1)*1023),0,1023);
  const adcInput=adc/1023*3.3;
  const reconstructed=adcInput*5*sign;
  const passed=regulated && Math.abs(reconstructed)>=cfg.min && Math.abs(reconstructed)<=cfg.max;
  return {direction:dir,voltage:reconstructed,idealVoltage:sign*voltage,current:actual,adc,adcInput,regulated,passed,
    outcome:!regulated?'INVALID':passed?'PASS':'FAIL',reason:!regulated?reason:passed?'电流达标，电压处于设定窗口':'电流达标，但电压超出窗口',target:i};
}
function setRunningUI(on){
  document.querySelectorAll('#deviceType,#testCurrent,#limitVoltage,#specMin,#specMax,#runForward,#runReverse,#runAuto').forEach(el=>el.disabled=on);
  $('runAuto').innerHTML=on?'◉　测试进行中…':'<span>▶</span> 一键双向测试';
}
function resetStepUI(){document.querySelectorAll('.steps > div').forEach(x=>x.classList.remove('active','done'));}
function clearMeasurement(clearLog=false){
  running=false;queue=[];phaseIndex=-1;phaseTime=0;chartTime=0;graphAccumulator=0;sampleAccumulator=0;trace=[];
  results={forward:null,reverse:null};measuredV=0;measuredI=0;adcCode=0;afeV=0;
  targetResult=null;totalTime=0;direction='forward';setRunningUI(false);
  $('sceneStage').textContent='READY / 待机';$('plotCaption').textContent='等待开始采样';$('polarityText').textContent='正向 / 未开始';$('stepText').textContent='等待指令';
  const pill=$('statusPill');pill.className='status-pill idle';pill.textContent='待机 READY';
  resetStepUI();showReadings();drawGraph();renderRows();
  if(clearLog)$('eventLog').innerHTML='';
}
function setPill(text,kind){const p=$('statusPill');p.textContent=text;p.className='status-pill '+kind;}
function beginRun(modes){
  readControls();
  if(CFG.min>CFG.max){log('参数错误：最小值不得高于最大值','err');return;}
  clearMeasurement();
  running=true;queue=modes.slice();
  setRunningUI(true);log('MCU 初始化：ADC 10bit / Vref 3.3V / 衰减比1:5','info');
  log(`设置：恒流 ${CFG.target.toFixed(2)}mA，限压 ±${CFG.compliance.toFixed(1)}V，PASS窗口 ${CFG.min}～${CFG.max}V`);
  nextDirection();
}
function nextDirection(){
  if(!queue.length){finishRun();return;}
  direction=queue.shift();targetResult=computeDevice(direction,CFG);
  measuredV=0;measuredI=0;adcCode=0;afeV=0;
  phaseIndex=0;phaseTime=0;sampleAccumulator=0;
  $('polarityText').textContent=showDir(direction);
  log(`${showDir(direction)}：断开激励，继电器 K1/K2 选择极性`);
  applyPhase();
}
function applyPhase(){
  const p=PHASES[phaseIndex];
  resetStepUI();
  document.querySelectorAll('.steps > div').forEach((item,i)=>item.classList.add(i<phaseIndex?'done':i===phaseIndex?'active':'not'));
  $('sceneStage').textContent=`${direction==='forward'?'FORWARD +':'REVERSE −'} / ${p.name}`;
  $('stepText').textContent=p.name;
  $('plotCaption').textContent=`${showDir(direction)} · ${p.name}`;
  setPill('执行中 RUNNING','running');
  if(p.key==='excite')log(`打开恒流源：目标${CFG.target.toFixed(2)}mA，顺从电压上限${CFG.compliance.toFixed(1)}V`);
  if(p.key==='sample'){
    log(`电压检测前端：|V_DUT|÷5 → 3.3V/10bit ADC，${targetResult.regulated?'恒流已建立':'电源已达顺从电压上限'}`,targetResult.regulated?'info':'warn');
  }
  if(p.key==='judge'){
    log(`ADC=${targetResult.adc}；重建电压=${formatV(targetResult.voltage)}V；实际电流=${targetResult.current.toFixed(6)}mA`);
  }
}
function updateRun(dt){
  if(!running)return;
  dt=Math.min(dt,.08)*CFG.speed;totalTime+=dt;phaseTime+=dt;chartTime+=dt;
  const p=PHASES[phaseIndex];
  let vScale=0;
  if(phaseIndex===0)vScale=0;
  if(phaseIndex===1)vScale=1-Math.exp(-5.2*clamp(phaseTime/p.time,0,1));
  if(phaseIndex>=2)vScale=1;
  measuredV=targetResult.voltage*vScale;
  measuredI=targetResult.current*vScale;
  afeV=Math.abs(measuredV)/5;
  adcCode=clamp(Math.round(afeV/3.3*1023),0,1023);
  graphAccumulator+=dt;
  if(graphAccumulator>=.045){
    graphAccumulator=0;trace.push({time:chartTime,v:measuredV,direction});
    if(trace.length>600)trace.shift();
    drawGraph();
  }
  if(p.key==='sample'){
    sampleAccumulator+=dt;
    if(sampleAccumulator>=.24){sampleAccumulator=0;log(`ADC采样：${adcCode}/1023，AFE=${afeV.toFixed(3)}V，DUT=${formatV(measuredV)}V`);}
  }
  showReadings();
  if(phaseTime>=p.time){
    phaseIndex++;phaseTime=0;
    if(phaseIndex>=PHASES.length){
      const r=targetResult;results[direction]=r;
      log(`${showDir(direction)}测试结束：${r.outcome}；${r.reason}`,r.outcome==='PASS'?'ok':r.outcome==='FAIL'?'err':'warn');
      renderRows();
      if(queue.length){trace.push({time:chartTime,v:NaN,direction});nextDirection();}
      else finishRun();
    }else applyPhase();
  }
}
function finishRun(){
  running=false;phaseIndex=-1;setRunningUI(false);resetStepUI();
  const done=Object.values(results).filter(Boolean),invalid=done.some(x=>x.outcome==='INVALID'),fail=done.some(x=>x.outcome==='FAIL'),pass=done.every(x=>x.outcome==='PASS');
  const kind=invalid?'invalid':fail?'fail':pass?'pass':'idle';
  setPill(invalid?'部分数据无效':fail?'判定 FAIL':pass?'判定 PASS':'待机 READY',kind);
  $('sceneStage').textContent=invalid?'COMPLIANCE LIMIT':fail?'MEASUREMENT FAIL':'TEST COMPLETE';
  $('stepText').textContent='测试完成';$('plotCaption').textContent='采集完成 · 可修改参数重新测试';
  log('测试结束，继电器断开激励，建议对DUT放电','ok');
  renderRows();
}
function renderRows(){
  for(let dir of ['forward','reverse']){
    let row=$(dir+'Row'),r=results[dir];
    row.querySelector('.goal-current').textContent=CFG.target.toFixed(2)+' mA';
    row.querySelector('.got-current').textContent=r?(r.current<.001?(r.current*1000).toFixed(3)+' μA':r.current.toFixed(4)+' mA'):'—';
    row.querySelector('.got-voltage').textContent=r?formatV(r.voltage)+' V':'—';
    row.querySelector('.got-result').innerHTML=r?`<span class="result-${r.outcome.toLowerCase()}">${r.outcome==='INVALID'?'无效 / 未达电流':r.outcome}</span>`:'<span class="result-empty">未测试</span>';
  }
  const done=Object.values(results).filter(Boolean);
  let summary='尚无测试结果。反向普通二极管可能达到电源限压，不能将限压误认为反向击穿电压。';
  if(done.length){
    summary=done.map(r=>`${showDir(r.direction)}：${r.outcome==='INVALID'?'无效':r.outcome}（${r.reason}）`).join('　｜　');
    if(CFG.device==='tvs')summary+='。提示：TVS示意模型参数仅作教学，不能替代具体型号的Vrwm/Vbr/Ipp规格。';
  }
  $('reportSummary').textContent=summary;
}
function showReadings(){
  $('voltageReading').textContent=formatV(measuredV);
  $('actualCurrent').innerHTML=(measuredI<.001?measuredI.toFixed(6):measuredI.toFixed(4))+' <small>mA</small>';
  $('adcReading').innerHTML=adcCode+' <small>/ 1023</small>';
  $('afeReading').innerHTML=afeV.toFixed(3)+' <small>V</small>';
  $('meterFill').style.width=clamp(Math.abs(measuredV)/Math.max(CFG.compliance,1)*100,0,100)+'%';
}
function drawGraph(){
  const canvas=$('waveChart'),r=canvas.getBoundingClientRect();
  if(r.width<1||r.height<1)return;
  const dpr=Math.min(devicePixelRatio||1,2);canvas.width=Math.round(r.width*dpr);canvas.height=Math.round(r.height*dpr);
  const ctx=canvas.getContext('2d');ctx.scale(dpr,dpr);
  const w=r.width,h=r.height,pl=46,pr=17,pt=17,pb=30,plotW=w-pl-pr,plotH=h-pt-pb;
  ctx.clearRect(0,0,w,h);
  const data=trace.filter(q=>Number.isFinite(q.v));
  let extreme=Math.max(1,CFG.max+1,Math.abs(measuredV)+.6);
  if(data.length)extreme=Math.max(extreme,...data.map(q=>Math.abs(q.v)));
  const hasNeg=trace.some(q=>q.direction==='reverse'&&Number.isFinite(q.v));
  let ymin=hasNeg?-Math.ceil(extreme*1.15):-.35;
  let ymax=Math.ceil(extreme*1.15);
  const T=Math.max(4,chartTime+.45);
  const mapX=t=>pl+plotW*t/T;
  const mapY=v=>pt+plotH*(ymax-v)/(ymax-ymin);
  ctx.font='10px ui-monospace,monospace';ctx.lineWidth=1;
  for(let i=0;i<=4;i++){
    let v=ymin+(ymax-ymin)*i/4,yy=mapY(v);
    ctx.strokeStyle='rgba(118,153,194,.13)';ctx.beginPath();ctx.moveTo(pl,yy);ctx.lineTo(w-pr,yy);ctx.stroke();
    ctx.fillStyle='#758fa8';ctx.textAlign='right';ctx.fillText(v.toFixed(1),pl-9,yy+3);
  }
  for(let i=0;i<=5;i++){
    let t=T*i/5,x=mapX(t);ctx.strokeStyle='rgba(118,153,194,.09)';ctx.beginPath();ctx.moveTo(x,pt);ctx.lineTo(x,h-pb);ctx.stroke();
    ctx.fillStyle='#71869f';ctx.textAlign='center';ctx.fillText(t.toFixed(1),x,h-11);
  }
  ctx.strokeStyle='#58839a';ctx.setLineDash([4,4]);ctx.beginPath();ctx.moveTo(pl,mapY(0));ctx.lineTo(w-pr,mapY(0));ctx.stroke();ctx.setLineDash([]);
  for(let dir of ['forward','reverse']){
    let color=dir==='forward'?'#4ce1f5':'#f5b673';
    const vals=trace.filter(q=>q.direction===dir&&Number.isFinite(q.v));
    if(vals.length<2)continue;
    ctx.beginPath();ctx.moveTo(mapX(vals[0].time),mapY(vals[0].v));
    for(let i=1;i<vals.length;i++)ctx.lineTo(mapX(vals[i].time),mapY(vals[i].v));
    ctx.strokeStyle=color;ctx.lineWidth=2.6;ctx.shadowColor=color;ctx.shadowBlur=7;ctx.stroke();ctx.shadowBlur=0;
    const last=vals[vals.length-1];ctx.fillStyle=color;ctx.beginPath();ctx.arc(mapX(last.time),mapY(last.v),3.5,0,Math.PI*2);ctx.fill();
  }
  if(!data.length){ctx.fillStyle='#60778f';ctx.textAlign='center';ctx.font='12px system-ui';ctx.fillText('启动测试后，这里实时绘制采样电压曲线',w/2,h/2);}
}

// ── Minimal native WebGL engine: real 3D geometry, perspective, orbit camera, per-face lighting.
const glCanvas=$('glScene'),overCanvas=$('labelScene'),holder=$('sceneFrame');
let gl=null,fallbackCtx=null,program=null,bufPos=null,bufNormal=null,bufCol=null,vertexCount=0;
const geom={p:[],n:[],c:[]};
let yaw=-.52,pitch=.82,radius=11.8,dragging=false,dragX=0,dragY=0;
function clr(hex){hex=hex.replace('#','');return [parseInt(hex.slice(0,2),16)/255,parseInt(hex.slice(2,4),16)/255,parseInt(hex.slice(4,6),16)/255];}
function addTri(a,b,c,color){
  const u=[b[0]-a[0],b[1]-a[1],b[2]-a[2]],v=[c[0]-a[0],c[1]-a[1],c[2]-a[2]];
  const cross=[u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]],m=Math.hypot(...cross)||1;
  for(const pt of [a,b,c]){geom.p.push(...pt);geom.n.push(...cross.map(z=>z/m));geom.c.push(...color);}
}
function quad(a,b,c,d,col){addTri(a,b,c,col);addTri(a,c,d,col);}
function box(x,y,z,w,h,d,color){
  const col=clr(color),x0=x-w/2,x1=x+w/2,y0=y-h/2,y1=y+h/2,z0=z-d/2,z1=z+d/2;
  let A=[x0,y0,z0],B=[x1,y0,z0],C=[x1,y0,z1],D=[x0,y0,z1],E=[x0,y1,z0],F=[x1,y1,z0],G=[x1,y1,z1],H=[x0,y1,z1];
  quad(E,H,G,F,col);quad(D,A,B,C,col);quad(A,E,F,B,col);quad(B,F,G,C,col);quad(C,G,H,D,col);quad(D,H,E,A,col);
}
function cylinderX(x,y,z,len,r,color,segments=16){const col=clr(color);for(let i=0;i<segments;i++){
 let t=i*Math.PI*2/segments,n=(i+1)*Math.PI*2/segments;
 let a=[x-len/2,y+Math.sin(t)*r,z+Math.cos(t)*r],b=[x+len/2,y+Math.sin(t)*r,z+Math.cos(t)*r],c=[x+len/2,y+Math.sin(n)*r,z+Math.cos(n)*r],d=[x-len/2,y+Math.sin(n)*r,z+Math.cos(n)*r];
 quad(a,b,c,d,col);addTri([x-len/2,y,z],d,a,col);addTri([x+len/2,y,z],b,c,col);
}}
function cylY(x,y,z,height,r,color,segments=18){const col=clr(color);for(let i=0;i<segments;i++){
 let t=i*2*Math.PI/segments,n=(i+1)*2*Math.PI/segments;
 let a=[x+r*Math.cos(t),y-height/2,z+r*Math.sin(t)],b=[x+r*Math.cos(t),y+height/2,z+r*Math.sin(t)],c=[x+r*Math.cos(n),y+height/2,z+r*Math.sin(n)],d=[x+r*Math.cos(n),y-height/2,z+r*Math.sin(n)];
 quad(a,b,c,d,col);addTri([x,y+height/2,z],b,c,col);
}}
function beam(a,b,width,height,color){
 const dx=b[0]-a[0],dz=b[2]-a[2],len=Math.hypot(dx,dz),nx=-dz/len*width/2,nz=dx/len*width/2,y=(a[1]+b[1])/2;
 if(len<.001)return;
 const x0=a[0],x1=b[0],z0=a[2],z1=b[2],c=clr(color),h=height/2;
 const t0=[x0+nx,y+h,z0+nz],t1=[x1+nx,y+h,z1+nz],t2=[x1-nx,y+h,z1-nz],t3=[x0-nx,y+h,z0-nz];
 quad(t0,t1,t2,t3,c);quad([x0-nx,y-h,z0-nz],[x1-nx,y-h,z1-nz],[x1-nx,y+h,z1-nz],[x0-nx,y+h,z0-nz],c);
}
const positiveRoute=[[-3,.22,-.35],[-2.45,.22,-.35],[-2.45,.22,-.8],[-1.05,.22,-.8],[-.55,.22,-.32],[.36,.22,-.32]];
const returnRoute=[[1.56,.22,-.32],[2.1,.22,-1.6],[-3.05,.22,-1.6],[-3.05,.22,-.88]];
const senseRoute=[[1.45,.22,.26],[1.8,.22,1.3],[2.7,.22,1.3],[3.4,.22,.62]];
const labels=[
  {p:[-3.8,1.30,-.25],title:'CCS',sub:'恒流源 1mA'},
  {p:[-1.65,1.20,-1.24],title:'K1 / K2',sub:'极性切换继电器'},
  {p:[.96,1.10,-.43],title:'DUT',sub:'双向TVS / 二极管'},
  {p:[2.5,1.06,1.42],title:'AFE',sub:'÷5 / ADC保护'},
  {p:[3.9,1.15,-.78],title:'MCU',sub:'STC12C5A60S2'}
];
function rebuildMesh(){
  geom.p.length=0;geom.n.length=0;geom.c.length=0;
  // PCB base and raised frame
  box(0,-.15,0,10.45,.28,6.1,'#11475a');box(0,-.009,0,10.18,.03,5.82,'#174c58');
  box(0,-.29,-2.99,10.4,.08,.08,'#0a9a99');box(0,-.29,2.99,10.4,.08,.08,'#0a9a99');
  // connector pads and plated screw sockets
  for(let x of [-4.85,4.85])for(let z of [-2.6,2.6]){cylY(x,.045,z,.035,.24,'#638a8d',24);cylY(x,.07,z,.04,.115,'#132534',20);}
  // copper points/tracks
  for(const route of [positiveRoute,returnRoute])for(let i=0;i<route.length-1;i++)beam(route[i],route[i+1],.065,.022,'#cc9754');
  for(let i=0;i<senseRoute.length-1;i++)beam(senseRoute[i],senseRoute[i+1],.045,.014,'#64e4be');
  for(let x=-4.6;x<=4.6;x+=.8)for(let z of [-2.65,2.65])box(x,.025,z,.24,.015,.14,'#285a67');
  // current source block with black control panel
  box(-3.8,.48,-.3,1.95,.87,1.7,'#bacad4');box(-3.8,.941,-.3,1.72,.07,1.49,'#182d3c');box(-3.86,.983,-.28,1.04,.02,.46,'#1a6472');
  for(let z of [-.89,-.42,.1,.57])box(-4.61,.94,z,.1,.08,.1,'#e6af6c');
  // Relay group
  box(-1.73,.38,-1.24,1.02,.68,.77,'#26527a');box(-1.73,.735,-1.24,.88,.025,.64,'#307ca6');
  box(-1.73,.38,.56,1.02,.68,.77,'#26527a');box(-1.73,.735,.56,.88,.025,.64,'#307ca6');
  for(let z of [-1.58,-.91,.22,.9])for(let x of [-2.12,-1.3])box(x,.09,z,.16,.13,.095,'#afc4d0');
  // diode footprint and DUT; 3D actual package changes on selection
  box(.98,.06,-.32,2.2,.1,.95,'#163746');
  for(let x of [.1,1.86])box(x,.135,-.32,.38,.075,.70,'#c79b5b');
  if(CFG.device==='tvs'){
    box(.98,.36,-.32,1.30,.42,.70,'#151b25');box(.98,.59,-.32,1.13,.05,.55,'#232d3b');
    box(.24,.29,-.32,.25,.27,.69,'#bcc0c4');box(1.72,.29,-.32,.25,.27,.69,'#bcc0c4');
    box(.42,.609,-.32,.085,.012,.47,'#e1e8eb');
  }else{
    cylinderX(.98,.37,-.32,1.25,.25,'#121822',24);
    cylinderX(1.44,.37,-.32,.095,.254,'#e3e4d7',24);
    cylinderX(.04,.37,-.32,.7,.07,'#b1c1d0');cylinderX(1.93,.37,-.32,.64,.07,'#b1c1d0');
  }
  // AFE chip and support resistors
  box(2.66,.30,1.37,1.36,.52,.98,'#263d46');box(2.66,.585,1.37,1.15,.06,.79,'#2b6d6c');
  for(let i=0;i<5;i++){box(2.05+i*.26,.06,2.09,.15,.12,.3,'#af8c5a');box(2.05+i*.26,.06,.7,.16,.12,.28,'#aec6c3');}
  // MCU QFP
  box(3.75,.31,-.8,1.42,.42,1.46,'#181d28');box(3.75,.533,-.8,1.16,.035,1.17,'#222b38');
  for(let i=0;i<8;i++){
    const o=-.62+i*.18;
    box(3.75+o,.12,-1.55,.11,.06,.22,'#b5b9c6');box(3.75+o,.12,-.05,.11,.06,.22,'#b5b9c6');
    box(3.0,.12,-.8+o,.22,.06,.11,'#b5b9c6');box(4.5,.12,-.8+o,.22,.06,.11,'#b5b9c6');
  }
  // debug UART connectors and test terminal structures
  for(let x of [-3.7,3.7])for(let j=0;j<4;j++)box(x+j*.23-0.35,.17,2.45,.16,.27,.24,'#b8a36b');
  box(-.75,.17,2.2,1.5,.28,.62,'#344752');box(-.75,.32,2.2,1.28,.035,.44,'#111e2f');
  for(let x=-4.4;x<=4.4;x+=1.55)for(let z of [-2.15,2.15])box(x,.02,z,.32,.015,.04,'#678b8b');
  vertexCount=geom.p.length/3;
  if(gl){
    gl.bindBuffer(gl.ARRAY_BUFFER,bufPos);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array(geom.p),gl.STATIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER,bufNormal);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array(geom.n),gl.STATIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER,bufCol);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array(geom.c),gl.STATIC_DRAW);
  }
}
function matMul(a,b){const out=new Float32Array(16);for(let c=0;c<4;c++)for(let r=0;r<4;r++){let v=0;for(let k=0;k<4;k++)v+=a[k*4+r]*b[c*4+k];out[c*4+r]=v;}return out;}
function perspective(fov,aspect,n,f){const t=1/Math.tan(fov/2),o=new Float32Array(16);o[0]=t/aspect;o[5]=t;o[10]=(f+n)/(n-f);o[11]=-1;o[14]=2*f*n/(n-f);return o;}
function lookAt(eye,target){const norm=v=>{let n=Math.hypot(...v)||1;return v.map(x=>x/n);};let z=norm(eye.map((x,i)=>x-target[i]));let x=norm([z[2],0,-z[0]]);let y=[z[1]*x[2]-z[2]*x[1],z[2]*x[0]-z[0]*x[2],z[0]*x[1]-z[1]*x[0]];let out=new Float32Array(16);out.set([x[0],y[0],z[0],0,x[1],y[1],z[1],0,x[2],y[2],z[2],0,-x.reduce((s,k,i)=>s+k*eye[i],0),-y.reduce((s,k,i)=>s+k*eye[i],0),-z.reduce((s,k,i)=>s+k*eye[i],0),1]);return out;}
function makeShader(type,source){const s=gl.createShader(type);gl.shaderSource(s,source);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw Error(gl.getShaderInfoLog(s));return s;}
function init3D(){
  try{
    gl=glCanvas.getContext('webgl',{antialias:true,alpha:false,preserveDrawingBuffer:false});
    if(!gl)throw Error('WebGL不可用');
    const v=makeShader(gl.VERTEX_SHADER,`attribute vec3 p; attribute vec3 n; attribute vec3 c; uniform mat4 m; varying vec3 col; void main(){vec3 light=normalize(vec3(-0.7,1.1,0.8));float diffuse=max(dot(n,light),0.0); col=c*(0.43+0.62*diffuse);gl_Position=m*vec4(p,1.0);}`);
    const f=makeShader(gl.FRAGMENT_SHADER,`precision mediump float; varying vec3 col; void main(){gl_FragColor=vec4(col,1.0);}`);
    program=gl.createProgram();gl.attachShader(program,v);gl.attachShader(program,f);gl.linkProgram(program);
    if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw Error(gl.getProgramInfoLog(program));
    bufPos=gl.createBuffer();bufNormal=gl.createBuffer();bufCol=gl.createBuffer();
    gl.enable(gl.DEPTH_TEST);gl.depthFunc(gl.LEQUAL);rebuildMesh();
  }catch(e){console.warn('WebGL unavailable; falling back to software 3D projection:',e.message);gl=null;fallbackCtx=glCanvas.getContext('2d');$('glFallback').hidden=true;rebuildMesh();document.querySelector('.scene-corner').textContent='CANVAS 3D COMPATIBILITY RENDERER';}
}
function scaleCanvas(canvas){const rect=canvas.getBoundingClientRect(),dpr=Math.min(devicePixelRatio||1,2),w=Math.round(rect.width*dpr),h=Math.round(rect.height*dpr);if(canvas.width!==w||canvas.height!==h){canvas.width=w;canvas.height=h;}return {w,h,dpr};}
let currentVP=null;
function project(pt,w,h){if(!currentVP)return null;const m=currentVP,x=pt[0],y=pt[1],z=pt[2],a=m[0]*x+m[4]*y+m[8]*z+m[12],b=m[1]*x+m[5]*y+m[9]*z+m[13],d=m[3]*x+m[7]*y+m[11]*z+m[15];if(d<=.01)return null;return {x:(a/d*.5+.5)*w,y:(.5-b/d*.5)*h,depth:d};}
function pill(ctx,x,y,t,sub){
  ctx.font='700 12px ui-monospace,Consolas,monospace';const width=Math.max(ctx.measureText(t).width,ctx.measureText(sub).width)+22,height=37;
  x=clamp(x-width/2,width/2+6,ctx.canvas.clientWidth-width/2-6);y=clamp(y,9,ctx.canvas.clientHeight-height-5);
  ctx.fillStyle='rgba(9,22,36,.87)';ctx.strokeStyle='rgba(85,161,195,.45)';ctx.lineWidth=1;
  ctx.beginPath();ctx.roundRect(x-width/2,y,width,height,6);ctx.fill();ctx.stroke();
  ctx.textAlign='center';ctx.fillStyle='#c9edff';ctx.font='700 11px ui-monospace,monospace';ctx.fillText(t,x,y+14);
  ctx.font='10px "Microsoft YaHei",system-ui';ctx.fillStyle='#8bb6c8';ctx.fillText(sub,x,y+29);
}
function interpRoute(route,t){let lens=[],total=0;for(let i=0;i<route.length-1;i++){let a=route[i],b=route[i+1],len=Math.hypot(a[0]-b[0],a[1]-b[1],a[2]-b[2]);lens.push(len);total+=len;}let at=(t%1+1)%1*total;for(let i=0;i<lens.length;i++){if(at<=lens[i]||i===lens.length-1){let f=at/lens[i],a=route[i],b=route[i+1];return a.map((x,j)=>x+(b[j]-x)*f);}at-=lens[i];}return route[0];}
let lastCpuDraw=-100;
function drawCanvas3DFallback(info,time){
  if(!fallbackCtx||time-lastCpuDraw<34)return;
  lastCpuDraw=time;
  const ctx=fallbackCtx,w=info.w/info.dpr,h=info.h/info.dpr;
  ctx.setTransform(info.dpr,0,0,info.dpr,0,0);ctx.clearRect(0,0,w,h);
  const grad=ctx.createRadialGradient(w*.47,h*.48,8,w*.5,h*.5,w*.63);
  grad.addColorStop(0,'#1a3043');grad.addColorStop(1,'#0a1421');ctx.fillStyle=grad;ctx.fillRect(0,0,w,h);
  let faces=[];
  const light=[-.38,.72,.52];
  for(let i=0;i<geom.p.length;i+=9){
    const a=project(geom.p.slice(i,i+3),w,h),b=project(geom.p.slice(i+3,i+6),w,h),c=project(geom.p.slice(i+6,i+9),w,h);
    if(!a||!b||!c)continue;
    if(Math.max(a.x,b.x,c.x)<-20||Math.min(a.x,b.x,c.x)>w+20||Math.max(a.y,b.y,c.y)<-20||Math.min(a.y,b.y,c.y)>h+20)continue;
    const nx=geom.n[i],ny=geom.n[i+1],nz=geom.n[i+2],shade=.42+.63*Math.max(0,nx*light[0]+ny*light[1]+nz*light[2]);
    const r=Math.round(geom.c[i]*255*shade),g=Math.round(geom.c[i+1]*255*shade),bb=Math.round(geom.c[i+2]*255*shade);
    faces.push({a,b,c,depth:(a.depth+b.depth+c.depth)/3,color:`rgb(${r},${g},${bb})`});
  }
  faces.sort((a,b)=>b.depth-a.depth);
  for(const f of faces){
    ctx.fillStyle=f.color;ctx.beginPath();ctx.moveTo(f.a.x,f.a.y);ctx.lineTo(f.b.x,f.b.y);ctx.lineTo(f.c.x,f.c.y);ctx.closePath();ctx.fill();
  }
}
function render3D(t){
  const a=scaleCanvas(glCanvas),b=scaleCanvas(overCanvas);
  const angle=running?yaw:yaw+.018*Math.sin(t*.00024);
  const eye=[radius*Math.cos(pitch)*Math.sin(angle),radius*Math.sin(pitch),radius*Math.cos(pitch)*Math.cos(angle)];
  currentVP=matMul(perspective(Math.PI/4,a.w/Math.max(1,a.h),.05,120),lookAt(eye,[0,.12,0]));
  if(gl){gl.viewport(0,0,a.w,a.h);gl.clearColor(.044,.078,.125,1);gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);gl.useProgram(program);gl.uniformMatrix4fv(gl.getUniformLocation(program,'m'),false,currentVP);
    for(let [key,buf] of [['p',bufPos],['n',bufNormal],['c',bufCol]]){const loc=gl.getAttribLocation(program,key);gl.bindBuffer(gl.ARRAY_BUFFER,buf);gl.enableVertexAttribArray(loc);gl.vertexAttribPointer(loc,3,gl.FLOAT,false,0,0);}
    gl.drawArrays(gl.TRIANGLES,0,vertexCount);
  }else drawCanvas3DFallback(a,t);
  const ctx=overCanvas.getContext('2d');const rw=b.w/b.dpr,rh=b.h/b.dpr;ctx.setTransform(b.dpr,0,0,b.dpr,0,0);ctx.clearRect(0,0,rw,rh);
  // PCB edge perspective guide, 3D terminal/name labels
  labels.forEach((L,i)=>{
    const pt=project(L.p,rw,rh);if(!pt)return;
    const title=i===2?(CFG.device==='tvs'?'DUT / TVS':'DUT / DIODE'):L.title;
    pill(ctx,pt.x,pt.y-42,title,L.sub);
    ctx.strokeStyle='rgba(92,193,222,.3)';ctx.beginPath();ctx.moveTo(pt.x,pt.y-6);ctx.lineTo(pt.x,pt.y+10);ctx.stroke();
  });
  if(running&&phaseIndex>=1){
    const val=Math.abs(measuredI)/Math.max(CFG.target,.001);
    const density=targetResult?.regulated?17:8;
    const speed=(direction==='forward'?1:-1)*(0.12+0.17*clamp(val,0,1));
    const flow=(t/1000*speed)%1;
    let rr=positiveRoute.concat(returnRoute);
    for(let i=0;i<density;i++){
      let pt=project(interpRoute(rr,flow+i/density),rw,rh);if(!pt)continue;
      const alpha=.34+.66*clamp(val,0,1);
      ctx.beginPath();ctx.fillStyle=`rgba(71,223,245,${alpha})`;ctx.shadowColor='#5be5ff';ctx.shadowBlur=12;ctx.arc(pt.x,pt.y,clamp(4.0*13/pt.depth,1.8,5),0,Math.PI*2);ctx.fill();ctx.shadowBlur=0;
    }
    // measurement/sense signal flows to ADC, then MCU (warm amber)
    for(let i=0;i<7;i++){
      let p=project(interpRoute(senseRoute,((t/1000)*.18+i/7)%1),rw,rh);if(!p)continue;
      ctx.beginPath();ctx.fillStyle='rgba(244,187,104,.85)';ctx.shadowColor='#ecac61';ctx.shadowBlur=8;ctx.arc(p.x,p.y,2.3,0,Math.PI*2);ctx.fill();ctx.shadowBlur=0;
    }
  }
}
function initOrbit(){
  holder.addEventListener('pointerdown',e=>{if(e.target.tagName==='CANVAS'){dragging=true;dragX=e.clientX;dragY=e.clientY;holder.setPointerCapture(e.pointerId);}});
  holder.addEventListener('pointermove',e=>{if(!dragging)return;let dx=e.clientX-dragX,dy=e.clientY-dragY;dragX=e.clientX;dragY=e.clientY;yaw+=dx*.0065;pitch=clamp(pitch+dy*.0045,.19,1.46);});
  holder.addEventListener('pointerup',()=>dragging=false);holder.addEventListener('pointercancel',()=>dragging=false);
  holder.addEventListener('wheel',e=>{e.preventDefault();radius=clamp(radius+e.deltaY*.011,8.5,24);},{passive:false});
  holder.addEventListener('dblclick',()=>{yaw=-.52;pitch=.82;radius=11.8;});
}
function frame(time){
  const dt=lastFrame?Math.min((time-lastFrame)/1000,.1):0;lastFrame=time;
  updateRun(dt);render3D(time);
  requestAnimationFrame(frame);
}
function start(){
  $('deviceType').addEventListener('change',setDefaultSpec);
  for(let el of ['testCurrent','limitVoltage','specMin','specMax','simSpeed']){
    $(el).addEventListener('input',()=>{readControls();renderRows();drawGraph();});
  }
  $('runAuto').addEventListener('click',()=>beginRun(['forward','reverse']));
  $('runForward').addEventListener('click',()=>beginRun(['forward']));
  $('runReverse').addEventListener('click',()=>beginRun(['reverse']));
  $('resetBtn').addEventListener('click',()=>{clearMeasurement();log('系统复位：清空测量状态及曲线');});
  $('clearLog').addEventListener('click',()=>{$('eventLog').innerHTML='';logCounter=0;});
  readControls();init3D();initOrbit();clearMeasurement();
  log('DiodeLab 已加载：3D测试台 / 继电器 / MCU ADC 仿真已就绪','ok');
  log('建议先选双向TVS，点击“一键双向测试”观察曲线和电流流向');
  log('注意：模拟数据不等于真实测量；测试规范必须以器件数据手册为准','warn');
  requestAnimationFrame(frame);
  window.addEventListener('resize',drawGraph);
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start);else start();
