// Small purpose-built meshes in metres. +X is the nose, +Y is up, +Z is right.
// Geometry is deliberately original and procedural; no Tesla model/bitmap asset.
const WHITE = [195, 207, 213];
const GLASS = [17, 31, 38];

function face(mesh, vertices, color, options = {}) {
  mesh.push({ vertices, color, ...options });
}

function box(mesh, x1, y1, z1, x2, y2, z2, color, options = {}) {
  const a = [x1,y1,z1], b = [x2,y1,z1], c = [x2,y2,z1], d = [x1,y2,z1];
  const e = [x1,y1,z2], f = [x2,y1,z2], g = [x2,y2,z2], h = [x1,y2,z2];
  for (const points of [[a,b,c,d],[f,e,h,g],[e,a,d,h],[b,f,g,c],[d,c,g,h],[e,f,b,a]]) face(mesh,points,color,options);
}

function ringPoints(x, y, z, radius, count = 20, axis = 'z') {
  return Array.from({ length: count }, (_, i) => {
    const t = i / count * Math.PI * 2;
    return axis === 'x' ? [x, y + Math.cos(t) * radius, z + Math.sin(t) * radius]
      : axis === 'y' ? [x + Math.cos(t) * radius, y, z + Math.sin(t) * radius]
        : [x + Math.cos(t) * radius, y + Math.sin(t) * radius, z];
  });
}

function wheel(mesh, x, z, radius = .49, segments = 20, bright = true) {
  const side = z < 0 ? -1 : 1;
  const inner = z - side * .15, outer = z + side * .14;
  const ringA = ringPoints(x, radius, inner, radius, segments);
  const ringB = ringPoints(x, radius, outer, radius, segments);
  for (let i = 0; i < segments; i++) {
    const j = (i + 1) % segments;
    face(mesh, [ringA[i],ringA[j],ringB[j],ringB[i]], [17,22,25]);
  }
  face(mesh, ringA, [15,20,23]);
  face(mesh, ringB, [21,27,30]);
  face(mesh, ringPoints(x, radius, outer + side * .006, radius * .81, segments), bright ? [91,108,116] : [55,64,69]);
  face(mesh, ringPoints(x, radius, outer + side * .012, radius * .74, segments), [43,54,61]);
  for (let i = 0; i < 10; i++) {
    const t = i * Math.PI / 5;
    const coordinates = [t-.035,t+.035,t+.07,t-.07];
    const rr = [radius*.18,radius*.18,radius*.68,radius*.68];
    face(mesh, coordinates.map((a,j) => [x + Math.cos(a) * rr[j], radius + Math.sin(a) * rr[j], outer + side * .018]), bright ? [128,143,149] : [79,88,92]);
  }
  face(mesh, ringPoints(x,radius,outer+side*.025,radius*.13,12), [26,37,42]);
  face(mesh, ringPoints(x,radius,outer+side*.027,radius*.055,10), [163,174,178]);
}

function strip(mesh, a, b, thickness, color, emissive = false) {
  face(mesh, [a,b,[b[0],b[1]+thickness,b[2]],[a[0],a[1]+thickness,a[2]]],color,{emissive,glow:emissive?7:0});
}

