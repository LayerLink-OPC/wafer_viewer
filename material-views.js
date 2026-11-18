const materials = ["#122230", "#627993", "#75bcb7", "#d69060", "#e9c878", "#b3a6df"];

export function intervals(state, count, id, zMin) {
  const layers = [];
  for (let k = 0; k < state.depth; k++) {
    const p = k * count + id;
    const lo = Math.max(state.bottom[p], zMin);
    const hi = state.top[p];
    if (hi > lo) layers.push({lo, hi, color: materials[state.ids[p]] ?? "#f29da9"});
  }
  return layers;
}

function empty(ctx, canvas, message) {
  ctx.fillStyle = "#b9c9d5";
  ctx.font = "22px system-ui";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(message, canvas.width / 2, canvas.height / 2);
}

export function drawSection(canvas, cells, axis, start, zMin, zMax, count, state) {
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const left = 74, right = canvas.width - 34, top = 27, bottom = canvas.height - 62;
  const width = right - left;
  const yAt = z => top + (zMax - z) * (bottom - top) / (zMax - zMin);
  cells.forEach((id, i) => {
    for (const band of intervals(state, count, id, zMin)) {
      ctx.fillStyle = band.color;
      ctx.fillRect(left + i * width / cells.length, yAt(band.hi), width / cells.length + .25, yAt(band.lo) - yAt(band.hi));
    }
  });
  const tickStep = zMax - zMin >= 510 ? 100 : 50;
  ctx.textBaseline = "middle";
  ctx.textAlign = "right";
  ctx.font = "17px monospace";
  for (let z = Math.ceil(zMin / tickStep) * tickStep; z <= zMax; z += tickStep) {
    const y = yAt(z);
    ctx.fillStyle = "#b9c9d5";
    ctx.fillText(z, left - 9, y);
    ctx.fillStyle = "#daeaf027";
    ctx.fillRect(left, y, width, 1);
  }
  ctx.fillStyle = "#b9c9d5";
  ctx.textAlign = "left"; ctx.fillText("Z (nm)", 8, 13);
  ctx.fillText(start, left, bottom + 25);
  ctx.textAlign = "center"; ctx.fillText(axis + " (nm)", (left + right) / 2, bottom + 25);
  ctx.textAlign = "right"; ctx.fillText(start + 8 * cells.length, right, bottom + 25);
}

export function drawVolume(canvas, window, state, count, zMin, yaw, tilt) {
  const ctx = canvas.getContext("2d");
  const {w, h, cells} = window;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const cos = Math.cos(yaw), sin = Math.sin(yaw);
  const project = ([x, y, z]) => [
    x * cos - y * sin,
    -(x * sin + y * cos) * Math.sin(tilt) - (z - zMin) * Math.cos(tilt),
  ];
  let minX=Infinity, maxX=-Infinity, minY=Infinity, maxY=-Infinity;
  const polygons = [];
  const cellAt = (x, y) => x < 0 || y < 0 || x >= w || y >= h ? -1 : cells[y * w + x];
  function include(points) {
    for (const [x,y] of points) {
      minX=Math.min(minX,x); maxX=Math.max(maxX,x);
      minY=Math.min(minY,y); maxY=Math.max(maxY,y);
    }
  }
  function face(points, color, shade) {
    const xy = points.map(project);
    include(xy);
    polygons.push({xy, color, shade});
  }
  function topFace(a, b, c, d, z) {
    return [[a,c,z],[b,c,z],[b,d,z],[a,d,z]];
  }
  const ordered = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const id = cellAt(x,y);
      if (id >= 0) ordered.push({x,y,id,depth:x*sin+y*cos});
    }
  }
  ordered.sort((a,b) => b.depth - a.depth);
  for (const {x,y,id} of ordered) {
    const x0 = x*8, x1 = x0+8, y0 = y*8, y1 = y0+8;
    const bands = intervals(state,count,id,zMin);
    if (!bands.length) continue;
    const frontX = sin >= 0 ? -1 : 1;
    const frontY = cos >= 0 ? -1 : 1;
    const faceX = frontX < 0 ? x0 : x1;
    const faceY = frontY < 0 ? y0 : y1;
    for (const {lo,hi,color} of bands) {
      if (cellAt(x+frontX,y) < 0) face([[faceX,y0,lo],[faceX,y1,lo],[faceX,y1,hi],[faceX,y0,hi]],color,.22);
      if (cellAt(x,y+frontY) < 0) face([[x0,faceY,lo],[x1,faceY,lo],[x1,faceY,hi],[x0,faceY,hi]],color,.37);
    }
    const {hi,color} = bands.at(-1);
    face(topFace(x0,x1,y0,y1,hi),color,0);
  }
  if (!polygons.length) {
    empty(ctx, canvas, "No material above the selected Z range");
    return;
  }
  // Fit the projected data and the footprint together, using the same scale on X, Y, and Z.
  const footprint=topFace(0,w*8,0,h*8,zMin).map(project);
  include(footprint);
  const scale = Math.min((canvas.width-94)/(maxX-minX),(canvas.height-75)/(maxY-minY));
  const cx = (minX+maxX)/2, cy = (minY+maxY)/2;
  function paint(xy, fill, stroke) {
    ctx.beginPath();
    xy.forEach(([x,y],i) => ctx[i ? "lineTo" : "moveTo"](
      canvas.width/2+(x-cx)*scale, canvas.height/2+(y-cy)*scale));
    ctx.closePath();
    if (fill) { ctx.fillStyle=fill; ctx.fill(); }
    if (stroke) { ctx.strokeStyle=stroke; ctx.stroke(); }
  }
  ctx.setLineDash([5,4]);
  paint(footprint,null,"#aff9de");
  ctx.setLineDash([]);
  for (const {xy,color,shade} of polygons) {
    paint(xy,color,null);
    if (shade) paint(xy,"rgba(10,23,33,"+shade+")",null);
    else paint(xy,null,"#13233138");
  }
  ctx.fillStyle = "#b9c9d5";
  ctx.font = "16px monospace";
  ctx.textAlign = "left";
  ctx.fillText(w*8 + " × " + h*8 + " nm footprint", 16, canvas.height-16);
  ctx.textAlign = "right";
  ctx.fillText("Z ≥ " + zMin + " nm",canvas.width-16,canvas.height-16);
}
