/* DiodeLab 3D v2: Offline real 3D + signed TVS limits + educational ADC state machine.
 * NOT a physical accuracy simulator; no real hardware is being accessed.
 */
'use strict';
const $ = id => document.getElementById(id);
const clamp = (v,a,b) => Math.min(b,Math.max(a,v));
const showDir = d => d==='forward' ? '正向 +' : '反向 −';
const formatV = v => (v<0?'':'+' ) + v.toFixed(3);
const MODELS={
  esd:{name:'ESD245-B1-W0201',form:'bidirectional',f:6.43,r:6.52,limits:[[5.8,8.1],[-8.1,-5.8]],info:'D500 专用：按当前FCT截图的 ±1mA / 12V、正向5.8–8.1V和反向−8.1–−5.8V进行演示；器件结构推测为双向ESD，仍需数据手册确认。',iv:'双向ESD/TVS：两个极性都存在近似击穿拐点。紫色特效表示可控钳位，不代表器件被击坏。'},
  tvs:{name:'双向TVS · 教学模型',form:'bidirectional',f:9.35,r:9.28,limits:[[8.5,10.5],[-10.5,-8.5]],info:'双向TVS：正负极性均存在浪涌钳位区，标称点是教学假设，具体VBR由手册中的测试电流规定。',iv:'双向对称的雪崩击穿模型。在达到钳位区后，即使电流变大，电压变化仍相对较小。'},
  unidirectional:{name:'单向TVS · 教学模型',form:'unidirectional',f:.72,r:8.45,limits:[[.48,.95],[-9.4,-7.5]],info:'单向TVS：一侧是常规PN结正向导通，另一侧是反向雪崩钳位。',iv:'单向TVS不对称：正向是约0.7V的二极管导通，反向是高电压击穿。'},
  zener:{name:'稳压二极管 Zener',form:'zener',f:.70,r:5.15,limits:[[.52,.89],[-5.6,-4.7]],info:'稳压二极管：正向像普通硅二极管；反向达到稳定区后电压接近Vz（只是教学曲线）。',iv:'Zener：正向PN结导通；反向齐纳/雪崩区域工作，典型近似V_z。'},
  diode:{name:'普通硅整流二极管',form:'diode',f:.65,r:null,limits:[[.48,.86],null],info:'普通硅二极管：正向可测VF；反向在12V限压下通常只能看到漏电，不应强行解释为击穿电压。',iv:'常规PN结二极管正向导通，反向测试主要测漏电。1mA反向击穿不应强制测试。'},
  signal:{name:'小信号开关二极管',form:'diode',f:.61,r:null,limits:[[.43,.83],null],info:'小信号二极管：正向导通压降可测，反向1mA通常需要危险的较高电压，演示为未达电流。',iv:'小信号二极管在较小电流下导通压降较低；反向在此限制下仅有微小漏电。'},
  schottky:{name:'肖特基二极管',form:'schottky',f:.31,r:null,limits:[[.15,.46],null],info:'肖特基：正向压降低，但反向漏电可能高于普通PN结；器件参数随型号变化很大。',iv:'肖特基在低正向电压就能导通，反向通常以漏电测试而不是强制1mA击穿测试。'},
  led:{name:'LED 发光二极管',form:'led',f:1.93,r:null,limits:[[1.65,2.25],null],info:'LED正向导通时会发光；普通LED的反向耐压可能很低，不应直接施加12V/1mA反向激励。',iv:'LED顺向导通压降取决于材料/波长。反向测试限制必须查手册，演示将其标记为禁止的无效测量。'},
  photodiode:{name:'光电二极管',form:'photodiode',f:.60,r:null,limits:[[.40,.82],null],info:'光电二极管通常测试光电流和反向漏电，而不是在反向强制1mA；本模型只模拟正向导通。',iv:'光电二极管反向电流随照度变化；此页面不伪造光照响应或反向击穿规格。'}
};
const CFG={target:1,compliance:12,device:'esd',speed:1,fMin:5.8,fMax:8.1,rMin:-8.1,rMax:-5.8,fault:'normal'};
const PHASES=[{key:'switch',time:.62,name:'断流 / 继电器切换'},{key:'excite',time:1.5,name:'恒流源启动与钳位响应'},{key:'sample',time:1.7,name:'ADC逐次采样 ×16'},{key:'judge',time:.55,name:'电压 / 电流 / 规格校验'}];
let running=false,queue=[],direction='forward',phaseIndex=-1,phaseTime=0,totalTime=0,lastFrame=0;
let targetResult=null,measuredV=0,measuredI=0,adcCode=0,afeV=0,chartTime=0,trace=[],graphAccumulator=0,sampleAccumulator=0;
let results={forward:null,reverse:null},sampleCodes=[],logCounter=0,breakdownActive=false;
function limitsFor(dir){return dir==='forward'?[CFG.fMin,CFG.fMax]:[CFG.rMin,CFG.rMax];}
function limText(limits){return limits.every(Number.isFinite)?`${limits[0]>=0?'+':''}${limits[0].toFixed(2)} ～ ${limits[1]>=0?'+':''}${limits[1].toFixed(2)}`:'未指定';}
function log(message,type='info'){
 const w=document.createElement('div');w.className='logline '+type;
 const n=document.createElement('span');n.className='logtime';n.textContent='['+String(++logCounter).padStart(3,'0')+']';
 const s=document.createElement('span');s.className='logmsg';s.textContent=message;w.append(n,s);
 $('eventLog').append(w);$('eventLog').scrollTop=$('eventLog').scrollHeight;
 while($('eventLog').children.length>130)$('eventLog').firstChild.remove();
}
function readControls(){
 CFG.target=Number($('testCurrent').value)||1;CFG.compliance=Number($('limitVoltage').value)||12;
 CFG.device=$('deviceType').value;CFG.fault=$('faultMode').value;CFG.speed=Number($('simSpeed').value)||1;
 const toNumber = id=>$(''+id).value.trim()===''?NaN:Number($(id).value);
 CFG.fMin=toNumber('fMin');CFG.fMax=toNumber('fMax');CFG.rMin=toNumber('rMin');CFG.rMax=toNumber('rMax');
 $('currentValue').innerHTML=CFG.target.toFixed(2)+' <small>mA</small>';
 $('limitValue').innerHTML=CFG.compliance.toFixed(1)+' <small>V</small>';
 $('specCondition').textContent=`±${CFG.target.toFixed(2)}mA · ${CFG.compliance.toFixed(1)}V限压`;
 $('specPos').textContent=limText([CFG.fMin,CFG.fMax])+' V';$('specNeg').textContent=limText([CFG.rMin,CFG.rMax])+' V';
 $('currentWindow').textContent=showDir(direction)+' 合格窗口：'+limText(limitsFor(direction))+' V';
 document.querySelectorAll('.goal-current').forEach(x=>x.textContent=CFG.target.toFixed(2)+' mA');
 document.querySelectorAll('#forwardRow .spec-range').forEach(x=>x.textContent=limText(limitsFor('forward')));
 document.querySelectorAll('#reverseRow .spec-range').forEach(x=>x.textContent=limText(limitsFor('reverse')));
}
function setDefaultSpec(){
 const model=MODELS[$('deviceType').value];
 [['fMin',model.limits[0]?.[0]],['fMax',model.limits[0]?.[1]],['rMin',model.limits[1]?.[0]],['rMax',model.limits[1]?.[1]]].forEach(([id,v])=>$(id).value=Number.isFinite(v)?v:'');
 $('limitHint').textContent=$('deviceType').value==='esd'?'来自D500截图':'教学示意值';
 $('reverseHint').textContent=$('deviceType').value==='esd'?'来自D500截图':model.limits[1]?'教学示意值':'不建议反向1mA';
 $('activePart').textContent=model.name;
 $('deviceNote').textContent=model.info;
 $('ivExplanation').textContent=model.iv;
 readControls();if(typeof rebuildMesh==='function')rebuildMesh();
 if(!running)clearMeasurement(false);
}
/* Educational model: required voltage at target current. Output compliance = voltage ceiling.
 * When the current cannot be established at the ceiling, result is INVALID, not a fake PASS/FAIL.
 */