export function roadsterMesh() {
  const mesh = [];
  // Cross sections give the low wedge, broad rear haunches, and pointed nose.
  const sections = [
    [-2.47,.88,.90,.37],[-2.16,1.06,1.00,.30],[-1.50,1.07,1.08,.33],
    [-.75,1.00,1.10,.32],[.60,.97,1.03,.31],[1.55,1.02,1.05,.31],[2.22,.85,.65,.34],[2.55,.69,.52,.37],
  ];
  for(let i=0;i<sections.length-1;i++) {
    const [x,w,h,b]=sections[i], [xx,ww,hh,bb]=sections[i+1];
    for(const side of [-1,1]) {
      // Rounded shoulders break up the box cross-section with two long bevels.
      face(mesh,[[x,h-.09,w*side],[xx,hh-.09,ww*side],[xx,bb+.09,ww*.97*side],[x,b+.09,w*.97*side]],WHITE);
      face(mesh,[[x,h,w*.87*side],[xx,hh,ww*.87*side],[xx,hh-.09,ww*side],[x,h-.09,w*side]],[211,224,231]);
      face(mesh,[[x,b+.09,w*.97*side],[xx,bb+.09,ww*.97*side],[xx,bb,ww*.92*side],[x,b,w*.92*side]],[119,142,156]);
      face(mesh,[[x,h+.045,0],[xx,hh+.045,0],[xx,hh,ww*.87*side],[x,h,w*.87*side]],[208,219,224]);
      face(mesh,[[x,b,w*.92*side],[xx,bb,ww*.92*side],[xx,bb-.055,ww*.88*side],[x,b-.055,w*.88*side]],[29,40,47]);
    }
  }
  face(mesh,[[-2.47,.37,-.84],[-2.47,.37,.84],[-2.47,.91,.90],[-2.47,.91,-.90]],[102,119,128]);
  face(mesh,[[2.55,.37,-.69],[2.55,.52,-.69],[2.55,.52,.69],[2.55,.37,.69]],[157,176,184]);
  // Black roof, long rear glass and deep angled windshield.
  face(mesh,[[-1.72,1.10,-.83],[-1.72,1.10,.83],[-.55,1.60,.69],[-.55,1.60,-.69]],GLASS);
  face(mesh,[[-.55,1.60,-.69],[-.55,1.60,.69],[.17,1.61,.67],[.17,1.61,-.67]],[23,38,45]);
  face(mesh,[[.17,1.61,-.67],[.17,1.61,.67],[1.12,1.04,.84],[1.12,1.04,-.84]],[30,51,61]);
  for(const side of [-1,1]) {
    face(mesh,[[-1.65,1.11,.85*side],[-.55,1.61,.70*side],[.17,1.62,.68*side],[1.10,1.04,.86*side]], [180,196,205]);
    face(mesh,[[-1.40,1.14,.87*side],[-.48,1.55,.73*side],[.12,1.56,.71*side],[.96,1.09,.88*side]],GLASS);
    face(mesh,[[-.52,1.54,.735*side],[-.45,1.56,.735*side],[-.51,1.12,.923*side],[-.59,1.12,.923*side]],[87,104,114]);
    // Door seam and flush handle.
    face(mesh,[[-1.14,.99,1.011*side],[-1.125,.99,1.012*side],[-.91,.42,.947*side],[-.925,.42,.947*side]],[86,105,114]);
    face(mesh,[[.63,.98,.978*side],[.645,.98,.979*side],[.49,.39,.921*side],[.475,.39,.921*side]],[84,103,113]);
    box(mesh,-.82,.91,.999*side,-.51,.935,1.012*side,[64,82,91]);
    box(mesh,.64,1.03,.96*side,.98,1.16,1.13*side,[42,57,66]);
    // Thin front light on both shoulders.
    face(mesh,[[1.98,.71,.886*side],[2.48,.55,.70*side],[2.44,.59,.72*side],[1.99,.75,.885*side]],[214,242,255],{emissive:true,glow:6});
  }
  // Rear red ribbon and dark diffuser are key recognition cues in the clip.
  strip(mesh,[-2.486,.76,-.86],[-2.486,.76,.86],.055,[255,48,67],true);
  face(mesh,[[-2.49,.72,-.91],[-2.49,.72,.91],[-2.49,.36,.79],[-2.49,.36,-.79]],[14,23,29]);
  box(mesh,-2.53,.38,-.30,-2.49,.57,.30,[47,60,69]);
  face(mesh,[[-2.535,.43,-.22],[-2.535,.43,.22],[-2.535,.53,.22],[-2.535,.53,-.22]],[147,165,171]);
  for(const z of [-.70,-.35,0,.35,.70]) box(mesh,-2.55,.24,z-.025,-1.97,.39,z+.025,[24,36,44]);
  for(const z of [-.66,-.22,.22,.66]) {
    face(mesh,ringPoints(-2.54,.53,z,.077,14,'x'),[142,159,168]);
    face(mesh,ringPoints(-2.545,.53,z,.051,14,'x'),[10,17,21]);
  }
  // Closed undertray and reinforcement ribs remain legible at half a roll.
  box(mesh,-2.13,.22,-.82,2.15,.31,.82,[26,39,48]);
  for(let x=-1.8;x<=1.81;x+=.6) box(mesh,x,.18,-.82,x+.055,.22,.82,[78,99,110]);
  for(const z of [-.68,-.24,.24,.68]) box(mesh,-2.1,.17,z-.022,2.1,.22,z+.022,[72,93,103]);
  box(mesh,-.9,.16,-.18,.72,.2,.18,[65,87,98]);
  // Four visible corner cold-gas outlets; total hardware count is not asserted.
  for(const x of [-1.94,1.86]) for(const z of [-.79,.79]) {
    face(mesh,ringPoints(x,.15,z,.10,14,'y'),[157,178,189]);
    face(mesh,ringPoints(x,.145,z,.068,14,'y'),[13,27,34]);
  }
  for(const x of [-1.62,1.61]) for(const z of [-1.025,1.025]) wheel(mesh,x,z);
  return mesh;
}

