import {drawSection, drawVolume} from "./material-views.js";

const get = id => document.getElementById(id);
const wafer = get("wafer"), resist = get("resist"), volume = get("volume");
const resistMap = get("resist-map");
const widthInput = get("window-width"), heightInput = get("window-height");
const steps = [...document.querySelectorAll("[data-layer]")];
const catalog = window.layoutCases;
const waferColors = [[19,33,58],[35,81,124],[40,153,157],[150,238,225]];
const resistColors = [[33,22,55],[88,50,120],[168,75,118],[247,153,92],[255,232,173]];
const cache = new Map();
let active, selected = 0, layer = 0, after = true, movable = false, binary = false;
let x0, y0, w, h, localX, localY, alongX = true;
let yaw = -.63, tilt = .61, drag = null, timer = null, frame = null;

function decode(encoded, Type) {
  return new Type(Uint8Array.from(atob(encoded), char => char.charCodeAt(0)).buffer);
}

async function readCase(index) {
  const response = await fetch(catalog[index].path);
  if (!response.ok) throw new Error("Layout request failed");
  const bytes = new Uint8Array(await response.arrayBuffer());
  const data = bytes[0] === 31 && bytes[1] === 139
    ? await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"))).json()
    : JSON.parse(new TextDecoder().decode(bytes));

  for (const state of data.states) {
    state.height = decode(state.height,Float32Array);
    state.ids = decode(state.ids,Uint8Array);
    state.top = decode(state.top,Float32Array);
    state.bottom = decode(state.bottom,Float32Array);
  }
  data.resists = data.resists.map(value => decode(value,Float32Array));
  return data;
}

function colorAt(palette, ratio) {
  const t = Math.max(0,Math.min(1,ratio))*(palette.length-1);
  const i = Math.min(Math.floor(t),palette.length-2);
  return palette[i].map((value,k) => Math.round(value+(t-i)*(palette[i+1][k]-value)));
}

function drawMap(canvas, color) {
  const ctx = canvas.getContext("2d");
  const {width,height} = canvas;
  const image = ctx.createImageData(width,height);
  for (let y=0; y<height; y++) {
    for (let x=0; x<width; x++) {
      const offset = ((height-1-y)*width+x)*4;
      const [r,g,b] = color(x,y);
      image.data[offset]=r; image.data[offset+1]=g; image.data[offset+2]=b; image.data[offset+3]=255;
    }
  }
  ctx.putImageData(image,0,0);
}

function currentState() {
  return active.states[layer+Number(after)];
}

function cellAt(x,y) { return (y0+y)*128+x0+x; }

function pressed(id,on) { get(id).setAttribute("aria-pressed",String(on)); }

function drawResist() {
  const height = active.resists[layer];
  drawMap(resist,(x,y) => {
    const z = height[y*128+x];
    return binary ? (z<10 ? [255,232,173] : [33,22,55]) : colorAt(resistColors,z/135);
  });
  get("resist-scale").style.visibility = binary ? "hidden" : "visible";
  updateWindowControls();
}

function updateWindowControls() {
  pressed("resist-map",movable);
  const openings = binary ? "Light pixels mark openings below 10 nm. " : "";
  const instructions = w===128 && h===128
    ? "Full layout. Reduce X width or Y height to select a smaller window."
    : movable ? "Window moving. Click the map to lock it here." : "Window locked. Click the map to move it.";
  get("resist-caption").textContent = openings + instructions;
}

