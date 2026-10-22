import { roadsterMesh, roadsterNozzles } from './roadster-geometry.js';
import { RAMP_GEOMETRY as G, transformRampPoint } from './ramp-motion.js';

const TAU=Math.PI*2;
const dot=(a,b)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
const sub=(a,b)=>a.map((v,i)=>v-b[i]);
const add=(a,b,k=1)=>a.map((v,i)=>v+b[i]*k);
const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const unit=a=>{const n=Math.hypot(...a)||1;return a.map(v=>v/n);};
const clamp=(x,a=0,b=1)=>Math.max(a,Math.min(b,x));
const noise=n=>{const x=Math.sin(n*127.1+311.7)*43758.5453123;return x-Math.floor(x);};
const curve=(theta,z,radius=G.radius)=>[radius*Math.sin(theta),G.radius-radius*Math.cos(theta),z];

/** Fixed-camera, original procedural reconstruction; no private clock or listeners. */
export function createRampScene(canvas) {
  const ctx=canvas.getContext('2d',{alpha:false});
  if(!ctx)throw new Error('Ramp scene requires Canvas 2D');
  const car=roadsterMesh(),light=unit([-3,7,6]);
  let width=0,height=0,dpr=1,disposed=false,project,objects=[];

  function resize() {
    const bounds=canvas.getBoundingClientRect();
    const w=Math.max(1,Math.round(bounds.width||canvas.clientWidth||960));
    const h=Math.max(1,Math.round(bounds.height||canvas.clientHeight||480));
    const density=Math.min(2,Math.max(1,canvas.ownerDocument.defaultView?.devicePixelRatio||1));
    if(w!==width||h!==height||density!==dpr){width=w;height=h;dpr=density;canvas.width=Math.round(w*dpr);canvas.height=Math.round(h*dpr);}
    ctx.setTransform(dpr,0,0,dpr,0,0);
  }

  function camera() {
    // A long-lens side/rear view preserves the complete C and its landing zone.
    // Orthographic scale is fitted to actual world bounds at every render.
    const target=[-7,7.5,0],eye=[-15,12,43];
    const forward=unit(sub(target,eye)),right=unit(cross(forward,[0,1,0])),up=unit(cross(right,forward));
    const raw=p=>{const v=sub(p,target);return{x:dot(v,right),y:dot(v,up),depth:60+dot(v,forward)};};
    const corners=[];
    for(const x of [-25,10.5])for(const y of [-.3,18.4])for(const z of [-3.7,3.7])corners.push(raw([x,y,z]));
    const minX=Math.min(...corners.map(p=>p.x)),maxX=Math.max(...corners.map(p=>p.x));
    const minY=Math.min(...corners.map(p=>p.y)),maxY=Math.max(...corners.map(p=>p.y));
    const scale=Math.min(width*.91/(maxX-minX),height*.83/(maxY-minY));
    const cx=(minX+maxX)/2,cy=(minY+maxY)/2;
    project=p=>{const q=raw(p);return{x:width*.5+(q.x-cx)*scale,y:height*.51-(q.y-cy)*scale,depth:q.depth,scale};};
  }

  function shape(points) {
    const ps=points.map(project);ctx.beginPath();ctx.moveTo(ps[0].x,ps[0].y);
    for(let i=1;i<ps.length;i++)ctx.lineTo(ps[i].x,ps[i].y);
    ctx.closePath();return ps;
  }
  function polygon(points,color){shape(points);ctx.fillStyle=color;ctx.fill();}
  function line(points,color,lineWidth=1,glow=0) {
    const ps=points.map(project);ctx.beginPath();ctx.moveTo(ps[0].x,ps[0].y);
    for(let i=1;i<ps.length;i++)ctx.lineTo(ps[i].x,ps[i].y);
    ctx.strokeStyle=color;ctx.lineWidth=lineWidth;ctx.shadowColor=color;ctx.shadowBlur=glow;ctx.stroke();ctx.shadowBlur=0;
  }
  function halo(point,radius,color,opacity) {
    const p=project(point),r=Math.max(1,radius*p.scale),grad=ctx.createRadialGradient(p.x,p.y,0,p.x,p.y,r);
    grad.addColorStop(0,`rgba(${color},${opacity})`);grad.addColorStop(.25,`rgba(${color},${opacity*.30})`);grad.addColorStop(1,`rgba(${color},0)`);
    ctx.fillStyle=grad;ctx.fillRect(p.x-r,p.y-r,r*2,r*2);
  }
  function queueLine(points,color,lineWidth=1,glow=0) {
    objects.push({kind:'line',points,color,lineWidth,glow,depth:points.reduce((n,p)=>n+project(p).depth,0)/points.length});
  }
  function queueFace(vertices,color,emissive=false,glow=0) {
    const projected=vertices.map(project);
    const normal=unit(cross(sub(vertices[1],vertices[0]),sub(vertices[2],vertices[0])));
    const luminance=emissive?1:.58+.33*Math.abs(dot(normal,light))+.10*Math.max(0,normal[1]);
    objects.push({kind:'face',projected,depth:projected.reduce((n,p)=>n+p.depth,0)/projected.length,
      color:color.map(v=>Math.round(clamp(v*luminance,0,255))),glow});
  }

  function background() {
    const sky=ctx.createLinearGradient(0,0,0,height);sky.addColorStop(0,'#03090e');sky.addColorStop(.65,'#0b1720');sky.addColorStop(1,'#101c25');
    ctx.fillStyle=sky;ctx.fillRect(0,0,width,height);
    polygon([[-42,-.05,-22],[24,-.05,-22],[24,-.05,18],[-42,-.05,18]],'#121e26');
    polygon([[-34,.003,-5.3],[11,.003,-5.3],[11,.003,5.3],[-34,.003,5.3]],'#1c2931');
    for(let i=0;i<190;i++){
      const x=-34+noise(i+3)*45,z=-5.1+noise(i+64)*10.2;
      line([[x,.006,z],[x+.12+noise(i+98)*1.2,.006,z]],`rgba(186,211,226,${.025+noise(i+20)*.07})`,.5);
    }
    line([[-30,.012,0],[0,.012,0]],'rgba(217,229,235,.62)',1.1);
    for(const z of [-5.25,5.25]){
      line([[-29,.025,z],[10,.025,z]],'rgba(127,158,178,.35)',.75);
      line([[-26,.055,z],[9,.055,z]],'rgba(255,48,63,.54)',1.25,7);
      for(let x=-26;x<10;x+=3.3)halo([x,.08,z],.65,'255,47,61',.11);
    }
    // The landing patch stays visible beneath the returning vehicle.
    for(const x of [-25,-15.2])line([[x,.03,-3.3],[x,.03,3.3]],'rgba(205,222,233,.36)',1.1);
    for(const z of [-3.25,3.25])line([[-25,.03,z],[-15.2,.03,z]],'rgba(205,222,233,.19)',.7);
    for(const [x,z] of [[-24,-7],[6,-7.5]]){
      line([[x,0,z],[x,11,z]],'#2e404d',1.4);
      line([[x-.7,10.7,z],[x+.7,10.7,z]],'#4d626f',2.4);
      for(const dx of [-.45,0,.45]){halo([x+dx,10.8,z],.32,'222,245,255',.8);halo([x+dx,10.8,z],2.2,'194,226,244',.065);}
    }
    for(let i=0;i<10;i++)halo([-30+i*4,.55,-10],.16,'183,218,238',.45);
  }

  function ramp() {
    const steps=84,half=G.width/2;
    // The inside riding surface is the exact same circle used by the contact solver.
    for(let i=0;i<steps;i++){
      const a=i/steps*Math.PI,b=(i+1)/steps*Math.PI;
      const shade=i%7===0?[132,151,164]:[164,181,190];
      queueFace([curve(a,-half),curve(b,-half),curve(b,half),curve(a,half)],shade);
      queueFace([curve(a,-half,G.radius+G.thickness),curve(a,half,G.radius+G.thickness),curve(b,half,G.radius+G.thickness),curve(b,-half,G.radius+G.thickness)],[51,70,83]);
      for(const z of [-half,half])queueFace([curve(a,z),curve(b,z),curve(b,z,G.radius+G.thickness),curve(a,z,G.radius+G.thickness)],[106,126,140]);
      if(i%7===0)queueLine([curve(a,-half),curve(a,half)],'rgba(67,89,104,.55)',.55);
      for(const z of [-half-.015,half+.015])queueLine([curve(a,z),curve(b,z)],'rgba(255,55,69,.93)',1.65,5);
      queueLine([curve(a,0),curve(b,0)],'rgba(229,239,241,.52)',.65);
    }
    queueFace([[0,2*G.radius,-half],[-G.lip,2*G.radius,-half],[-G.lip,2*G.radius,half],[0,2*G.radius,half]],[175,190,199]);
    queueFace([[0,2*G.radius+G.thickness,-half],[0,2*G.radius+G.thickness,half],[-G.lip,2*G.radius+G.thickness,half],[-G.lip,2*G.radius+G.thickness,-half]],[70,88,103]);
    queueFace([[-G.lip,2*G.radius,-half],[-G.lip,2*G.radius+G.thickness,-half],[-G.lip,2*G.radius+G.thickness,half],[-G.lip,2*G.radius,half]],[99,117,131]);
    for(const z of [-half,half])queueLine([[-G.lip,2*G.radius,z],[0,2*G.radius,z]],'#ff5263',1.65,5);
    // Narrow ribbed approach plate, flush with the runway.
    queueFace([[-4,.008,-half],[0,.008,-half],[0,.008,half],[-4,.008,half]],[94,111,123]);
    for(const z of [-half,half])queueLine([[-4,.025,z],[0,.025,z]],'#c9394d',1.2,3);
    queueLine([[-4,.02,0],[0,.02,0]],'rgba(231,239,241,.62)',.8);
    // Outside steel ribs and diagonals follow the vertical C instead of making a halfpipe.
    for(const z of [-half-.37,half+.37]){
      for(let i=0;i<18;i++){
        const a=i/18*Math.PI,b=(i+1)/18*Math.PI;
        queueLine([curve(a,z,G.radius+.28),curve(b,z,G.radius+.28)],'#405a6b',2.6);
        queueLine([curve(a,z,G.radius+1.05),curve(b,z,G.radius+1.05)],'#3b5264',2.1);
        queueLine([curve(a,z,G.radius+.28),curve(a,z,G.radius+1.05)],'#5c7382',1.45);
        queueLine([curve(a,z,G.radius+.28),curve(b,z,G.radius+1.05)],'#344b5c',1.1);
      }
      const postX=G.radius+1.15;
      queueLine([[postX,0,z],[postX,2*G.radius+.55,z]],'#496170',2.3);
      for(let y=0;y<2*G.radius;y+=2.8){
        queueLine([[postX,y,z],[postX-1.1,y+2.6,z]],'#354e60',1.2);
        queueLine([[postX-1.1,y,z],[postX,y+2.6,z]],'#354e60',1.2);
      }
      queueLine([[-G.lip,2*G.radius+.23,z],[postX,2*G.radius+.55,z]],'#4b6477',2.0);
      queueLine([[postX-2.2,.09,z],[postX+1,.09,z]],'#607b8e',2.6);
    }
  }

  function smoke(point,radius,alpha,color='205,230,241',aspect=1) {
    if(alpha<.002)return;
    // Keep the complete soft volume above the road, not only its centre.
    const aboveRoad=[point[0],Math.max(.03+radius*aspect,point[1]),point[2]];
    const p=project(aboveRoad);objects.push({kind:'smoke',p,radius:radius*p.scale,alpha,color,aspect,depth:p.depth});
  }
  function gases(frame) {
    if(frame.jet===false||frame.reducedMotion)return;
    const strength=clamp(frame.jetStrength||0),seconds=frame.time/1000;
    if(strength>.002)for(let n=0;n<roadsterNozzles.length;n++){
      const origin=transformRampPoint(roadsterNozzles[n],frame);
      const direction=unit(transformRampPoint([0,-1,(n%2?1:-1)*.07],frame,true));
      const side=unit(transformRampPoint([1,0,0],frame,true));
      const freeLength=1.9+strength*2.6;
      const groundDistance=direction[1]<-.0001?Math.max(0,(origin[1]-.03)/-direction[1]):Infinity;
      const length=Math.min(freeLength,groundDistance),tip=add(origin,direction,length);
      const impact=1-length/freeLength;
      const a=project(origin),b=project(tip);
      if(length>.015)objects.push({kind:'jet',a,b,strength,grounded:impact>0,
        groundLine:[project([tip[0]-100,.03,tip[2]]),project([tip[0]+100,.03,tip[2]])],
        depth:(a.depth+b.depth)/2,width:Math.max(2,a.scale*(.16+strength*.17))});
      for(let j=0;j<18;j++){
        const u=(j/18+seconds*1.7+n*.19)%1;
        const point=add(add(origin,direction,u*length),side,(noise(n*67+j*3)-.5)*u*u*.35);
        smoke(point,.03+u*.27,(.09+strength*.07)*(1-u)*(1-impact), '189,224,242',1.1);
      }
      smoke(origin,.11,.55,'223,246,255');
      // Gas that meets the runway becomes a shallow, spreading cold cloud.
      if(impact>0)for(let j=0;j<13;j++){
        const u=(j/13+seconds*.6+n*.11)%1,angle=noise(j*9+n*41)*TAU;
        const distance=.1+u*(1.1+impact*1.5),radius=.22+u*.55;
        smoke([tip[0]+Math.cos(angle)*distance,.08,tip[2]+Math.sin(angle)*distance*.7],radius,
          impact*(.20+strength*.13)*(1-u*.6),'218,238,247',.32);
      }
    }
    const alpha=clamp(frame.landingSmoke||0);
    if(alpha>.002){
      const c=frame.smokePosition||[frame.position[0],0,0];
      const spread=frame.phase==='landing'?1+frame.phaseProgress*2.3:.8;
      for(let i=0;i<40;i++){
        const a=noise(i+17)*TAU,r=noise(i+61)*3.2*spread;
        smoke([c[0]+Math.cos(a)*r,.12+noise(i+8)*.20,c[2]+Math.sin(a)*r*.55],(.60+noise(i+26)*.75)*spread,.33*alpha,'218,236,246',.42);
      }
    }
  }

  function drawObjects() {
    objects.sort((a,b)=>b.depth-a.depth);
    for(const o of objects){
      if(o.kind==='line'){line(o.points,o.color,o.lineWidth,o.glow);continue;}
      if(o.kind==='face'){
        ctx.beginPath();ctx.moveTo(o.projected[0].x,o.projected[0].y);for(let i=1;i<o.projected.length;i++)ctx.lineTo(o.projected[i].x,o.projected[i].y);ctx.closePath();
        ctx.fillStyle=`rgb(${o.color.join(',')})`;ctx.shadowColor=ctx.fillStyle;ctx.shadowBlur=o.glow||0;ctx.fill();ctx.shadowBlur=0;continue;
      }
      if(o.kind==='smoke'){
        ctx.save();ctx.translate(o.p.x,o.p.y);ctx.scale(1,o.aspect);
        const r=Math.max(.5,o.radius),grad=ctx.createRadialGradient(0,0,0,0,0,r);
        grad.addColorStop(0,`rgba(${o.color},${o.alpha})`);grad.addColorStop(.3,`rgba(${o.color},${o.alpha*.68})`);grad.addColorStop(1,`rgba(${o.color},0)`);
        ctx.fillStyle=grad;ctx.fillRect(-r,-r,r*2,r*2);ctx.restore();continue;
      }
      if(o.kind==='jet'){
        ctx.save();
        if(o.grounded){
          const [left,right]=o.groundLine;
          ctx.beginPath();ctx.moveTo(left.x,left.y);ctx.lineTo(right.x,right.y);ctx.lineTo(right.x,-height*4);ctx.lineTo(left.x,-height*4);ctx.closePath();ctx.clip();
        }
        const dx=o.b.x-o.a.x,dy=o.b.y-o.a.y,length=Math.hypot(dx,dy)||1,nx=-dy/length,ny=dx/length;
        for(const layer of [{spread:1.7,alpha:.12},{spread:.8,alpha:.26}]){
          const w=o.width*layer.spread,grad=ctx.createLinearGradient(o.a.x,o.a.y,o.b.x,o.b.y);
          grad.addColorStop(0,`rgba(238,250,255,${layer.alpha})`);grad.addColorStop(.6,`rgba(178,220,244,${layer.alpha*.85})`);grad.addColorStop(1,'rgba(183,221,242,0)');
          const extend=o.grounded?0:.07;
          ctx.beginPath();ctx.moveTo(o.a.x+nx*.5,o.a.y+ny*.5);ctx.lineTo(o.b.x+nx*w,o.b.y+ny*w);ctx.quadraticCurveTo(o.b.x+dx*extend,o.b.y+dy*extend,o.b.x-nx*w,o.b.y-ny*w);ctx.lineTo(o.a.x-nx*.5,o.a.y-ny*.5);ctx.closePath();ctx.fillStyle=grad;ctx.fill();
        }
        const grad=ctx.createLinearGradient(o.a.x,o.a.y,o.b.x,o.b.y);grad.addColorStop(0,'rgba(240,252,255,.95)');grad.addColorStop(.66,'rgba(210,240,255,.64)');grad.addColorStop(1,'rgba(180,225,250,0)');
        ctx.beginPath();ctx.moveTo(o.a.x,o.a.y);ctx.lineTo(o.b.x,o.b.y);ctx.strokeStyle=grad;ctx.lineWidth=Math.max(.8,o.width*.22);ctx.lineCap='round';ctx.stroke();ctx.lineCap='butt';
        ctx.restore();
      }
    }
  }

  return {
    render(frame) {
      if(disposed)return;
      resize();camera();objects=[];
      ctx.globalAlpha=1;ctx.globalCompositeOperation='source-over';ctx.shadowBlur=0;ctx.lineCap='butt';ctx.lineJoin='round';ctx.setLineDash([]);
      background();
      const lift=Math.max(0,frame.position[1]-.79),x=frame.position[0];
      const points=Array.from({length:32},(_,i)=>{const a=i/32*TAU;return[x+Math.cos(a)*(2.7+lift*.07),.02,Math.sin(a)*(1.15+lift*.06)];});
      polygon(points,`rgba(0,0,0,${.48/(1+lift*.2)})`);
      ramp();
      for(const face of car)queueFace(face.vertices.map(p=>transformRampPoint(p,frame)),face.color,face.emissive,face.glow||0);
      gases(frame);drawObjects();
      // Edge vignette leaves the steel silhouette and pale car readable.
      const shade=ctx.createLinearGradient(0,0,0,height);shade.addColorStop(0,'rgba(0,4,8,.16)');shade.addColorStop(.2,'rgba(0,4,8,0)');shade.addColorStop(.86,'rgba(0,4,8,0)');shade.addColorStop(1,'rgba(0,4,8,.34)');ctx.fillStyle=shade;ctx.fillRect(0,0,width,height);
    },
    dispose(){disposed=true;objects=[];},
  };
}
