import { roadsterMesh, semiMesh, sedanMesh, cybertruckMesh, roadsterNozzles } from './roadster-geometry.js';

const TAU = Math.PI * 2;
const clamp = (v, lo=0, hi=1) => Math.min(hi,Math.max(lo,v));
const dot = (a,b) => a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
const sub = (a,b) => [a[0]-b[0],a[1]-b[1],a[2]-b[2]];
const cross = (a,b) => [a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const unit = (a) => { const n=Math.hypot(...a)||1;return a.map(v=>v/n); };
const noise = (n) => {const x=Math.sin(n*127.1+311.7)*43758.5453123;return x-Math.floor(x);};
const add = (a,b,k=1) => a.map((v,i)=>v+b[i]*k);
const lampWhite = [198,231,241];

/**
 * An original procedural reconstruction of the referenced night stunt.
 * No timer, event listener, observer or animation frame is owned here.
 * Re-rendering the same frame/size gives the same geometry and cold-gas plume.
 * pose.x: track position in metres; -pose.y: lift; rotateX: longitudinal roll.
 */
export function createRoadsterScene(canvas) {
  const context=canvas.getContext('2d',{alpha:false});
  if(!context) throw new Error('Roadster scene requires a Canvas 2D context');
  let disposed=false, width=0, height=0, dpr=1;
  const car=roadsterMesh(), semi=semiMesh(), sedan=sedanMesh(), cyber=cybertruckMesh();
  const darkSedan=sedanMesh([67,86,99]);
  const light=unit([-2,5,3]);
  let project, objects=[];

  function resize() {
    const bounds=canvas.getBoundingClientRect();
    const w=Math.max(1,Math.round(bounds.width||canvas.clientWidth||960));
    const h=Math.max(1,Math.round(bounds.height||canvas.clientHeight||540));
    const density=Math.min(2,Math.max(1,canvas.ownerDocument.defaultView?.devicePixelRatio||1));
    if(w!==width||h!==height||density!==dpr) {
      width=w;height=h;dpr=density;
      canvas.width=Math.round(w*dpr);canvas.height=Math.round(h*dpr);
    }
    context.setTransform(dpr,0,0,dpr,0,0);
  }

  function camera(x) {
    const follow=x*.14;
    const eye=[-28+follow,5.8,-25.5], target=[1+follow,1.10,0];
    const forward=unit(sub(target,eye));
    const right=unit(cross(forward,[0,1,0]));
    const up=unit(cross(right,forward));
    // Portrait canvases widen the view so the complete takeoff/landing fits.
    const focal=Math.min(width*1.13,height*2.30);
    project=(p)=>{
      const relative=sub(p,eye), depth=dot(relative,forward);
      if(depth<.2)return null;
      return { x:width*.51+dot(relative,right)*focal/depth, y:height*.57-dot(relative,up)*focal/depth, depth, scale:focal/depth };
    };
  }

  function path(points) {
    const p=points.map(project);
    if(p.some(v=>!v))return false;
    context.beginPath();context.moveTo(p[0].x,p[0].y);
    for(let i=1;i<p.length;i++)context.lineTo(p[i].x,p[i].y);
    context.closePath();return true;
  }

  function polygon(points,color) {if(path(points)){context.fillStyle=color;context.fill();}}

  function line(points,color,widthPx=1,glow=0) {
    const p=points.map(project);if(p.some(v=>!v))return;
    context.beginPath();context.moveTo(p[0].x,p[0].y);
    for(let i=1;i<p.length;i++)context.lineTo(p[i].x,p[i].y);
    context.lineWidth=widthPx;context.strokeStyle=color;
    if(glow){context.shadowBlur=glow;context.shadowColor=color;}
    context.stroke();context.shadowBlur=0;
  }

  function halo(point,size,color,opacity) {
    const p=project(point);if(!p)return;
    const radius=Math.max(1,p.scale*size);
    const gradient=context.createRadialGradient(p.x,p.y,0,p.x,p.y,radius);
    gradient.addColorStop(0,`rgba(${color.join(',')},${opacity})`);
    gradient.addColorStop(.24,`rgba(${color.join(',')},${opacity*.36})`);
    gradient.addColorStop(1,`rgba(${color.join(',')},0)`);
    context.fillStyle=gradient;context.fillRect(p.x-radius,p.y-radius,radius*2,radius*2);
  }

  function background() {
    const sky=context.createLinearGradient(0,0,0,height);
    sky.addColorStop(0,'#02070b');sky.addColorStop(.50,'#071119');sky.addColorStop(1,'#0b1720');
    context.fillStyle=sky;context.fillRect(0,0,width,height);
    // Remote hangar silhouettes keep the night readable without a bright sky.
    polygon([[23,0,-24],[23,5,-24],[23,5,-7],[23,0,-7]],'#070d13');
    polygon([[29,0,-7],[29,3.8,-7],[29,3.8,18],[29,0,18]],'#071018');
    polygon([[-31,0,-15],[35,0,-15],[35,0,15],[-31,0,15]],'#101b22');
    polygon([[-30,.005,-8.7],[30,.005,-8.7],[30,.005,8.7],[-30,.005,8.7]],'#152027');
    // Long wet streaks have stable world positions rather than screen noise.
    for(let i=0;i<205;i++) {
      const x=-30+noise(i+4)*60,z=-8.5+noise(i+870)*17;
      const length=.12+noise(i+112)*1.4;
      const shade=.025+noise(i+211)*.045;
      line([[x,.009,z],[x+length,.009,z]],`rgba(181,213,225,${shade})`,.45+noise(i+501));
    }
    // The source has one continuous white centre line, not lane dashes.
    polygon([[-30,.012,-.055],[31,.012,-.055],[31,.012,.055],[-30,.012,.055]],'rgba(206,219,221,.64)');
    for(const z of [-8.6,8.6]) {
      line([[-27,.025,z],[28,.025,z]],'rgba(163,190,204,.24)',.7);
      line([[-21,.10,z],[20,.10,z]],'rgba(255,45,57,.58)',1.25,8);
      for(let x=-20;x<22;x+=3.5) {
        line([[x,0,z+.25],[x,1.0,z+.25]],'#263840',1);
        const lp=[x,.42,z];
        halo(lp,.6,[255,28,45],.09);
      }
      line([[-22,.8,z+.25],[24,.8,z+.25]],'rgba(92,117,132,.26)',.7);
    }
    // Red-lit obstacle platform and side ramps.
    polygon([[-2.4,.035,-10],[2.1,.035,-10],[2.1,.035,9.5],[-2.4,.035,9.5]],'#1b272e');
    line([[-2.3,.07,-9.5],[-2.3,.07,9]],'rgba(255,43,57,.88)',2.1,14);
    line([[1.8,.08,-9.5],[1.8,.08,9]],'rgba(235,32,50,.56)',1.5,8);
    for(let i=0;i<38;i++) {
      const z=-9.4+i*.48;
      line([[-3.7,.011,z],[-2.4,.011,z]],`rgba(239,44,62,${.012+noise(i+77)*.035})`,1.2);
    }
    // Floodlight towers and the pale reflected pools beneath them.
    for(const [x,z] of [[5,-10],[7,10],[15,-7]]) {
      line([[x,.1,z],[x,7.4,z]],'#33434c',1.25);
      line([[x-.55,7.0,z],[x+.55,7.0,z]],'#445861',2);
      halo([x,6.95,z],3.8,lampWhite,.11);
      for(let i=0;i<3;i++) {
        const lp=[x+(i-1)*.33,7.07,z];
        halo(lp,.44,[224,249,255],.80);
        const p=project(lp);if(p){context.fillStyle='#edfcff';context.beginPath();context.arc(p.x,p.y,Math.max(1.4,p.scale*.055),0,TAU);context.fill();}
      }
      const top=project([x,6.95,z]);const left=project([x-7,0,z-2.8]);const right=project([x+2,0,z+2.8]);
      if(top&&left&&right) {
        const grad=context.createLinearGradient(top.x,top.y,(left.x+right.x)/2,(left.y+right.y)/2);
        grad.addColorStop(0,'rgba(176,223,237,.025)');grad.addColorStop(1,'rgba(176,223,237,.002)');
        context.beginPath();context.moveTo(top.x,top.y);context.lineTo(left.x,left.y);context.lineTo(right.x,right.y);context.closePath();context.fillStyle=grad;context.fill();
      }
      halo([x-2,.01,z*.65],3.0,[180,215,227],.06);
    }
    // Distant low floodlights like the rows in the reference video.
    for(const z of [-8,8])for(let i=0;i<6;i++) {
      const lp=[-10+i*4,.65,z];halo(lp,.33,[190,231,247],.27);
      const p=project(lp);if(p){context.fillStyle='rgba(210,243,252,.72)';context.fillRect(p.x-1.2,p.y-1.2,2.4,2.4);}
    }
  }

  function carTransform(pose) {
    const ax=(Number(pose.rotateX)||0)*Math.PI/180;
    const ay=(Number(pose.rotateY)||0)*Math.PI/180;
    const az=(Number(pose.rotateZ)||0)*Math.PI/180;
    const cx=Math.cos(ax),sx=Math.sin(ax),cy=Math.cos(ay),sy=Math.sin(ay),cz=Math.cos(az),sz=Math.sin(az);
    const lift=-(Number(pose.y)||0), x=Number(pose.x)||0, z=Number(pose.z)||0;
    return (point,direction=false)=>{
      let [a,b,c]=point;
      if(!direction)b-=.79;
      // Positive longitudinal roll: viewed from behind, right-hand side rises.
      [b,c]=[b*cx+c*sx,-b*sx+c*cx];
      [a,c]=[a*cy+c*sy,-a*sy+c*cy];
      [a,b]=[a*cz-b*sz,a*sz+b*cz];
      return direction?[a,b,c]:[a+x,b+.79+lift,c+z];
    };
  }

  function stationary(x,z,angle=0,scale=1) {
    const c=Math.cos(angle),s=Math.sin(angle);
    return p=>[x+(p[0]*c-p[2]*s)*scale,p[1]*scale,z+(p[0]*s+p[2]*c)*scale];
  }

  function addMesh(mesh,transform) {
    for(const f of mesh) {
      const vertices=f.vertices.map(p=>transform(p));
      const projected=vertices.map(project);if(projected.some(p=>!p))continue;
      const normal=unit(cross(sub(vertices[1],vertices[0]),sub(vertices[2],vertices[0])));
      // Gentle fill light is intentional: the original is too dark for a UI demo.
      const illumination=f.emissive?1:.52+.38*Math.abs(dot(normal,light))+.11*Math.max(0,normal[1]);
      const color=f.color.map(v=>Math.round(clamp(v*illumination,0,255)));
      objects.push({kind:'face',projected,color,depth:projected.reduce((a,p)=>a+p.depth,0)/projected.length,glow:f.glow||0,emissive:f.emissive});
    }
  }

  function groundShadow(pose) {
    const lift=Math.max(0,-pose.y), x=pose.x||0,z=pose.z||0;
    const points=Array.from({length:36},(_,i)=>{const t=i/36*TAU;return[x+Math.cos(t)*(2.6+lift*.13),.02,z+Math.sin(t)*(1.22+lift*.13)];});
    context.shadowBlur=18;context.shadowColor='rgba(0,0,0,.50)';
    polygon(points,`rgba(0,0,0,${.52/(1+lift*.25)})`);context.shadowBlur=0;
    halo([x-2.4,.02,z],1.7,[255,26,47],.07/(1+lift*.8));
  }

  function smoke(position,radius,opacity,color,aspect=1.0,angle=0) {
    const p=project(position);if(!p||opacity<=.001)return;
    objects.push({kind:'smoke',depth:p.depth,p,radius:radius*p.scale,opacity,color,aspect,angle});
  }

  function coldJets(frame,transform) {
    // This gate includes residual clouds: disabled/reduced means zero gas pixels.
    if(frame.jet===false||frame.reducedMotion||frame.progress<=0||frame.progress>=1)return;
    const pose=frame.pose, phase=pose.phase;
    if(frame.segment==='approach')return;
    if(frame.segment==='rollout') {
      const progress=clamp(Number(frame.segmentProgress)||0);
      const fade=(1-progress)**1.5*.65;
      landingCloud((pose.x||0)-progress*4,pose.z||0,1.5+progress*2,fade);
      return;
    }
    if(!['anticipation','launch','roll','descent','settle'].includes(phase))return;
    const flight=['launch','roll','descent'].includes(phase);
    const intensity=flight?Math.max(.27,Number(pose.thrust)||0):(Number(pose.thrust)||0)*.5;
    const seconds=(Number(frame.time)||0)/1000;
    if(intensity>.015) {
      for(let n=0;n<roadsterNozzles.length;n++) {
        const nozzle=roadsterNozzles[n], origin=transform(nozzle);
        const direction=unit(transform([0,-1,(n%2?1:-1)*.08],true));
        const side=unit(transform([0,.08,1],true));
        const along=unit(transform([1,0,0],true));
        const length=1.65+intensity*2.2;
        for(let j=0;j<25;j++) {
          const u=(j/25+seconds*1.8+n*.13)%1;
          const distance=.04+u*length;
          const spread=.015+u*u*.24;
          const point=add(add(add(origin,direction,distance),side,(noise(n*67+j*3)-.5)*spread),along,(noise(n*89+j*9)-.5)*spread);
          smoke(point,.028+u*.21,(.18+.22*intensity)*(1-u)**.85,[180,222,239],1.4,Math.atan2(direction[2],direction[1]));
          if(j%3===0)smoke(add(point,side,.04),.06+u*.29,.10*(1-u),[209,232,239],1.25);
        }
        const end=add(origin,direction,length*.92);
        const p1=project(origin),p2=project(end);
        if(p1&&p2)objects.push({kind:'jet',depth:(p1.depth+p2.depth)/2,p1,p2,alpha:.43+intensity*.25});
        // Gas expands into a soft cloud where a down-facing stream meets tarmac.
        if(direction[1]<-.2) {
          const distance=origin[1]/-direction[1];
          if(distance<7) {
            const hit=add(origin,direction,distance);
            for(let j=0;j<8;j++) {
              const a=noise(j+n*17)*TAU,r=.25+noise(j+n*77)*1.2;
              smoke([hit[0]+Math.cos(a)*r,.12+noise(j+40)*.15,hit[2]+Math.sin(a)*r],.30+noise(j+85)*.45,.045*intensity,[176,209,219],2.2);
            }
          }
        }
      }
    }
    if(phase==='settle') {
      const local=frame.segmentProgress??frame.progress;
      const fade=.65+.35*clamp((1-local)*12);
      landingCloud(pose.x||0,pose.z||0,1+(1-clamp((1-local)*12))*.5,fade);
    }
  }

  function landingCloud(x,z,spread,fade) {
    for(let i=0;i<32;i++) {
      const a=noise(i+88)*TAU, r=(.6+noise(i+192)*1.9)*spread;
      smoke([x+Math.cos(a)*r,.18+noise(i+812)*.5,z+Math.sin(a)*r*.65],.40+noise(i+44)*.65,.11*fade,[184,211,220],1.6);
    }
  }

  function paintObjects() {
    objects.sort((a,b)=>b.depth-a.depth);
    for(const object of objects) {
      if(object.kind==='face') {
        context.beginPath();context.moveTo(object.projected[0].x,object.projected[0].y);
        for(let i=1;i<object.projected.length;i++)context.lineTo(object.projected[i].x,object.projected[i].y);
        context.closePath();context.fillStyle=`rgb(${object.color.join(',')})`;
        if(object.glow){context.shadowBlur=object.glow;context.shadowColor=context.fillStyle;}
        context.fill();context.shadowBlur=0;
        if(!object.emissive){context.strokeStyle='rgba(5,13,19,.21)';context.lineWidth=.35;context.stroke();}
      } else if(object.kind==='jet') {
        const dx=object.p2.x-object.p1.x,dy=object.p2.y-object.p1.y,length=Math.hypot(dx,dy)||1;
        const nx=-dy/length,ny=dx/length;
        const near=Math.max(.5,object.p1.scale*.026),far=Math.max(2,object.p2.scale*.20);
        // Continuous translucent cone carries the gas; particles are only wisps.
        const cone=context.createLinearGradient(object.p1.x,object.p1.y,object.p2.x,object.p2.y);
        cone.addColorStop(0,`rgba(208,239,250,${object.alpha*.23})`);
        cone.addColorStop(.22,`rgba(194,229,243,${object.alpha*.34})`);
        cone.addColorStop(.75,`rgba(178,220,239,${object.alpha*.13})`);
        cone.addColorStop(1,'rgba(178,220,239,0)');
        context.beginPath();
        context.moveTo(object.p1.x+nx*near,object.p1.y+ny*near);
        context.lineTo(object.p2.x+nx*far,object.p2.y+ny*far);
        context.lineTo(object.p2.x-nx*far,object.p2.y-ny*far);
        context.lineTo(object.p1.x-nx*near,object.p1.y-ny*near);
        context.closePath();context.fillStyle=cone;
        context.shadowBlur=3;context.shadowColor='rgba(179,225,241,.26)';context.fill();context.shadowBlur=0;
        context.beginPath();context.moveTo(object.p1.x,object.p1.y);context.lineTo(object.p2.x,object.p2.y);
        const g=context.createLinearGradient(object.p1.x,object.p1.y,object.p2.x,object.p2.y);
        g.addColorStop(0,`rgba(237,250,255,${object.alpha})`);
        g.addColorStop(.50,`rgba(220,243,252,${object.alpha*.35})`);
        g.addColorStop(1,'rgba(193,233,247,0)');
        context.strokeStyle=g;context.lineWidth=Math.max(1.15,object.p1.scale*.046);context.lineCap='round';context.stroke();context.lineCap='butt';
      } else {
        const r=Math.max(.5,object.radius);
        context.save();context.translate(object.p.x,object.p.y);context.rotate(object.angle||0);context.scale(object.aspect,1);
        const g=context.createRadialGradient(0,0,0,0,0,r);
        g.addColorStop(0,`rgba(${object.color.join(',')},${object.opacity})`);
        g.addColorStop(.43,`rgba(${object.color.join(',')},${object.opacity*.62})`);
        g.addColorStop(1,`rgba(${object.color.join(',')},0)`);
        context.fillStyle=g;context.fillRect(-r,-r,r*2,r*2);context.restore();
      }
    }
  }

  function render(frame) {
    if(disposed)return;
    if(!frame||!frame.pose)throw new TypeError('Roadster render requires a sampled pose');
    resize();objects=[];
    const pose=frame.pose;
    camera(Number(pose.x)||0);
    background();
    groundShadow(pose);
    addMesh(semi,stationary(.45,-2.40,-Math.PI/2,.96));
    addMesh(sedan,stationary(-1.16,3.32,-Math.PI/2,.87));
    addMesh(cyber,stationary(.6,-8.1,-Math.PI/2,.80));
    addMesh(darkSedan,stationary(1.6,8.1,-Math.PI/2,.78));
    const transform=carTransform(pose);
    addMesh(car,transform);
    coldJets(frame,transform);
    paintObjects();
    // A slight vignette keeps the black stage feeling like the filmed night.
    const vignette=context.createRadialGradient(width*.5,height*.50,width*.20,width*.5,height*.5,Math.max(width,height)*.68);
    vignette.addColorStop(0,'rgba(0,0,0,0)');vignette.addColorStop(.68,'rgba(0,0,0,.03)');vignette.addColorStop(1,'rgba(0,0,0,.50)');
    context.fillStyle=vignette;context.fillRect(0,0,width,height);
  }

  function dispose(){if(disposed)return;disposed=true;objects=[];context.clearRect(0,0,canvas.width,canvas.height);}
  return {render,dispose};
}