function renderWindow() {
  frame = null;
  if (!active) return;
  const state = currentState();
  const cells = Array.from({length:w*h},(_,i) => cellAt(i%w,Math.floor(i/w)));
  const heights = cells.map(id => state.height[id]);
  const min = Math.min(...heights);
  const max = Math.max(...heights);
  const reliefMax = Math.max(5,Math.ceil((max-min)/5)*5);
  const zMin = get("zoom").checked && layer+Number(after)>0 ? active.zoomMin : active.zMin;
  drawMap(wafer,(x,y) => {
    const id = cellAt(x,y);
    return colorAt(waferColors,(state.height[id]-min)/reliefMax);
  });
  get("wafer-max").textContent = reliefMax + " nm";


  const roi = get("roi-mark").style;
  roi.left=100*x0/128+"%"; roi.top=100*(128-y0-h)/128+"%";
  roi.width=100*w/128+"%"; roi.height=100*h/128+"%";
  const line = get("slice-mark");
  line.classList.toggle("horizontal",alongX);
  line.classList.toggle("vertical",!alongX);
  line.style.left=alongX?"0":100*(localX+.5)/w+"%";
  line.style.top=alongX?100*(h-.5-localY)/h+"%":"0";
  const mapLine=get("roi-slice");
  mapLine.classList.toggle("horizontal",alongX);
  mapLine.classList.toggle("vertical",!alongX);
  mapLine.style.left=100*(x0+(alongX?0:localX+.5))/128+"%";
  mapLine.style.top=100*(128-y0-(alongX?localY+.5:h))/128+"%";
  mapLine.style.width=alongX?roi.width:"0";
  mapLine.style.height=alongX?"0":roi.height;
  const west=active.x0+8*x0-4, south=active.y0+8*y0-4;
  get("window-bounds").textContent=w*8+" × "+h*8+" nm · X ["+west+", "+(west+8*w)+"] · Y ["+south+", "+(south+8*h)+"]";
  const slider = get("slice");
  slider.max=(alongX?h:w)-1;
  slider.value=alongX?localY:localX;
  const position = alongX ? active.y0 + 8*(y0+localY) : active.x0 + 8*(x0+localX);
  get("slice-position").textContent=(alongX?"Y":"X")+" = "+position+" nm";
  const cut = alongX
    ? Array.from({length:w},(_,x) => cellAt(x,localY))
    : Array.from({length:h},(_,y) => cellAt(localX,y));
  const edge = alongX ? active.x0+8*x0-4 : active.y0+8*y0-4;
  drawSection(get("section"),cut,alongX?"X":"Y",edge,zMin,active.zMax,128*128,state);
  drawVolume(volume,{w,h,cells},state,128*128,zMin,yaw,tilt);
}

function requestRender() {
  if (frame === null) frame=requestAnimationFrame(renderWindow);
}

function render() {
  if (!active) return;
  const m=layer+1;
  steps.forEach((button,i) => button.setAttribute("aria-pressed",String(i===layer)));
  pressed("incoming",!after); pressed("outgoing",after);
  pressed("thickness",!binary); pressed("opening",binary);
  pressed("section-x",alongX); pressed("section-y",!alongX);
  get("flow").textContent="S"+layer+" → M"+m+" lithography and development → S"+m;
  const stateIndex=layer+Number(after);
  const source=stateIndex===0 ? "Initial wafer state" : "Model prediction";
  get("state-label").textContent="S"+stateIndex+" · "+source;
  drawResist();
  renderWindow();
}

function stopPlayback() {
  clearInterval(timer); timer=null;
  get("play").textContent="▷ Play sequence";
}
function selectLayer(i) { layer=i; after=true; render(); }

async function selectCase(index) {
  stopPlayback();
  selected=index;
  active=null;
  get("views").inert=true;
  get("play").disabled=true;
  resistMap.disabled=true;
  steps.forEach(button => {button.disabled=true;});
  get("flow").textContent="Loading layout…";
  try {
    if (!cache.has(index)) cache.set(index,readCase(index).catch(error => {cache.delete(index); throw error;}));
    const data=await cache.get(index);
    if (selected!==index) return;
    active=data;
    x0=y0=0;
    w=h=128;
    localX=Math.floor(w/2); localY=Math.floor(h/2);
    syncWindowDimensions();
    movable=false;
    resistMap.disabled=false;
    get("views").inert=false;
    get("play").disabled=false;
    steps.forEach(button => {button.disabled=false;});
    selectLayer(0);
  } catch {
    if (selected===index) get("flow").textContent="Unable to load this layout. Select it again to retry.";
  }
}

function arrow(event) {
  const moves={ArrowLeft:[-1,0],ArrowRight:[1,0],ArrowUp:[0,1],ArrowDown:[0,-1]};
  const move=moves[event.key];
  if (move) event.preventDefault();
  return move;
}

function moveWindow(left,bottom) {
  const nextX=Math.max(0,Math.min(128-w,left));
  const nextY=Math.max(0,Math.min(128-h,bottom));
  if (nextX===x0 && nextY===y0) return;
  x0=nextX; y0=nextY;
  requestRender();
}

function syncWindowDimensions() {
  widthInput.value=w*8;
  heightInput.value=h*8;
  wafer.width=w;
  wafer.height=h;
  const map=get("wafer-map").style;
  map.aspectRatio=w+"/"+h;
  map.width=Math.min(100,100*w/h)+"%";
}

