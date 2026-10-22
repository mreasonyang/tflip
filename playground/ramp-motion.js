// A deterministic geometric reconstruction, not measured stunt telemetry.
// World +X points into the ramp, +Y is up. Angles are radians.
export const RAMP_DURATION = 8000;
export const RAMP_GEOMETRY = Object.freeze({
  radius: 8.5, width: 4.6, lip: 2.3, thickness: .22,
  wheelRadius: .49, wheelbase: 3.23, frontAxle: 1.61, rearAxle: -1.62,
  pivot: Object.freeze([0,.79,0]),
});
export const RAMP_PHASES = Object.freeze({ approachEnd: 1600, climbEnd: 4700, flightEnd: 7000, duration: RAMP_DURATION });
const G=RAMP_GEOMETRY, inner=G.radius-G.wheelRadius, arcLength=Math.PI*inner;
const startRear=-18+G.rearAxle, entryRear=-G.wheelbase, exitRear=arcLength+G.lip;
const climbSpeed=(exitRear-entryRear)/3.1;
const clamp=(n,a=0,b=1)=>Math.min(b,Math.max(a,n));
const smooth=(n)=>{const t=clamp(n);return t*t*(3-2*t);};
const lerp=(a,b,t)=>a+(b-a)*t;
const hermite=(a,b,va,vb,t,seconds)=>{
  const t2=t*t,t3=t2*t;
  return (2*t3-3*t2+1)*a+(t3-2*t2+t)*va*seconds+(-2*t3+3*t2)*b+(t3-t2)*vb*seconds;
};

/** Wheel-centre path: flat approach, inward-offset C arc, inverted top lip. */
export function rampWheelPath(distance) {
  if(!Number.isFinite(distance))throw new TypeError('Wheel path distance must be finite');
  if(distance<=0)return {center:[distance,G.wheelRadius,0],point:[distance,0,0],normal:[0,1,0],region:'ground',distance};
  if(distance<arcLength) {
    const theta=distance/inner,s=Math.sin(theta),c=Math.cos(theta);
    return {center:[inner*s,G.radius-inner*c,0],point:[G.radius*s,G.radius-G.radius*c,0],normal:[-s,c,0],region:'curve',distance};
  }
  const x=-(distance-arcLength);
  return {center:[x,2*G.radius-G.wheelRadius,0],point:[x,2*G.radius,0],normal:[0,-1,0],region:'lip',distance};
}

/** Solve the rigid axle chord, including one axle on flat/one on curved track. */
export function rampContactPose(rearDistance) {
  const rear=rampWheelPath(rearDistance);
  let lo=rearDistance,hi=rearDistance+G.wheelbase*1.30;
  for(let i=0;i<52;i++) {
    const mid=(lo+hi)/2,p=rampWheelPath(mid).center;
    const separation=Math.hypot(p[0]-rear.center[0],p[1]-rear.center[1]);
    if(separation<G.wheelbase)lo=mid;else hi=mid;
  }
  const front=rampWheelPath((lo+hi)/2);
  const dx=front.center[0]-rear.center[0],dy=front.center[1]-rear.center[1];
  const pitch=Math.atan2(dy,dx),c=Math.cos(pitch),s=Math.sin(pitch);
  const meanX=(G.frontAxle+G.rearAxle)/2,meanY=G.wheelRadius-G.pivot[1];
  const mid=[(front.center[0]+rear.center[0])/2,(front.center[1]+rear.center[1])/2,0];
  const position=[mid[0]-(meanX*c-meanY*s),mid[1]-(meanX*s+meanY*c),0];
  return {
    position,pitch,roll:0,
    contacts:{front:front.distance<=exitRear+1e-9?front:null,rear:rear.distance<=exitRear+1e-9?rear:null},
    wheelCenters:{front:front.center,rear:rear.center},
    rearDistance,frontDistance:front.distance,
  };
}

const exit=rampContactPose(exitRear);
const landingX=exit.position[0]-16;

/** Transform the existing Roadster mesh around its COM using Rz(pitch)*Rx(roll). */
export function transformRampPoint(point,state,direction=false) {
  let [x,y,z]=point;
  if(!direction){x-=G.pivot[0];y-=G.pivot[1];z-=G.pivot[2];}
  const cr=Math.cos(state.roll),sr=Math.sin(state.roll),cp=Math.cos(state.pitch),sp=Math.sin(state.pitch);
  [y,z]=[y*cr-z*sr,y*sr+z*cr];
  [x,y]=[x*cp-y*sp,x*sp+y*cp];
  return direction?[x,y,z]:[x+state.position[0],y+state.position[1],z+state.position[2]];
}

/** Returns fresh state for arbitrary seek; no wall clock or accumulated history. */
export function sampleRamp(timeMs) {
  if(typeof timeMs!=='number'||!Number.isFinite(timeMs))throw new TypeError('Ramp time must be a finite number');
  const time=clamp(timeMs,0,RAMP_DURATION);
  const common={time,duration:RAMP_DURATION,progress:time/RAMP_DURATION,jetStrength:0,landingSmoke:0,smokePosition:[landingX,0,0]};
  if(time<1600) {
    const t=time/1600;
    const distance=hermite(startRear,entryRear,0,climbSpeed,t,1.6);
    return {...common,...rampContactPose(distance),phase:'approach',label:'加速入坡',phaseProgress:t};
  }
  if(time<4700) {
    const t=(time-1600)/3100;
    return {...common,...rampContactPose(lerp(entryRear,exitRear,t)),phase:'climb',label:'贴弧爬升',phaseProgress:t};
  }
  if(time<7000) {
    const t=(time-4700)/2300;
    const position=[hermite(exit.position[0],landingX,-climbSpeed,-4,t,2.3),lerp(exit.position[1],G.pivot[1],smooth(t)),0];
    const roll=Math.PI*smooth((t-.04)/.65);
    return {...common,position,pitch:Math.PI,roll,contacts:{front:null,rear:null},
      phase:'flight',label:t<.69?'离坡 · 半圈回正':'正立下降',phaseProgress:t,
      jetStrength:.40+.54*smooth((t-.30)/.60),landingSmoke:smooth((t-.84)/.16)*.85,
    };
  }
  const t=(time-7000)/1000;
  const bounce=.065*Math.sin(Math.PI*t)**2*(1-t)**2;
  const state={...common,position:[landingX-4*t+2*t*t,G.pivot[1]+bounce,0],pitch:Math.PI,roll:Math.PI,
    phase:time===RAMP_DURATION?'finished':'landing',label:time===RAMP_DURATION?'完成':'落地缓冲',phaseProgress:t,
    jetStrength:time===RAMP_DURATION?0:.30*(1-t)**2,landingSmoke:time===RAMP_DURATION?0:(1-t)**1.1,
  };
  const contact=(axle)=>{
    const center=transformRampPoint([axle,G.wheelRadius,0],state);
    return bounce<1e-7?{center,point:[center[0],0,0],normal:[0,1,0],region:'ground'}:null;
  };
  return {...state,contacts:{front:contact(G.frontAxle),rear:contact(G.rearAxle)}};
}
