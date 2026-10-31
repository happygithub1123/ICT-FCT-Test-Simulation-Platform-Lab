/* CAP Test 3D LAB · Vanilla JS · no dependencies
   Physics: I = C dV/dt, Uc(t)=U0+1000 I[mA]/C[µF] * t.
   1 V and 3 V threshold times are interpolated analytically, not rounded to a frame.
   The 3D view, physical instrument readouts and oscilloscope use this SAME state.
 */
(() => {
'use strict';
const $=id=>document.getElementById(id);
const VMAX=4.2, VA=1,VB=3,HOLD=0.4,DONE_HOLD=1.2;
const SPEEDS=[.5,1,2,5,10];
const state={
 currentMA:2,capUF:1000,limitV:12,speed:1,running:true,autoLoop:true,
 phase:'charge',voltage:0,time:0,holdElapsed:0,doneElapsed:0,
 t1:null,t2:null,measured:null,particleClock:0,history:[{t:0,v:0,phase:'charge'}],
 maxV:VMAX,frames:0
};
const scene=new window.Bench3D($('scene'));
let chartSize={w:600,h:350,dpr:1};
function slope(){return 1000*state.currentMA/state.capUF;}
function cycleTime(){return 2*VMAX/slope()+HOLD;}
function reset(){
 state.phase='charge';state.voltage=0;state.time=0;state.holdElapsed=0;state.doneElapsed=0;
 state.t1=null;state.t2=null;state.measured=null;state.particleClock=0;
 state.history=[{t:0,v:0,phase:'charge'}];renderLabels();renderChart();scene.render(state);
}
function record(phase){
 const p={t:state.time,v:state.voltage,phase};
 const last=state.history[state.history.length-1];
 if(last&&Math.abs(last.t-p.t)<1e-7&&last.phase===p.phase){last.v=p.v;return;}
 state.history.push(p);
 if(state.history.length>1800)state.history=state.history.filter((v,i)=>i%2===0||i===state.history.length-1);
}
function advance(dt){
 let left=dt,guard=0;
 while(left>1e-9&&guard++<16){
  const vps=slope(),old=state.voltage,oldT=state.time;
  if(state.phase==='charge'){
   const seg=Math.min(left,Math.max(0,(VMAX-old)/vps));
   const next=old+vps*seg;
   if(state.t1===null && old<=VA && next>=VA)state.t1=oldT+(VA-old)/vps;
   if(state.t2===null && old<=VB && next>=VB){
      state.t2=oldT+(VB-old)/vps;
      if(state.t1!==null)state.measured=1000*state.currentMA*(state.t2-state.t1)/(VB-VA);
   }
   state.voltage=Math.min(VMAX,next);state.time+=seg;left-=seg;state.particleClock+=seg;
   record('charge');
   if(state.voltage>=VMAX-1e-8){state.voltage=VMAX;state.phase='hold';state.holdElapsed=0;record('hold');}
  }else if(state.phase==='hold'){
   const seg=Math.min(left,HOLD-state.holdElapsed);state.holdElapsed+=seg;state.time+=seg;left-=seg;record('hold');
   if(state.holdElapsed>=HOLD-1e-8){state.phase='discharge';record('discharge');}
  }else if(state.phase==='discharge'){
   const seg=Math.min(left,Math.max(0,old/vps));state.voltage=Math.max(0,old-vps*seg);state.time+=seg;left-=seg;state.particleClock+=seg;record('discharge');
   if(state.voltage<=1e-8){state.voltage=0;state.phase='done';state.doneElapsed=0;record('done');}
  }else{
   const seg=Math.min(left,DONE_HOLD-state.doneElapsed);state.doneElapsed+=seg;left-=seg;
   if(state.doneElapsed>=DONE_HOLD-1e-8){if(state.autoLoop)reset();else state.running=false;}
  }
 }
}
function fmt(v,n=3){return v===null?'—':v.toFixed(n);}
function phaseName(){return {charge:'恒流充电中',hold:'截止保持中',discharge:'恒流放电中',done:'本轮测试完成'}[state.phase];}
function renderLabels(){
 $('statusText').textContent=phaseName();
 const charged=state.phase==='charge',discharged=state.phase==='discharge',active=charged||discharged;
 const current=active?(charged?state.currentMA:-state.currentMA):0;
 $('voltageReadout').textContent=state.voltage.toFixed(3);
 $('currentReadout').textContent=(current>=0?'+':'−')+Math.abs(current).toFixed(2);
 $('timeReadout').textContent=state.time.toFixed(3);
 $('energyReadout').textContent=(.5*(state.capUF*1e-6)*state.voltage*state.voltage*1000).toFixed(2);
 $('chargeProgress').style.width=`${state.voltage/VMAX*100}%`;
 const signedSlope=active?(charged?'+':'−')+slope().toFixed(3):'0.000';
 $('slopeReadout').textContent=active?`${charged?'充电':'放电'}斜率 ${signedSlope} V/s`:'电压已停止变化';
 $('slopeBadge').textContent=signedSlope;
 $('phaseReadout').textContent={charge:'CHARGING · 注入电流',hold:'HOLD · 源输出归零',discharge:'DISCHARGING · 抽取电流',done:'COMPLETE · 电流归零'}[state.phase];
 $('outputBadge').textContent=!state.running?'SIM PAUSED':active?'OUTPUT ON':'OUTPUT OFF';
 $('t1Readout').textContent=state.t1===null?'—':state.t1.toFixed(3)+' s';
 $('t2Readout').textContent=state.t2===null?'—':state.t2.toFixed(3)+' s';
 $('calcI').textContent=state.currentMA.toFixed(3)+' mA';
 $('calcSlope').textContent=slope().toFixed(3)+' V/s';
 $('calcDT').textContent=state.t2===null?'—':(state.t2-state.t1).toFixed(3)+' s';
 $('resultCap').textContent=state.measured===null?'—':state.measured.toFixed(1);
 const badge=$('measurementBadge');
 if(state.measured!==null){
   badge.textContent='✓ 测量完成';badge.classList.add('done');
   $('equationLine').textContent=`C = 1000 × ${state.currentMA.toFixed(2)} × ${(state.t2-state.t1).toFixed(3)} ÷ 2.000 ≈ ${state.measured.toFixed(1)} µF`;
   $('resultText').textContent=`测得 ${state.measured.toFixed(1)} µF，设定 ${state.capUF} µF。测量已完成，${state.phase==='discharge'?'当前电容正在受控放电。':state.phase==='done'?'电容已放电至 0 V。':'等待充放电周期结束。'}`;
 }else if(state.t1!==null){
   badge.textContent='采样中 A → B';badge.classList.remove('done');
   $('equationLine').textContent='已记录 t₁；等待 Uc 达到 3.000 V 后计算 Δt。';
   $('resultText').textContent=`A 点记录于 ${state.t1.toFixed(3)} s，继续等待电压到达 3.0 V。`;
 }else{
   badge.textContent=state.phase==='discharge'?'已切换放电':'等待 A 点';badge.classList.remove('done');
   $('equationLine').textContent='C(µF) = 1000 × I(mA) × Δt(s) / ΔV(V)';
   $('resultText').textContent=state.phase==='discharge'?'手动切换到放电；如需完整电容测试，请点击「重新测试」。':'开始充电，等待电容电压越过第一个采样点 1.0 V。';
 }
 $('playBtn').textContent=state.running?'Ⅱ 暂停仿真':'▶ 继续仿真';
 $('currentSetting').textContent=state.currentMA.toFixed(1)+' mA';
 $('capSetting').textContent=state.capUF+' µF';
 $('speedSetting').textContent=state.speed+'×';
 $('limitSetting').textContent=state.limitV+' V';
 $('loopCheck').checked=state.autoLoop;
}
// Oscilloscope chart: continuously drawn from model history, CSS-pixel aware.
function resizeChart(){
 const canvas=$('chart'),r=canvas.getBoundingClientRect();if(!r.width||!r.height)return;
 chartSize={w:r.width,h:r.height,dpr:Math.min(2,window.devicePixelRatio||1)};
 canvas.width=Math.round(r.width*chartSize.dpr);canvas.height=Math.round(r.height*chartSize.dpr);
}
function renderChart(){
 const c=$('chart'),ctx=c.getContext('2d');if(!ctx)return;
 const {w,h,dpr}=chartSize;ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,w,h);
 const pad={left:49,right:19,top:25,bottom:42};let PW=w-pad.left-pad.right,PH=h-pad.top-pad.bottom;
 if(PW<10||PH<10)return;
 const T=cycleTime(),X=t=>pad.left+Math.min(1,t/T)*PW,Y=v=>pad.top+PH-(v/5)*PH;
 ctx.save();ctx.font='11px ui-monospace,Consolas,monospace';ctx.textAlign='right';ctx.textBaseline='middle';
 for(let v=0;v<=5;v++){
  const yy=Y(v);ctx.strokeStyle=v===0?'#385762':'#243b45';ctx.lineWidth=1;ctx.setLineDash(v===0?[]:[3,5]);ctx.beginPath();ctx.moveTo(pad.left,yy);ctx.lineTo(w-pad.right,yy);ctx.stroke();ctx.fillStyle='#7f9ca7';ctx.fillText(v.toFixed(1),pad.left-12,yy);
 }
 const tickStep=T>30?5:T>15?2.5:T>7?2:1;
 for(let t=0;t<=T+.001;t+=tickStep){const xx=X(t);ctx.strokeStyle='#203640';ctx.setLineDash([3,5]);ctx.beginPath();ctx.moveTo(xx,pad.top);ctx.lineTo(xx,pad.top+PH);ctx.stroke();ctx.fillStyle='#7899a6';ctx.textAlign='center';ctx.fillText(t.toFixed(tickStep<2?1:0),xx,h-25);}
 ctx.setLineDash([]);ctx.fillStyle='#9bb9bf';ctx.textAlign='left';ctx.fillText('U (V)',12,13);ctx.textAlign='right';ctx.fillText('t (s)',w-15,h-11);
 // Measure window, with horizontal voltage thresholds
 for(const [val,col,lab] of [[VA,'#50d1cc','A / 1.0V'],[VB,'#bfa1f3','B / 3.0V']]){
   ctx.setLineDash([5,6]);ctx.strokeStyle=col+'72';ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(pad.left,Y(val));ctx.lineTo(w-pad.right,Y(val));ctx.stroke();ctx.setLineDash([]);
   ctx.fillStyle=col;ctx.font='10px ui-monospace,Consolas,monospace';ctx.textAlign='right';ctx.fillText(lab,w-pad.right-5,Y(val)-10);
 }
 // line segments keep respective charging/holding/discharge colors
 const data=state.history;
 for(let i=1;i<data.length;i++){
   const p=data[i-1],q=data[i];if(q.t<T+0.1){
      const col=q.phase==='discharge'?'#ffb779':q.phase==='hold'?'#79b9bd':'#baf38a';
      ctx.strokeStyle=col;ctx.lineWidth=2.5;ctx.shadowBlur=7;ctx.shadowColor=col+'88';ctx.beginPath();ctx.moveTo(X(p.t),Y(p.v));ctx.lineTo(X(q.t),Y(q.v));ctx.stroke();ctx.shadowBlur=0;
   }
 }
 for(const [t,val,col,lab] of [[state.t1,VA,'#5de0da','t₁'],[state.t2,VB,'#c8b0fa','t₂']]){
   if(t===null)continue;const xx=X(t),yy=Y(val);ctx.setLineDash([4,5]);ctx.strokeStyle=col+'aa';ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(xx,yy);ctx.lineTo(xx,pad.top+PH);ctx.stroke();ctx.setLineDash([]);ctx.beginPath();ctx.arc(xx,yy,5,0,Math.PI*2);ctx.fillStyle=col;ctx.fill();ctx.strokeStyle='#0c1b24';ctx.lineWidth=2;ctx.stroke();ctx.textAlign='center';ctx.fillStyle=col;ctx.font='bold 11px ui-monospace,Consolas,monospace';ctx.fillText(lab,xx,yy-17);
 }
 const endpoint=data[data.length-1];if(endpoint){const xx=X(endpoint.t),yy=Y(endpoint.v);ctx.beginPath();ctx.arc(xx,yy,4,0,Math.PI*2);ctx.fillStyle=state.phase==='discharge'?'#ffb779':'#baf38a';ctx.shadowColor=ctx.fillStyle;ctx.shadowBlur=12;ctx.fill();ctx.shadowBlur=0;}
 if(state.t2!==null){
  const x1=X(state.t1),x2=X(state.t2),arrowY=Y(3.8);
  ctx.fillStyle='#b8e993';ctx.textAlign='center';ctx.font='11px ui-monospace,Consolas,monospace';
  ctx.fillText(`Δt = ${(state.t2-state.t1).toFixed(3)}s`,(x1+x2)*.5,arrowY-12);
  ctx.strokeStyle='#789e82';ctx.beginPath();ctx.moveTo(x1,arrowY);ctx.lineTo(x2,arrowY);ctx.stroke();
  for(const [x,dir] of [[x1,-1],[x2,1]]){ctx.beginPath();ctx.moveTo(x-dir*5,arrowY-3);ctx.lineTo(x,arrowY);ctx.lineTo(x-dir*5,arrowY+3);ctx.stroke();}
 }
 ctx.restore();
}
function bindUI(){
 $('currentSlider').addEventListener('input',e=>{state.currentMA=Number(e.target.value);reset();});
 $('capSlider').addEventListener('input',e=>{state.capUF=Number(e.target.value);reset();});
 $('speedSlider').addEventListener('input',e=>{state.speed=SPEEDS[Number(e.target.value)];renderLabels();});
 $('limitSlider').addEventListener('input',e=>{state.limitV=Number(e.target.value);renderLabels();});
 $('loopCheck').addEventListener('change',e=>state.autoLoop=e.target.checked);
 $('playBtn').addEventListener('click',()=>{if(state.phase==='done'&&!state.autoLoop)reset();state.running=!state.running;renderLabels();});
 $('resetBtn').addEventListener('click',()=>{state.running=true;reset();});
 $('reverseBtn').addEventListener('click',()=>{
   if(state.phase==='charge'||state.phase==='hold'){state.phase='discharge';record('discharge');}
   else{reset();}
   state.running=true;renderLabels();
 });
 $('cameraReset').addEventListener('click',()=>scene.resetCamera());
 window.addEventListener('resize',()=>{resizeChart();renderChart();scene.resize();});
}
function loop(timestamp){
 if(!loop.last)loop.last=timestamp;
 const elapsed=Math.min(.10,(timestamp-loop.last)/1000);loop.last=timestamp;
 if(state.running)advance(elapsed*state.speed);
 state.frames++;
 // Labels and trace refreshed at <= 30 Hz; the 3D current particles move at RAF speed
 if(state.frames%2===0){renderLabels();renderChart();}
 scene.render(state);
 window.requestAnimationFrame(loop);
}
bindUI();resizeChart();reset();window.requestAnimationFrame(loop);
window.CAP_TEST_DEBUG={state,advance,reset,scene,slope};
})();