function requiredAt(dir,i,cfg){
 const m=MODELS[cfg.device],base=dir==='forward'?m.f:m.r;
 if(base==null)return null;
 const factor=m.form==='bidirectional'?0.22:m.form==='zener'||(m.form==='unidirectional'&&dir==='reverse')?0.16:m.form==='led'?0.12:0.057;
 return Math.max(.01,base+factor*Math.log(Math.max(i,.001)));
}
function computeDevice(dir,cfg){
 const m=MODELS[cfg.device],sgn=dir==='forward'?1:-1,limits=limitsFor(dir);
 let required=requiredAt(dir,cfg.target,cfg),actual=cfg.target,regulated=true,reason='',breakdown=false;
 if(cfg.fault==='short'){required=0.05;}
 else if(cfg.fault==='open'){required=cfg.compliance+50;actual=.00001;regulated=false;reason='开路：恒流源达到顺从电压上限，实际电流接近0';}
 else if(required!==null && Number.isFinite(limits[0]) && Number.isFinite(limits[1])){
   const low=dir==='forward'?limits[0]:Math.abs(limits[1]),high=dir==='forward'?limits[1]:Math.abs(limits[0]);
   if(cfg.fault==='low')required=Math.max(.04,low-.75);
   if(cfg.fault==='high')required=high+1.15;
 }
 if(required===null){regulated=false;actual=cfg.device==='schottky'?.0006:.000008;required=cfg.compliance+40;
   reason=cfg.device==='led'?'普通LED不允许直接以12V反向1mA强制击穿；此为拒测示意':
   cfg.device==='photodiode'?'反向应测漏电/光电流，不能强制以1mA当成击穿点':'反向未建立1mA（仅漏电），顺从电压不是击穿电压';}
 if(required>cfg.compliance){regulated=false;actual=Math.min(actual,.00008);required=cfg.compliance;
   if(!reason)reason='达到顺从电压上限，不能建立目标恒流；测试无效';}
 const ideal=sgn*required;
 breakdown=regulated&&cfg.fault!=='short'&&((m.form==='bidirectional')||(dir==='reverse'&&(m.form==='zener'||m.form==='unidirectional')));
 return {direction:dir,idealVoltage:ideal,voltage:0,current:actual,target:cfg.target,adc:0,adcInput:0,regulated,breakdown,
   outcome:'',passed:false,reason,limits:limits.slice(),samples:0};
}
function adcEncode(v,index){
 // Sense front end converts signed DUT voltage to safe positive voltage; polarity stored separately.
 // Example: |DUT|/5, Vref=3.3 V, 10-bit. Deterministic noise in DUT voltage domain.
 const variation=.007*Math.sin(index*2.74+Math.abs(v)*.75)+.003*Math.cos(index*1.86);
 const input=clamp((Math.abs(v)+variation)/5,0,3.3);
 const code=clamp(Math.round(input/3.3*1023),0,1023);
 return {code,input:code*3.3/1023,reconstructed:(v<0?-1:1)*code*3.3/1023*5};
}
function setRunningUI(on){document.querySelectorAll('#deviceType,#faultMode,#testCurrent,#limitVoltage,#fMin,#fMax,#rMin,#rMax,#simSpeed,#restoreSpec,#runForward,#runReverse,#runAuto').forEach(e=>e.disabled=on);$('runAuto').textContent=on?'◉ 测试进行中…':'▶ 一键正反向自动测试';}
function setPill(t,k){const p=$('statusPill');p.textContent=t;p.className='status-pill '+k;}
function resetStepUI(){document.querySelectorAll('.steps > div').forEach(x=>x.classList.remove('active','done','not'));}
function updateSampleBars(){
 $('sampleProgress').textContent=sampleCodes.length+' / 16';
 const bs=$('sampleBars').children;for(let i=0;i<bs.length;i++)bs[i].className=i<sampleCodes.length?'done':i===sampleCodes.length&&running&&phaseIndex===2?'active':'';
 $('adcBinary').textContent=adcCode.toString(2).padStart(10,'0');
 $('sampleAverage').textContent=sampleCodes.length?`AVG ${ (sampleCodes.reduce((a,b)=>a+b,0)/sampleCodes.length).toFixed(2) } LSB`:'等待采样均值';
 document.querySelectorAll('#adcFlow [data-flow]').forEach((x,i)=>{x.className=i<(phaseIndex===3?5:phaseIndex===2?4:phaseIndex===1?2:0)?'done':'';if(i===(phaseIndex===3?4:phaseIndex===2?2:phaseIndex===1?0:-1))x.className='active';});
}
function clearMeasurement(resetLog=false){
 running=false;queue=[];phaseIndex=-1;phaseTime=0;totalTime=0;chartTime=0;trace=[];graphAccumulator=0;sampleAccumulator=0;sampleCodes=[];
 results={forward:null,reverse:null};measuredV=0;measuredI=0;adcCode=0;afeV=0;targetResult=null;direction='forward';breakdownActive=false;
 setRunningUI(false);$('sceneStage').textContent='READY / 待机';$('breakdownPop').hidden=true;$('plotCaption').textContent='等待测试';$('polarityText').textContent='正向 / 未开始';$('stepText').textContent='等待指令';
 $('overallResult').textContent='WAITING';setPill('待机 READY','idle');resetStepUI();
 if(resetLog){$('eventLog').innerHTML='';logCounter=0;}
 readControls();updateSampleBars();showReadings();renderRows();drawGraph();drawIV();
}
function beginRun(dirs){
 readControls();for(const dir of dirs){const lr=limitsFor(dir),unsupported=dir==='reverse'&&MODELS[CFG.device].r===null&&lr.every(Number.isNaN);if(!unsupported&&(lr.some(v=>!Number.isFinite(v))||lr[0]>lr[1])){log(`${showDir(dir)}规格上下限未设置或顺序错误，先填写正确范围`,'err');return;}}
 clearMeasurement(false);running=true;queue=dirs.slice();setRunningUI(true);
 log(`开始测试 ${MODELS[CFG.device].name}，ISET=${CFG.target.toFixed(2)}mA，顺从电压±${CFG.compliance.toFixed(1)}V`);
 if(CFG.device==='esd'&&CFG.target!==1)log('注意：D500截图的上下限基于1mA；当前电流不为1mA时规格仅供演示','warn');
 log('MCU：GPIO→继电器断流切换；模拟ADC 10bit / Vref=3.3V / 前端÷5；样本数16');nextDirection();
}
function nextDirection(){
 if(!queue.length){finishRun();return;}
 direction=queue.shift();targetResult=computeDevice(direction,CFG);sampleCodes=[];measuredV=0;measuredI=0;adcCode=0;afeV=0;
 phaseIndex=0;phaseTime=0;sampleAccumulator=0;breakdownActive=false;
 $('polarityText').textContent=showDir(direction);$('currentWindow').textContent=`${showDir(direction)} 合格窗口：${limText(limitsFor(direction))} V`;
 log(`${showDir(direction)}：关闭恒流源、继电器 K1/K2 切换极性（教学死区）`);applyPhase();
}
function applyPhase(){
 const p=PHASES[phaseIndex];resetStepUI();document.querySelectorAll('.steps > div').forEach((el,i)=>el.classList.add(i<phaseIndex?'done':i===phaseIndex?'active':'not'));
 $('sceneStage').textContent=`${direction==='forward'?'FORWARD +':'REVERSE −'} / ${p.name}`;$('stepText').textContent=p.name;$('plotCaption').textContent=showDir(direction)+' · '+p.name;setPill('执行中 RUNNING','running');
 if(p.key==='excite')log(`1mA电流源启动：目标 ${CFG.target.toFixed(2)}mA / 输出上限 ±${CFG.compliance.toFixed(1)}V`);
 if(p.key==='sample')log(targetResult.regulated?'ADC建立稳定工作点，开始16次采样':'顺从电压触顶，仍采样以辨识限压，最终标记INVALID',targetResult.regulated?'info':'warn');
 if(p.key==='judge')log(`MCU：ADC采样平均/电压反算/恒流达标检测/正反向独立上下限比较`);
 updateSampleBars();
}
function addSample(){
 const a=adcEncode(targetResult.idealVoltage,sampleCodes.length);sampleCodes.push(a.code);adcCode=a.code;afeV=a.input;measuredV=a.reconstructed;
 const average=sampleCodes.reduce((s,k)=>s+k,0)/sampleCodes.length;const sign=direction==='forward'?1:-1;
 $('calcReading').innerHTML=(average*3.3/1023*5*sign).toFixed(3)+' <small>V</small>';
 if(sampleCodes.length===1||sampleCodes.length%4===0||sampleCodes.length===16){
  log(`ADC[${String(sampleCodes.length).padStart(2,'0')}/16] 原始=${a.code} (0b${a.code.toString(2).padStart(10,'0')})，AFE=${a.input.toFixed(4)}V，DUT=${formatV(a.reconstructed)}V`);
 }
 updateSampleBars();
}
function finalizeSample(){
 while(sampleCodes.length<16)addSample();
 const avg=sampleCodes.reduce((a,b)=>a+b,0)/16,sign=direction==='forward'?1:-1;
 const r=targetResult;r.adc=Math.round(avg);r.adcInput=avg*3.3/1023;r.voltage=sign*r.adcInput*5;r.samples=16;
 const [min,max]=limitsFor(direction);const within=Number.isFinite(min)&&Number.isFinite(max)&&r.voltage>=min&&r.voltage<=max;
 const currentOK=r.regulated&&r.current>=CFG.target*.98;
 r.outcome=!currentOK?'INVALID':within?'PASS':'FAIL';r.passed=r.outcome==='PASS';
 if(currentOK){r.reason=within?'16次采样平均后，电流达标且电压在规格窗口内':'电流达标，但ADC测得电压超出上下限';}
 results[direction]=r;measuredV=r.voltage;measuredI=r.current;
 log(`MCU判定：AVG=${avg.toFixed(2)}LSB，V=${formatV(r.voltage)}V，I=${r.current.toFixed(6)}mA，结果=${r.outcome}`,r.outcome==='PASS'?'ok':r.outcome==='FAIL'?'err':'warn');
 if(r.outcome==='INVALID')log(r.reason,'warn');
 renderRows();
}
function updateRun(dt){
 if(!running)return;dt=Math.min(dt,.08)*CFG.speed;totalTime+=dt;phaseTime+=dt;chartTime+=dt;
 const p=PHASES[phaseIndex];
 if(p.key==='switch'){measuredV=0;measuredI=0;}
 if(p.key==='excite'){
  const x=clamp(phaseTime/p.time,0,1),factor=1-Math.exp(-6*x);
  measuredV=targetResult.idealVoltage*factor;measuredI=targetResult.current*factor;
 }
 if(p.key==='sample'||p.key==='judge'){
  measuredI=targetResult.current;
  if(!sampleCodes.length)measuredV=targetResult.idealVoltage;
 }
 breakdownActive=targetResult.breakdown&&(phaseIndex>=1)&&Math.abs(measuredV)>=Math.abs(targetResult.idealVoltage)*.70&&measuredI>=.10*CFG.target;
 $('breakdownPop').hidden=!breakdownActive;
 afeV=Math.abs(measuredV)/5;adcCode=clamp(Math.round(afeV/3.3*1023),0,1023);
 graphAccumulator+=dt;
 if(graphAccumulator>=.045){graphAccumulator=0;trace.push({time:chartTime,v:measuredV,direction});if(trace.length>700)trace.shift();drawGraph();}
 if(p.key==='sample'&&sampleCodes.length<16){sampleAccumulator+=dt;while(sampleAccumulator>=.09&&sampleCodes.length<16){sampleAccumulator-=.09;addSample();}}
 showReadings();drawIV();
 if(phaseTime>=p.time){
  if(phaseIndex===2)finalizeSample();
  phaseIndex++;phaseTime=0;
  if(phaseIndex>=PHASES.length){
   if(queue.length){trace.push({time:chartTime,v:NaN,direction});nextDirection();}
   else finishRun();
  }else applyPhase();
 }
}
function finishRun(){
 running=false;phaseIndex=-1;breakdownActive=false;$('breakdownPop').hidden=true;setRunningUI(false);resetStepUI();
 const done=Object.values(results).filter(Boolean),invalid=done.some(x=>x.outcome==='INVALID'),fail=done.some(x=>x.outcome==='FAIL');
 const allPass=done.length>0&&done.every(x=>x.outcome==='PASS');const overall=invalid?'INVALID':fail?'FAIL':allPass?'PASS':'WAITING';
 const kind=invalid?'invalid':fail?'fail':allPass?'pass':'idle';$('overallResult').textContent=overall;
 setPill(overall,kind);$('sceneStage').textContent='COMPLETE / '+overall;$('stepText').textContent='采样完成';$('plotCaption').textContent='完成 · 可查看上下限与波形';
 log('测试完成：关闭恒流源，继电器复位（模拟），等待下一次命令','ok');renderRows();
}
function renderRows(){
 for(const dir of ['forward','reverse']){
   const row=$(dir+'Row'),r=results[dir];row.querySelector('.goal-current').textContent=CFG.target.toFixed(2)+' mA';
   row.querySelector('.spec-range').textContent=limText(limitsFor(dir));
   row.querySelector('.got-current').textContent=r?(r.current<.001?(r.current*1000).toFixed(3)+' μA':r.current.toFixed(4)+' mA'):'—';
   row.querySelector('.got-voltage').textContent=r?formatV(r.voltage):'—';
   row.querySelector('.got-result').innerHTML=r?`<span class="result-${r.outcome.toLowerCase()}">${r.outcome}</span>`:'<span class="result-empty">未测试</span>';
 }
 const done=Object.values(results).filter(Boolean);
 $('reportSummary').textContent=done.length?done.map(r=>`${showDir(r.direction)}：${r.outcome}，${r.reason}`).join('；')+'。当前数据来自教学模拟，不可用于真实出货判定。':'等待测试。12V为输出顺从电压上限，测试由1mA恒流源建立二极管两端的实际电压。';
}
function showReadings(){
 $('voltageReading').textContent=formatV(measuredV);
 $('actualCurrent').innerHTML=measuredI.toFixed(5)+' <small>mA</small>';
 $('adcReading').innerHTML=adcCode+' <small>/ 1023</small>';
 $('afeReading').innerHTML=afeV.toFixed(4)+' <small>V</small>';
 if(sampleCodes.length===0)$('calcReading').innerHTML=(Math.sign(measuredV)*adcCode*3.3/1023*5).toFixed(3)+' <small>V</small>';
 $('meterFill').style.width=(clamp(Math.abs(measuredV)/Math.max(CFG.compliance,1)*100,0,100))+'%';
 $('adcBinary').textContent=adcCode.toString(2).padStart(10,'0');
}
function canvasCtx(canvas){const r=canvas.getBoundingClientRect();if(r.width<1||r.height<1)return null;const dpr=Math.min(window.devicePixelRatio||1,2);canvas.width=Math.round(r.width*dpr);canvas.height=Math.round(r.height*dpr);const ctx=canvas.getContext('2d');ctx.scale(dpr,dpr);return {ctx,w:r.width,h:r.height};}
function drawGraph(){
 const c=canvasCtx($('waveChart'));if(!c)return;const {ctx,w,h}=c,pl=55,pr=62,pt=20,pb=30;
 const vals=[...trace.filter(x=>Number.isFinite(x.v)).map(x=>Math.abs(x.v)),CFG.compliance,Math.abs(CFG.fMin)||0,Math.abs(CFG.fMax)||0,Math.abs(CFG.rMin)||0,Math.abs(CFG.rMax)||0];
 const extreme=Math.ceil(Math.max(2,...vals)*1.07);const reverse=trace.some(x=>x.direction==='reverse')||!running;
 const ymin=reverse?-extreme:-.5,ymax=extreme,T=Math.max(4,chartTime+.3);
 const xx=t=>pl+(w-pl-pr)*t/T, yy=v=>pt+(h-pt-pb)*(ymax-v)/(ymax-ymin);
 ctx.fillStyle='rgba(8,22,38,.25)';ctx.fillRect(pl,pt,w-pl-pr,h-pt-pb);ctx.font='10px Consolas,monospace';
 for(let k=0;k<=5;k++){let v=ymin+(ymax-ymin)*k/5,y=yy(v);ctx.beginPath();ctx.strokeStyle='#263c50';ctx.moveTo(pl,y);ctx.lineTo(w-pr,y);ctx.stroke();ctx.fillStyle='#819bb0';ctx.textAlign='right';ctx.fillText(v.toFixed(1),pl-8,y+3);}
 for(let k=0;k<=5;k++){let t=T*k/5,x=xx(t);ctx.beginPath();ctx.strokeStyle='#1d3448';ctx.moveTo(x,pt);ctx.lineTo(x,h-pb);ctx.stroke();ctx.textAlign='center';ctx.fillStyle='#668aa4';ctx.fillText(t.toFixed(1),x,h-9);}
 for(const [dir,palette] of [['forward','#69dba2'],['reverse','#ecba76']]){
  const limits=limitsFor(dir);if(limits.some(x=>!Number.isFinite(x)))continue;
  const lo=yy(limits[0]),hi=yy(limits[1]);ctx.fillStyle=dir==='forward'?'rgba(70,200,156,.065)':'rgba(235,173,105,.07)';ctx.fillRect(pl,hi,w-pl-pr,lo-hi);
  limits.forEach((v,k)=>{let y=yy(v);ctx.setLineDash([5,4]);ctx.strokeStyle=palette;ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(pl,y);ctx.lineTo(w-pr,y);ctx.stroke();ctx.setLineDash([]);ctx.textAlign='left';ctx.fillStyle=palette;ctx.fillText((dir==='forward'?'F':'R')+(k?'MAX':'MIN')+' '+v.toFixed(1),w-pr+3,y+3);});
 }
 for(const [dir,color] of [['forward','#4ce1f5'],['reverse','#f5ad6c']]){
  const a=trace.filter(x=>x.direction===dir&&Number.isFinite(x.v));if(!a.length)continue;
  ctx.beginPath();ctx.moveTo(xx(a[0].time),yy(a[0].v));for(let i=1;i<a.length;i++)ctx.lineTo(xx(a[i].time),yy(a[i].v));
  ctx.strokeStyle=color;ctx.lineWidth=2.5;ctx.shadowBlur=8;ctx.shadowColor=color;ctx.stroke();ctx.shadowBlur=0;
  const last=a[a.length-1];ctx.beginPath();ctx.fillStyle=color;ctx.arc(xx(last.time),yy(last.v),3.6,0,2*Math.PI);ctx.fill();
 }
 if(!trace.length){ctx.textAlign='center';ctx.fillStyle='#7c99b0';ctx.font='12px system-ui';ctx.fillText('按下“一键正反向自动测试”，显示实时曲线与规格上下限',w*.5,h*.5);}
}
function drawIV(){
 const c=canvasCtx($('ivChart'));if(!c)return;const {ctx,w,h}=c,pl=53,pr=16,pt=17,pb=37;
 const xMax=Math.max(12,CFG.compliance,Math.abs(CFG.fMax)||0,Math.abs(CFG.rMin)||0)+1;
 const yMax=Math.max(1,CFG.target*1.35);const xx=v=>pl+(w-pl-pr)*(v+xMax)/(2*xMax),yy=i=>pt+(h-pt-pb)*(yMax-i)/(2*yMax);
 for(let j=0;j<=8;j++){const v=-xMax+2*xMax*j/8,x=xx(v);ctx.beginPath();ctx.strokeStyle='#22374c';ctx.moveTo(x,pt);ctx.lineTo(x,h-pb);ctx.stroke();ctx.textAlign='center';ctx.font='10px Consolas';ctx.fillStyle='#7894a9';ctx.fillText(v.toFixed(0),x,h-17);}
 for(let j=0;j<=6;j++){const i=-yMax+2*yMax*j/6,y=yy(i);ctx.beginPath();ctx.strokeStyle='#1e374b';ctx.moveTo(pl,y);ctx.lineTo(w-pr,y);ctx.stroke();ctx.fillStyle='#849db0';ctx.textAlign='right';ctx.fillText(i.toFixed(1),pl-8,y+3);}
 ctx.strokeStyle='#7895ad';ctx.lineWidth=1.1;ctx.beginPath();ctx.moveTo(xx(0),pt);ctx.lineTo(xx(0),h-pb);ctx.moveTo(pl,yy(0));ctx.lineTo(w-pr,yy(0));ctx.stroke();
 ctx.fillStyle='#819aac';ctx.textAlign='center';ctx.fillText('器件两端电压 V',w*.5,h-3);ctx.save();ctx.translate(12,h*.5);ctx.rotate(-Math.PI/2);ctx.fillText('施加电流 mA',0,0);ctx.restore();
 for(const dir of ['forward','reverse']){
  const li=limitsFor(dir);if(li.some(x=>!Number.isFinite(x)))continue;
  const x1=xx(li[0]),x2=xx(li[1]);ctx.fillStyle=dir==='forward'?'rgba(76,219,176,.10)':'rgba(239,184,115,.10)';ctx.fillRect(x1,pt,Math.max(1,x2-x1),h-pt-pb);
  ctx.setLineDash([3,4]);ctx.strokeStyle=dir==='forward'?'#4e9d77':'#9b744b';for(let v of li){ctx.beginPath();ctx.moveTo(xx(v),pt);ctx.lineTo(xx(v),h-pb);ctx.stroke();}ctx.setLineDash([]);
 }
 for(const dir of ['forward','reverse']){
   const values=[];
   for(let i=.004;i<=yMax;i+=yMax/95){let r=requiredAt(dir,i,CFG);if(r===null)continue;if(r>CFG.compliance)continue;values.push([dir==='forward'?r:-r,dir==='forward'?i:-i]);}
   if(values.length<2)continue;ctx.beginPath();values.forEach(([v,i],j)=>j?ctx.lineTo(xx(v),yy(i)):ctx.moveTo(xx(v),yy(i)));
   ctx.strokeStyle=dir==='forward'?'#45dcef':'#eca961';ctx.lineWidth=2.4;ctx.shadowColor=ctx.strokeStyle;ctx.shadowBlur=6;ctx.stroke();ctx.shadowBlur=0;
 }
 if(running&&phaseIndex>=1){let x=xx(measuredV),y=yy(direction==='forward'?measuredI:-measuredI);ctx.beginPath();ctx.arc(x,y,7,0,2*Math.PI);ctx.fillStyle=breakdownActive?'#c895ff':'#f4efcc';ctx.shadowBlur=15;ctx.shadowColor=ctx.fillStyle;ctx.fill();ctx.shadowBlur=0;ctx.beginPath();ctx.strokeStyle='#e3e7ea';ctx.arc(x,y,11,0,2*Math.PI);ctx.stroke();}
 ctx.font='10px Consolas';ctx.fillStyle='#68d6e7';ctx.textAlign='left';ctx.fillText('正向 I–V',pl+5,pt+13);ctx.fillStyle='#f1ba81';ctx.fillText('反向 I–V',pl+80,pt+13);
}
function exportCsv(){
 const arr=[['方向','测试项目','器件','范围Min(V)','范围Max(V)','目标电流(mA)','实际电流(mA)','测量电压(V)','状态','说明']];
 for(const d of ['forward','reverse']){const r=results[d];if(!r)continue;arr.push([d,d==='forward'?'D500_Vf':'D500_Rf',MODELS[CFG.device].name,...r.limits,r.target,r.current.toFixed(6),r.voltage.toFixed(4),r.outcome,r.reason]);}
 if(arr.length===1){log('没有测试结果，先进行测试再导出','warn');return;}
 const csv='\ufeff'+arr.map(row=>row.map(v=>'"'+String(v).replaceAll('"','""')+'"').join(',')).join('\r\n');const url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}));
 const a=document.createElement('a');a.href=url;a.download='DiodeLab_D500_results.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),4000);log('已将当前仿真结果导出为CSV','ok');
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
  if(['esd','tvs','unidirectional','zener'].includes(CFG.device)){
    box(.98,.36,-.32,1.30,.42,.70,'#151b25');box(.98,.59,-.32,1.13,.05,.55,'#232d3b');
    box(.24,.29,-.32,.25,.27,.69,'#bcc0c4');box(1.72,.29,-.32,.25,.27,.69,'#bcc0c4');
    box(.42,.609,-.32,.085,.012,.47,'#e1e8eb');
  }else{
    cylinderX(.98,.37,-.32,1.25,.25,CFG.device==='led'?'#b53e35':CFG.device==='photodiode'?'#235b78':'#121822',24);
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
    const title=i===2?('DUT / '+(MODELS[CFG.device].form==='bidirectional'?'BIDIRECTIONAL':MODELS[CFG.device].form.toUpperCase())):L.title;
    pill(ctx,pt.x,pt.y-42,title,i===2?MODELS[CFG.device].name:L.sub);
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
  // Controlled-avalanche effect: purple plasma rings + electric filaments above the DUT.
  // Glow is educational; controlled breakdown is not a destructive short circuit.
  if(breakdownActive){
    const center=project([.98,.59,-.32],rw,rh);
    if(center){
      const elapsed=t*.001;
      const pulse=.82+.18*Math.sin(elapsed*15);
      const radiusGlow=38*pulse*13/Math.max(7,center.depth);
      const halo=ctx.createRadialGradient(center.x,center.y,3,center.x,center.y,65*pulse);
      halo.addColorStop(0,'rgba(223,154,255,.30)');halo.addColorStop(.3,'rgba(164,86,242,.19)');halo.addColorStop(1,'rgba(134,42,235,0)');
      ctx.fillStyle=halo;ctx.beginPath();ctx.arc(center.x,center.y,65*pulse,0,Math.PI*2);ctx.fill();
      for(let k=0;k<3;k++){
        const r=radiusGlow*(1+k*.26),start=elapsed*(1.2+k*.4)+k*2.1;
        ctx.beginPath();ctx.strokeStyle=`rgba(205,135,255,${.60-k*.11})`;ctx.lineWidth=2-k*.35;
        ctx.shadowColor='#a96bff';ctx.shadowBlur=11;ctx.ellipse(center.x,center.y,r,r*.45,start,0,Math.PI*1.58);ctx.stroke();ctx.shadowBlur=0;
      }
      for(let k=0;k<8;k++){
        const a=k*Math.PI/4+elapsed*.9,rr=13+4*Math.sin(elapsed*10+k),r2=31+9*Math.sin(elapsed*6+k*1.7);
        const x1=center.x+Math.cos(a)*rr,y1=center.y+Math.sin(a)*rr*.7;
        const xm=center.x+Math.cos(a+.17)*((rr+r2)/2),ym=center.y+Math.sin(a+.22)*((rr+r2)/2)*.7;
        const x2=center.x+Math.cos(a)*r2,y2=center.y+Math.sin(a)*r2*.7;
        ctx.strokeStyle=k%2?'#e9a7ff':'#8eeaff';ctx.lineWidth=1.4;ctx.shadowColor='#ba70ff';ctx.shadowBlur=9;
        ctx.beginPath();ctx.moveTo(x1,y1);ctx.lineTo(xm,ym);ctx.lineTo(x2,y2);ctx.stroke();ctx.shadowBlur=0;
      }
      ctx.textAlign='center';ctx.fillStyle='#edc7ff';ctx.font='700 12px Consolas';ctx.fillText('Vz / CLAMP ACTIVE',center.x,center.y-45);
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
 for(let i=0;i<16;i++){const x=document.createElement('span');$('sampleBars').appendChild(x);}
 $('deviceType').addEventListener('change',()=>{setDefaultSpec();drawGraph();drawIV();});
 $('restoreSpec').addEventListener('click',()=>{setDefaultSpec();log('已恢复当前器件的示意规格或D500截图规格');});
 for(const id of ['testCurrent','limitVoltage','fMin','fMax','rMin','rMax','simSpeed','faultMode']){
  $(id).addEventListener('input',()=>{if(!running){readControls();renderRows();drawGraph();drawIV();}});
 }
 $('runAuto').addEventListener('click',()=>beginRun(['forward','reverse']));
 $('runForward').addEventListener('click',()=>beginRun(['forward']));
 $('runReverse').addEventListener('click',()=>beginRun(['reverse']));
 $('resetBtn').addEventListener('click',()=>{clearMeasurement();log('已手动复位：关闭激励，清空数据与曲线');});
 $('exportCsv').addEventListener('click',exportCsv);
 $('clearLog').addEventListener('click',()=>{ $('eventLog').innerHTML='';logCounter=0;});
 setDefaultSpec();init3D();initOrbit();clearMeasurement();
 log('DiodeLab 3D V2.0：已加载3D恒流源、继电器、DUT、AFE和MCU','ok');
 log('当前D500规格：正向 +5.8～+8.1V，反向 −8.1～−5.8V；1mA / 12V顺从限制');
 log('建议先点“一键正反向自动测试”，再用故障注入观察PASS / FAIL / INVALID','info');
 log('击穿发光是钳位区教学特效，不是火花烧毁；所有数据不是实物测量','warn');
 requestAnimationFrame(frame);window.addEventListener('resize',()=>{drawGraph();drawIV();});
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start);else start();