export function sedanMesh(color = [172,155,112]) {
  const mesh=[];
  box(mesh,-2.30,.36,-.91,2.28,.92,.91,color);
  face(mesh,[[-2.3,.92,-.91],[-2.3,.92,.91],[-1.08,1.08,.86],[-1.08,1.08,-.86]],color);
  face(mesh,[[-1.08,1.08,-.86],[-1.08,1.08,.86],[-.52,1.52,.67],[-.52,1.52,-.67]],GLASS);
  face(mesh,[[-.52,1.52,-.67],[-.52,1.52,.67],[.67,1.50,.64],[.67,1.50,-.64]],color);
  face(mesh,[[.67,1.50,-.64],[.67,1.50,.64],[1.36,.95,.86],[1.36,.95,-.86]],GLASS);
  for(const s of [-1,1]) {
    face(mesh,[[-1.07,1.08,.87*s],[-.50,1.48,.69*s],[.65,1.46,.67*s],[1.33,.96,.88*s]],[22,35,42]);
    strip(mesh,[2.30,.71,.75*s],[2.30,.71,.35*s],.07,[212,231,232],true);
  }
  strip(mesh,[-2.32,.75,-.8],[-2.32,.75,.8],.04,[224,40,47],true);
  for(const x of [-1.43,1.47])for(const z of [-.91,.91])wheel(mesh,x,z,.46,12,false);
  return mesh;
}

export function semiMesh() {
  const mesh=[];
  box(mesh,-4.1,.55,-1.12,3.65,.82,1.12,[39,51,59]);
  // Swept Tesla Semi cabin, windshield and tall rear fairing.
  for(const s of [-1,1]) {
    face(mesh,[[.10,.85,1.17*s],[3.73,.85,1.17*s],[3.66,1.64,1.2*s],[2.59,3.32,1.02*s],[1.54,4.00,.96*s],[.10,4.02,1.00*s]],[191,208,217]);
    face(mesh,[[1.22,2.02,1.192*s],[3.25,2.02,1.193*s],[2.58,3.16,1.04*s],[1.17,3.20,1.06*s]],GLASS);
    face(mesh,[[1.19,1.95,1.194*s],[1.19,1.92,1.195*s],[3.29,1.92,1.194*s],[3.26,1.95,1.194*s]],[126,150,163]);
    box(mesh,1.04,1.34,1.18*s,1.19,1.38,1.20*s,[69,94,107]);
  }
  face(mesh,[[.10,4.02,-1],[.10,4.02,1],[1.54,4.00,.96],[1.54,4.00,-.96]],[222,234,239]);
  face(mesh,[[1.54,4,-.96],[1.54,4,.96],[2.59,3.32,1.02],[2.59,3.32,-1.02]],[208,222,230]);
  face(mesh,[[2.59,3.32,-1.02],[2.59,3.32,1.02],[3.66,1.64,1.2],[3.66,1.64,-1.2]],[27,49,60]);
  face(mesh,[[3.66,1.64,-1.2],[3.66,1.64,1.2],[3.73,.85,1.17],[3.73,.85,-1.17]],[191,212,223]);
  face(mesh,[[.1,.85,-1.17],[.1,.85,1.17],[.1,4.02,1],[.1,4.02,-1]],[151,173,185]);
  strip(mesh,[3.74,1.02,-1.05],[3.74,1.02,1.05],.07,[215,241,248],true);
  box(mesh,3.74,.81,-.70,3.76,.95,.70,[34,52,63]);
  box(mesh,-1.9,.82,-.80,-.2,1.02,.80,[23,34,42]);
  box(mesh,-3.7,.92,-.75,-2.3,1.15,.75,[34,49,58]);
  for(const x of [-3.4,-2.10,2.57])for(const z of [-1.12,1.12])wheel(mesh,x,z,.60,14,true);
  for(const z of [-.75,-.37,0,.37,.75])box(mesh,1.36,4.01,z-.035,1.46,4.035,z+.035,[240,213,163],{emissive:true,glow:4});
  return mesh;
}

export function cybertruckMesh() {
  const mesh=[], color=[130,148,159];
  for(const s of [-1,1])face(mesh,[[-2.55,.48,1.03*s],[-2.55,1.17,1.03*s],[-.28,1.89,.94*s],[2.33,1.09,1.01*s],[2.6,.66,.94*s],[2.30,.43,.94*s]],color);
  face(mesh,[[-2.55,1.17,-1.03],[-2.55,1.17,1.03],[-.28,1.89,.94],[-.28,1.89,-.94]],[72,91,105]);
  face(mesh,[[-.28,1.89,-.94],[-.28,1.89,.94],[2.33,1.09,1.01],[2.33,1.09,-1.01]],GLASS);
  face(mesh,[[2.33,1.09,-1.01],[2.33,1.09,1.01],[2.6,.66,.94],[2.6,.66,-.94]],[162,181,193]);
  for(const s of [-1,1])face(mesh,[[-1.87,1.25,1.039*s],[-.29,1.80,.958*s],[1.72,1.20,1.014*s]],GLASS);
  strip(mesh,[2.59,.82,-.91],[2.59,.82,.91],.045,[224,244,251],true);
  strip(mesh,[-2.57,1.04,-.91],[-2.57,1.04,.91],.045,[244,46,53],true);
  for(const x of [-1.72,1.69])for(const z of [-1.04,1.04])wheel(mesh,x,z,.53,12,false);
  return mesh;
}

export const roadsterNozzles = Object.freeze([
  [-1.94,.14,-.79],[-1.94,.14,.79],[1.86,.14,-.79],[1.86,.14,.79],
]);