function resizeWindow() {
  if (!active) return;
  const cells = (input, previous) => Number.isFinite(input.valueAsNumber)
    ? Math.max(1, Math.min(128, Math.round(input.valueAsNumber/8))) : previous;
  const centerX=x0+w/2, centerY=y0+h/2;
  const sliceX=x0+localX, sliceY=y0+localY;
  w=cells(widthInput,w);
  h=cells(heightInput,h);
  moveWindow(Math.round(centerX-w/2),Math.round(centerY-h/2));
  localX=Math.max(0,Math.min(w-1,sliceX-x0));
  localY=Math.max(0,Math.min(h-1,sliceY-y0));
  syncWindowDimensions();
  updateWindowControls();
  requestRender();
}

for (const field of [widthInput,heightInput]) {
  field.addEventListener("change",resizeWindow);
  field.addEventListener("keydown",event => {
    if (event.key==="Enter") field.blur();
  });
}

function coordinates(event,canvas,cols,rows) {
  const box=canvas.getBoundingClientRect();
  return [
    Math.max(0,Math.min(cols-1,Math.floor(cols*(event.clientX-box.left)/box.width))),
    Math.max(0,Math.min(rows-1,rows-1-Math.floor(rows*(event.clientY-box.top)/box.height))),
  ];
}

function moveWithPointer(event) {
  if (!active || !movable) return;
  const [x,y]=coordinates(event,resist,128,128);
  moveWindow(x-Math.floor(w/2),y-Math.floor(h/2));
}
resistMap.addEventListener("pointermove",moveWithPointer);
resistMap.addEventListener("keydown",event => {
  if (!movable || !active) return;
  const move=arrow(event);
  if (move) moveWindow(x0+move[0],y0+move[1]);
});
resistMap.addEventListener("click",() => {
  if (!active) return;
  movable=!movable;
  updateWindowControls();
});
wafer.addEventListener("click",event => {
  [localX,localY]=coordinates(event,wafer,w,h);
  requestRender();
});
wafer.addEventListener("keydown",event => {
  const move=arrow(event);
  if (!move) return;
  localX=Math.max(0,Math.min(w-1,localX+move[0]));
  localY=Math.max(0,Math.min(h-1,localY+move[1]));
  requestRender();
});
function rotate(dx,dy) {
  yaw+=dx;
  tilt=Math.max(.18,Math.min(1.35,tilt+dy));
  requestRender();
}
volume.addEventListener("pointerdown",event => {
  if (drag) return;
  drag={id:event.pointerId,x:event.clientX,y:event.clientY};
  volume.setPointerCapture(event.pointerId);
});
volume.addEventListener("pointermove",event => {
  if (drag?.id!==event.pointerId) return;
  rotate((event.clientX-drag.x)*.012,(event.clientY-drag.y)*.012);
  drag.x=event.clientX; drag.y=event.clientY;
});
volume.addEventListener("lostpointercapture",event => {
  if (drag?.id===event.pointerId) drag=null;
});
volume.addEventListener("keydown",event => {
  const move=arrow(event);
  if (move) rotate(move[0]*.12,move[1]*.08);
});
get("reset-view").addEventListener("click",() => {yaw=-.63; tilt=.61; requestRender();});

for (const [i,info] of catalog.entries()) get("case-select").add(new Option(info.label,String(i)));
get("case-select").addEventListener("change",event => selectCase(Number(event.target.value)));
steps.forEach((button,i) => button.addEventListener("click",() => {stopPlayback(); selectLayer(i);}));
get("play").addEventListener("click",() => {
  if (timer) {stopPlayback(); return;}
  selectLayer(0);
  get("play").textContent="Ⅱ Pause";
  timer=setInterval(() => {if (layer===2) stopPlayback(); else selectLayer(layer+1);},1700);
});
get("incoming").addEventListener("click",() => {after=false; render();});
get("outgoing").addEventListener("click",() => {after=true; render();});
get("thickness").addEventListener("click",() => {binary=false; render();});
get("opening").addEventListener("click",() => {binary=true; render();});
get("section-x").addEventListener("click",() => {alongX=true; render();});
get("section-y").addEventListener("click",() => {alongX=false; render();});
get("zoom").addEventListener("change",requestRender);
get("slice").addEventListener("input",event => {
  if (alongX) localY=Number(event.target.value);
  else localX=Number(event.target.value);
  requestRender();
});
selectCase(0);
