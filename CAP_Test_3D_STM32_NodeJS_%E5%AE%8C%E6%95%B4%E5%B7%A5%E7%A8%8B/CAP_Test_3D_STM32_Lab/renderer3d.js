/* Offline 3D test bench. Actual 3D coordinates, perspective projection,
   lighting, occlusion sorting, interactive orbit and zoom; Canvas2D renderer,
   deliberately no remote 3D assets or third-party packages. */
(() => {
'use strict';
const V=(x,y,z)=>({x,y,z});
const add=(a,b)=>V(a.x+b.x,a.y+b.y,a.z+b.z);
const sub=(a,b)=>V(a.x-b.x,a.y-b.y,a.z-b.z);
const mul=(a,s)=>V(a.x*s,a.y*s,a.z*s);
const dot=(a,b)=>a.x*b.x+a.y*b.y+a.z*b.z;
const cross=(a,b)=>V(a.y*b.z-a.z*b.y,a.z*b.x-a.x*b.z,a.x*b.y-a.y*b.x);
const norm=a=>mul(a,1/(Math.sqrt(dot(a,a))||1));
const avg=pts=>mul(pts.reduce((sum,p)=>add(sum,p),V(0,0,0)),1/pts.length);
const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
const hexRGB=h=>{let s=h.replace('#','');return [parseInt(s.slice(0,2),16),parseInt(s.slice(2,4),16),parseInt(s.slice(4,6),16)];};
const lit=(hex,n)=>{let c=hexRGB(hex);return `rgb(${c.map(v=>Math.round(clamp(v*n,0,255))).join(',')})`;};
const light=norm(V(-.65,1.7,2.5));
const P=(x,y,z)=>V(x,y,z);
class Bench3D {
  constructor(canvas){
    this.canvas=canvas; this.ctx=canvas.getContext('2d',{alpha:false});
    this.az=.15;this.el=.46;this.dist=13.6;this.target=V(0,.94,-.2);
    this.w=960;this.h=550;this.pixelRatio=1;this.isDragging=false;this.pointer=null;
    this.bindEvents(); this.resize();
    if(window.ResizeObserver){this.ro=new ResizeObserver(()=>this.resize());this.ro.observe(canvas);}
  }
  bindEvents(){
    this.canvas.addEventListener('pointerdown',e=>{this.isDragging=true;this.pointer=[e.clientX,e.clientY];this.canvas.setPointerCapture(e.pointerId);this.canvas.classList.add('dragging');});
    this.canvas.addEventListener('pointermove',e=>{if(!this.isDragging)return;let dx=e.clientX-this.pointer[0],dy=e.clientY-this.pointer[1];this.az=clamp(this.az-dx*.006,-1.05,1.05);this.el=clamp(this.el+dy*.005,.16,1.2);this.pointer=[e.clientX,e.clientY];});
    for(const type of ['pointerup','pointercancel'])this.canvas.addEventListener(type,()=>{this.isDragging=false;this.canvas.classList.remove('dragging');});
    this.canvas.addEventListener('wheel',e=>{e.preventDefault();this.dist=clamp(this.dist*Math.exp(e.deltaY*.001),10.4,20);},{passive:false});
  }
  resetCamera(){this.az=.15;this.el=.46;this.dist=13.6;}
  resize(){const r=this.canvas.getBoundingClientRect();if(!r.width||!r.height)return;this.w=r.width;this.h=r.height;this.pixelRatio=Math.min(window.devicePixelRatio||1,2);this.canvas.width=Math.round(this.w*this.pixelRatio);this.canvas.height=Math.round(this.h*this.pixelRatio);this.ctx.setTransform(this.pixelRatio,0,0,this.pixelRatio,0,0);}
  configureCamera(){
    const a=this.az,e=this.el,d=this.dist;
    this.eye=add(this.target,V(Math.sin(a)*Math.cos(e)*d,Math.sin(e)*d,Math.cos(a)*Math.cos(e)*d));
    this.forward=norm(sub(this.target,this.eye));this.right=norm(cross(this.forward,V(0,1,0)));this.up=norm(cross(this.right,this.forward));
    this.focal=Math.min(this.w*.98,this.h*1.74);
  }
  proj(p){const rel=sub(p,this.eye), depth=dot(rel,this.forward);return {x:this.w*.5+dot(rel,this.right)*this.focal/depth,y:this.h*.53-dot(rel,this.up)*this.focal/depth,depth,scale:this.focal/depth};}
  enqueue(kind,pts,other={}){let center=avg(pts);this.queue.push({kind,pts,depth:this.proj(center).depth,...other});}
  poly(pts,col,alpha=1,stroke=null){this.enqueue('poly',pts,{col,alpha,stroke});}
  line(pts,col,width=2,alpha=1,glow=0){this.enqueue('line',pts,{col,width,alpha,glow});}
  dot(p,r,col,glow=0,alpha=1){this.enqueue('dot',[p],{radius:r,col,glow,alpha});}
  label(p,text,col,size=14,bold=false,align='center'){this.enqueue('label',[p],{text,col,size,bold,align});}
  box(x,y,z,w,h,d,base){
    const q=[P(x-w/2,y-h/2,z-d/2),P(x+w/2,y-h/2,z-d/2),P(x+w/2,y+h/2,z-d/2),P(x-w/2,y+h/2,z-d/2),P(x-w/2,y-h/2,z+d/2),P(x+w/2,y-h/2,z+d/2),P(x+w/2,y+h/2,z+d/2),P(x-w/2,y+h/2,z+d/2)];
    for(const face of [[3,2,1,0],[4,5,6,7],[0,4,7,3],[5,1,2,6],[3,7,6,2],[0,1,5,4]]) {
      let pts=face.map(i=>q[i]),normal=norm(cross(sub(pts[1],pts[0]),sub(pts[2],pts[0])));
      const illumination=.62+Math.max(0,dot(normal,light))*.43;
      this.poly(pts,lit(base,illumination),1,'rgba(200,225,240,.09)');
    }
  }
  disc(cx,cy,cz,r,axis,color,segments=20){
    const rings=[];for(let j=0;j<segments;j++){const a=j*Math.PI*2/segments; rings.push(axis==='z'?P(cx+Math.cos(a)*r,cy+Math.sin(a)*r,cz):P(cx+Math.cos(a)*r,cy,cz+Math.sin(a)*r));}
    this.poly(rings,color,1,'rgba(255,255,255,.06)');
  }
  cylinder(x,y,z,r,h,color,N=30,alpha=1){
    for(let i=0;i<N;i++){
      const a=i*Math.PI*2/N,b=(i+1)*Math.PI*2/N;
      const q=[P(x+r*Math.cos(a),y,z+r*Math.sin(a)),P(x+r*Math.cos(b),y,z+r*Math.sin(b)),P(x+r*Math.cos(b),y+h,z+r*Math.sin(b)),P(x+r*Math.cos(a),y+h,z+r*Math.sin(a))];
      const normal=norm(V(Math.cos((a+b)*.5),0,Math.sin((a+b)*.5)));
      this.poly(q,lit(color,.5+.58*Math.max(0,dot(normal,light))),alpha);
    }
    const top=[];for(let i=0;i<N;i++){let a=i*Math.PI*2/N;top.push(P(x+r*Math.cos(a),y+h,z+r*Math.sin(a)));}
    this.poly(top,lit(color,1.13),alpha,'rgba(255,255,255,.2)');
  }
  segment(a,b,color,width=2,glow=0){this.line([a,b],color,width,1,glow);}
  pathAt(nodes,t){let pos=clamp(t,0,.999999)*(nodes.length-1),i=Math.floor(pos),k=pos-i;return add(mul(nodes[i],1-k),mul(nodes[i+1],k));}
  spline(points, subdivisions=8){let arr=[];for(let i=0;i<points.length-1;i++){
    const p0=points[Math.max(0,i-1)],p1=points[i],p2=points[i+1],p3=points[Math.min(points.length-1,i+2)];
    for(let j=0;j<subdivisions;j++){let t=j/subdivisions,t2=t*t,t3=t2*t;
      const component=k=>.5*((2*p1[k])+(-p0[k]+p2[k])*t+(2*p0[k]-5*p1[k]+4*p2[k]-p3[k])*t2+(-p0[k]+3*p1[k]-3*p2[k]+p3[k])*t3);
      arr.push(P(component('x'),component('y'),component('z')));
    }
  }arr.push(points[points.length-1]);return arr;}
  // Wire material is rendered in 3D. Charge indicators move *along* the wires only.
  cable(points,color,phase,offset,seconds,flow,thin=false){
    const curve=this.spline(points);this.line(curve,'#07111d',thin?5.7:8.5,1,0);this.line(curve,color,thin?2.7:5,1,0);
    if(phase==='hold'||phase==='done'||!flow)return;
    const rev=phase==='discharge'; const count=thin?4:9;
    for(let k=0;k<count;k++){
      const pos=((k/count+seconds*(thin?.22:.32)+(offset||0))%1+1)%1;
      const p=this.pathAt(curve,rev?1-pos:pos);
      this.dot(p,thin?.043:.067,thin?'#f7e39b':'#e5ff8e',12, .86);
    }
  }
  drawGrid(){
    // grid on a virtual ground plane
    for(let x=-9;x<=9;x+=.6)this.line([P(x,-.1,-7),P(x,-.1,6)],'#172b3d',.7,.56);
    for(let z=-7;z<=6;z+=.6)this.line([P(-9,-.1,z),P(9,-.1,z)],'#172b3d',.7,.56);
  }
  drawSource(s){
    const x=-3.4,z=-.9;
    this.box(x,1.09,z,2.75,1.58,1.9,'#293743');
    // front panel
    this.poly([P(-4.75,.38,.075),P(-2.05,.38,.075),P(-2.05,1.82,.075),P(-4.75,1.82,.075)],'#182531',1,'#627582');
    this.label(P(-3.55,1.72,.12),'DC  PRECISION  SOURCE','#d3e3ec',11,true);
    this.box(-3.43,1.34,.115,2.2,.55,.04,'#050f18');
    this.label(P(-4.21,1.43,.19),'CC','#7cdda3',13,true,'left');
    this.label(P(-3.35,1.38,.19),`${s.phase==='discharge'?'−':s.phase==='hold'||s.phase==='done'?'0':'+'}${(s.phase==='hold'||s.phase==='done'?0:s.currentMA).toFixed(2)} mA`,'#b6fc8c',19,true);
    this.label(P(-3.34,1.17,.19),`OUT ${s.voltage.toFixed(2)}V / LIM ${s.limitV.toFixed(0)}V`,'#80abb3',10,false);
    // Terminals, red and black
    this.disc(-4.27,.69,.18,.2,'z','#8d3540');
    this.disc(-3.65,.69,.18,.2,'z','#1b252d');
    this.disc(-4.27,.69,.207,.116,'z','#f66b65');
    this.disc(-3.65,.69,.207,.116,'z','#a2b7c9');
    this.label(P(-4.27,.40,.23),'+','#ff9290',13,true);
    this.label(P(-3.65,.40,.23),'−','#cee0eb',13,true);
    // setting knob 3D on front
    this.disc(-2.55,.76,.19,.3,'z','#172833');
    this.disc(-2.55,.76,.22,.215,'z','#6d8190');
    this.disc(-2.55,.76,.26,.11,'z','#162632');
    this.segment(P(-2.55,.76,.27),P(-2.55,.91,.27),'#c5f79c',3);
    this.label(P(-2.55,.40,.2),'ADJUST','#9cb3c4',10,true);
    this.dot(P(-2.11,1.72,.17),.057,s.running?'#acfa7f':'#657184',8);
  }
  drawCap(s){
    const x=.08,z=-1.0,y=.52,h=2.24,r=.62;
    // socket and clamping fixture beneath DUT
    this.box(x,.38,z,1.9,.22,1.65,'#456069');
    this.box(-.76,.65,z,.13,.55,.65,'#7f969b');
    this.box(.92,.65,z,.13,.55,.65,'#7f969b');
    this.cylinder(x,y,z,r,h,'#1d5870',36,.97);
    // foil-style capacitor body striped band towards the right side
    for(let i=0;i<14;i++){
      let a=.12+i*(.43/14);
      const aa=a,bb=a+.43/14+.005;
      this.poly([P(x+r*1.012*Math.cos(aa),y+.12,z+r*1.012*Math.sin(aa)),P(x+r*1.012*Math.cos(bb),y+.12,z+r*1.012*Math.sin(bb)),P(x+r*1.012*Math.cos(bb),y+h-.12,z+r*1.012*Math.sin(bb)),P(x+r*1.012*Math.cos(aa),y+h-.12,z+r*1.012*Math.sin(aa))],'#6da6b1',.54);
    }
    // visual stripe along front, dielectric conceptual charge ladder
    const fraction=clamp(s.voltage/s.maxV,0,1);
    // glowing voltage indicator built from 3D translucent stacked rings - NOT fluid level
    for(let j=0;j<10;j++){
      let segmentY=y+.21+j*.17;let active=fraction*10>j+.2;
      if(!active)continue;
      const pts=[];for(let k=0;k<20;k++){let a=.22+k*(Math.PI-.44)/19;pts.push(P(x+(r+.022)*Math.cos(a),segmentY,z+(r+.022)*Math.sin(a)));}
      this.line(pts,'#80fcb4',3,.58+.35*fraction,active?8:0);
    }
    // top metallic rim and terminals
    this.cylinder(x,y+h-.09,z,r+.018,.115,'#aabcc0',32);
    this.cylinder(x,y+h,z,r*.9,.055,'#7f9ba5',32);
    this.segment(P(x-.22,y+h+.057,z),P(x+.22,y+h+.057,z),'#38515c',2);
    this.segment(P(x,y+h+.057,z-.22),P(x,y+h+.057,z+.22),'#38515c',2);
    this.cylinder(x-.27,y+h+.06,z+.08,.112,.145,'#c7d7d5',14);
    this.cylinder(x+.27,y+h+.06,z+.08,.112,.145,'#c7d7d5',14);
    this.dot(P(x-.27,y+h+.21,z+.08),.083,'#f77c7b',4);
    this.dot(P(x+.27,y+h+.21,z+.08),.083,'#c4e1f2',3);
    // floating capacitance label, anchored in 3D
    this.label(P(x,1.56,z+.68),'DUT  ·  Cx','#e8f5f2',15,true);
    this.label(P(x,1.28,z+.68),`${s.capUF} µF`,'#b5f78a',17,true);
    this.label(P(x,1.06,z+.68),'16 V  /  POLARIZED','#bfd0dc',9,true);
    this.label(P(x,2.98,z),'CAPACITOR','#a8c4cd',10,true);
  }
  drawMeter(s){
    const x=3.3,z=-.65;
    this.box(x,.96,z,2.2,1.3,1.68,'#2a4249');
    this.poly([P(2.22,.36,.21),P(4.38,.36,.21),P(4.38,1.57,.21),P(2.22,1.57,.21)],'#182c32',1,'#4c7074');
    this.label(P(3.3,1.49,.25),'DC  VOLTMETER','#c5dae0',11,true);
    this.box(3.3,1.08,.26,1.85,.58,.04,'#06181d');
    this.label(P(3.25,1.08,.31),`${s.voltage.toFixed(3)} V`,'#72e6e5',24,true);
    this.disc(2.83,.57,.25,.155,'z','#c69840');this.disc(3.72,.57,.25,.155,'z','#b2bcba');
    this.disc(2.83,.57,.28,.077,'z','#ffe2a0');this.disc(3.72,.57,.28,.077,'z','#c8e1ee');
    this.label(P(2.83,.34,.26),'V+','#f1d18c',9,true);this.label(P(3.72,.34,.26),'COM','#b9d3df',9,true);
  }
  drawSockets(s){
    // physically routed cable paths; excitation source -> DUT -> return
    const pos=[P(-4.27,.69,.27),P(-4.36,.49,.9),P(-2.76,.42,1.7),P(-1.26,.45,1.12),P(-.92,1.0,.32),P(-.7,2.42,-.62),P(-.19,2.98,-.92)];
    const neg=[P(.35,2.98,-.92),P(.98,2.36,-.30),P(1.12,1.0,.5),P(-.33,.41,1.5),P(-2.55,.40,1.18),P(-3.65,.69,.27)];
    // conventional current on + wire during charging, and returning on - wire
    this.cable(pos,'#e35d61',s.phase,0,s.particleClock,!!s.running);
    // reverse node order for charge circulation; phase reverse handled per cable
    this.cable(neg,'#5d9eea',s.phase,.35,s.particleClock,!!s.running);
    // direct non-loading voltage probes in parallel
    this.cable([P(-.19,2.96,-.86),P(.3,3.25,.18),P(1.9,2.14,1.0),P(2.83,.57,.29)],'#e9c878','hold',0,0,false,true);
    this.cable([P(.35,2.96,-.86),P(1.42,3.06,-.46),P(2.24,1.66,.75),P(3.72,.57,.29)],'#a6c7c5','hold',0,0,false,true);
  }
  render(s){
    if(this.w<10||this.h<10)return;
    this.configureCamera();const ctx=this.ctx,W=this.w,H=this.h;
    ctx.setTransform(this.pixelRatio,0,0,this.pixelRatio,0,0);
    const bg=ctx.createLinearGradient(0,0,W,H);bg.addColorStop(0,'#101e29');bg.addColorStop(.6,'#0a1520');bg.addColorStop(1,'#0a1721');ctx.fillStyle=bg;ctx.fillRect(0,0,W,H);
    const glow=ctx.createRadialGradient(W*.47,H*.50,20,W*.47,H*.50,W*.6);glow.addColorStop(0,'rgba(40,92,97,.22)');glow.addColorStop(1,'rgba(2,12,20,0)');ctx.fillStyle=glow;ctx.fillRect(0,0,W,H);
    this.queue=[];this.drawGrid();this.box(0,.15,-.5,10.4,.32,5.4,'#253b45');
    // bench surface grooves
    for(let i=-4;i<=4;i++)this.line([P(i,.322,-3.12),P(i,.322,2.0)],'#44606a',.8,.44);
    this.drawSource(s);this.drawCap(s);this.drawMeter(s);this.drawSockets(s);
    this.queue.sort((a,b)=>b.depth-a.depth);
    for(const item of this.queue){
      const pts=item.pts.map(p=>this.proj(p));const at=pts[0];ctx.save();ctx.globalAlpha=item.alpha??1;
      if(item.kind==='poly'){
        ctx.beginPath();pts.forEach((p,i)=>i?ctx.lineTo(p.x,p.y):ctx.moveTo(p.x,p.y));ctx.closePath();ctx.fillStyle=item.col;ctx.fill();if(item.stroke){ctx.strokeStyle=item.stroke;ctx.lineWidth=.8;ctx.stroke();}
      }else if(item.kind==='line'){
        if(item.glow){ctx.shadowBlur=item.glow;ctx.shadowColor=item.col;}
        ctx.strokeStyle=item.col;ctx.lineWidth=item.width;ctx.lineCap='round';ctx.lineJoin='round';ctx.beginPath();pts.forEach((p,i)=>i?ctx.lineTo(p.x,p.y):ctx.moveTo(p.x,p.y));ctx.stroke();
      }else if(item.kind==='dot'){
        ctx.beginPath();ctx.arc(at.x,at.y,Math.max(1,item.radius*at.scale),0,Math.PI*2);ctx.fillStyle=item.col;ctx.shadowBlur=item.glow;ctx.shadowColor=item.col;ctx.fill();
      }else if(item.kind==='label'){
        let size=clamp(item.size*at.scale/78,8,27);ctx.font=`${item.bold?'700':'500'} ${size}px ui-monospace, SFMono-Regular, Consolas, monospace`;ctx.textAlign=item.align;ctx.textBaseline='middle';ctx.shadowColor='rgba(0,0,0,.75)';ctx.shadowBlur=4;ctx.fillStyle=item.col;ctx.fillText(item.text,at.x,at.y);
      }
      ctx.restore();
    }
    // fixed overlay labels for model reading
    ctx.font='600 11px ui-monospace, Consolas, monospace';ctx.fillStyle='rgba(161,188,199,.7)';ctx.textAlign='left';ctx.fillText('3D MODEL  ·  LIVE INSTRUMENTS',22,28);
    ctx.textAlign='right';ctx.fillText('拖动旋转  /  滚轮缩放',W-22,28);
    ctx.font='12px system-ui, sans-serif';ctx.fillStyle='#86a4b2';ctx.textAlign='left';ctx.fillText('绿色发光环代表电压状态，不代表液体或电荷穿过介质',22,H-22);
  }
}


/* Physically modeled MCU PCB: LQFP-48 pins, vias, traces, ADC/timer/UART signals.
   The board is a teaching visualization, not a validated routing/layout or chip pinout. */
class MCU3D extends Bench3D {
  constructor(canvas){super(canvas);this.resetCamera();}
  resetCamera(){this.az=-.37;this.el=.83;this.dist=7.8;this.target=V(0,.32,0);}
  bindEvents(){
    this.canvas.addEventListener('pointerdown',e=>{this.isDragging=true;this.pointer=[e.clientX,e.clientY];this.canvas.setPointerCapture(e.pointerId);this.canvas.classList.add('dragging');});
    this.canvas.addEventListener('pointermove',e=>{if(!this.isDragging)return;let dx=e.clientX-this.pointer[0],dy=e.clientY-this.pointer[1];this.az=clamp(this.az-dx*.006,-1.4,1.4);this.el=clamp(this.el+dy*.005,.2,1.42);this.pointer=[e.clientX,e.clientY];});
    for(const type of ['pointerup','pointercancel'])this.canvas.addEventListener(type,()=>{this.isDragging=false;this.canvas.classList.remove('dragging');});
    this.canvas.addEventListener('wheel',e=>{e.preventDefault();this.dist=clamp(this.dist*Math.exp(e.deltaY*.001),5.3,11.5);},{passive:false});
  }
  trace(points,color,active,t,rate=.6,count=7){
    this.line(points,color,3,.8,active?7:0);
    if(!active)return;
    for(let i=0;i<count;i++){
      const pos=((i/count+t*rate)%1+1)%1;
      this.dot(this.pathAt(points,pos),.028,color,14,.96);
    }
  }
  render(s){
    if(this.w<10||this.h<10)return;
    this.configureCamera();const ctx=this.ctx,W=this.w,H=this.h;
    ctx.setTransform(this.pixelRatio,0,0,this.pixelRatio,0,0);
    const bg=ctx.createLinearGradient(0,0,W,H);bg.addColorStop(0,'#101f2c');bg.addColorStop(1,'#07151e');ctx.fillStyle=bg;ctx.fillRect(0,0,W,H);
    this.queue=[];
    // PCB real 3D volume and silk boundaries
    this.box(0,.08,0,4.72,.15,3.3,'#176153');
    for(let z of [-1.46,1.46])this.line([P(-2.21,.16,z),P(2.21,.16,z)],'#69b5a3',1.1,.8);
    // golden mount holes
    for(let x of [-2.14,2.14])for(let z of [-1.37,1.37]){
      this.cylinder(x,.16,z,.104,.012,'#d7aa5c',12);
      this.cylinder(x,.17,z,.056,.014,'#172b2f',12);
    }
    // MCU body QFP48 12 leads on each side, each lead extends out the black body.
    this.box(0,.29,0,2.09,.32,2.09,'#242b31');
    this.box(0,.455,0,1.91,.026,1.91,'#151d24');
    for(let j=0;j<12;j++){
      const n=-.82+j*(1.64/11);
      this.box(-1.14,.185,n,.38,.055,.077,'#c3cbd0');
      this.box(1.14,.185,n,.38,.055,.077,'#c3cbd0');
      this.box(n,.185,-1.14,.077,.055,.38,'#c3cbd0');
      this.box(n,.185,1.14,.077,.055,.38,'#c3cbd0');
    }
    this.cylinder(-.70,.478,-.70,.055,.009,'#8ea6b2',12);
    this.label(P(0,.51,-.21),'STM32F103','#f0f4ee',17,true);
    this.label(P(0,.51,.10),'C8T6','#cdd8da',16,true);
    this.label(P(0,.51,.43),'ARM  CORTEX-M3','#83c3d0',10,true);
    // header & discrete blocks
    this.box(-1.91,.32,-.03,.24,.35,1.60,'#17252d');
    for(let j=0;j<6;j++){const z=-.67+j*.27;this.box(-1.91,.54,z,.095,.18,.10,'#e5c77c');}
    this.label(P(-1.9,.7,-.03),'ADC IN','#e1ebd6',10,true);
    // clock/crystal and oscillator
    this.box(1.69,.32,1.02,.78,.20,.43,'#b7c2c4');
    this.label(P(1.69,.46,1.02),'8MHz','#20333e',10,true);
    // UART header
    this.box(1.91,.30,-.63,.28,.27,.90,'#17252d');
    for(let j=0;j<3;j++)this.box(1.91,.50,-.91+j*.28,.09,.16,.10,'#e9c376');
    this.label(P(1.9,.68,-.64),'UART','#b5e9df',11,true);
    // topology traces, main signals on PCB top copper, including luminous traveling pulse
    const t=s.particleClock||s.time||0;
    this.trace([P(-1.91,.21,-.1),P(-1.55,.21,-.1),P(-1.46,.21,-.54),P(-1.31,.21,-.54)],'#73e0ed',s.running&&s.phase!=='done',t,.73,8);
    this.trace([P(1.68,.21,.85),P(1.55,.21,.72),P(1.33,.21,.72)],'#baff9e',s.running,t,.86,7);
    this.trace([P(1.29,.21,-.59),P(1.58,.21,-.59),P(1.91,.21,-.63)],'#ffa16c',s.measured!==null&&s.running,t,.65,5);
    // passive components & test points
    for(const [x,z] of [[-1.54,.91],[-1.52,1.18],[1.60,-1.15],[.52,1.31],[-.5,-1.28]]){
      this.box(x,.215,z,.15,.10,.28,'#ddd4b6');
      this.box(x,.268,z-.10,.15,.016,.06,'#bba35a');
      this.box(x,.268,z+.10,.15,.016,.06,'#bba35a');
    }
    this.dot(P(-1.93,.20,-.1),.069,'#6ce6e7',13,.75);
    this.dot(P(1.72,.21,.80),.060,'#adf6a5',13,.75);
    if(s.measured!==null)this.dot(P(1.92,.21,-.61),.069,'#ffa36a',14,.95);
    this.label(P(-1.73,.2,1.22),'VDDA 3V3','#90d6c5',9,true);
    this.label(P(0,.16,1.49),'CAP TEST  ·  MCU ADC BOARD','#91d1b7',11,true);
    this.queue.sort((a,b)=>b.depth-a.depth);
    for(const item of this.queue){
      const pts=item.pts.map(p=>this.proj(p)),at=pts[0];ctx.save();ctx.globalAlpha=item.alpha??1;
      if(item.kind==='poly'){
        ctx.beginPath();pts.forEach((p,i)=>i?ctx.lineTo(p.x,p.y):ctx.moveTo(p.x,p.y));ctx.closePath();ctx.fillStyle=item.col;ctx.fill();if(item.stroke){ctx.strokeStyle=item.stroke;ctx.lineWidth=.8;ctx.stroke();}
      }else if(item.kind==='line'){
        if(item.glow){ctx.shadowBlur=item.glow;ctx.shadowColor=item.col;}
        ctx.strokeStyle=item.col;ctx.lineWidth=item.width;ctx.lineCap='round';ctx.lineJoin='round';ctx.beginPath();pts.forEach((p,i)=>i?ctx.lineTo(p.x,p.y):ctx.moveTo(p.x,p.y));ctx.stroke();
      }else if(item.kind==='dot'){
        ctx.beginPath();ctx.arc(at.x,at.y,Math.max(1,item.radius*at.scale),0,Math.PI*2);ctx.fillStyle=item.col;ctx.shadowBlur=item.glow;ctx.shadowColor=item.col;ctx.fill();
      }else if(item.kind==='label'){
        let size=clamp(item.size*at.scale/78,8,24);ctx.font=`${item.bold?'700':'500'} ${size}px ui-monospace, Consolas, monospace`;ctx.textAlign=item.align;ctx.textBaseline='middle';ctx.shadowColor='rgba(0,0,0,.85)';ctx.shadowBlur=5;ctx.fillStyle=item.col;ctx.fillText(item.text,at.x,at.y);
      }
      ctx.restore();
    }
    ctx.font='700 11px ui-monospace,Consolas,monospace';ctx.fillStyle='#94bfc3';ctx.textAlign='right';
    ctx.fillText(`ADC ${Math.round(Math.min(3.3,s.voltage*(3.0/4.2))/3.3*4095).toString().padStart(4,'0')} / 4095`,W-20,55);
  }
}
window.MCU3D=MCU3D;

window.Bench3D=Bench3D;
})();
