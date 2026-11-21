import {contains,polygons} from './core.mjs';
import {DEFAULT_CAMERA,rainfallDomain,rainfallHeight,fitCamera,columnFaces} from './geometry3d.mjs';

export function createRainScene(bundle,features,d3) {
  const collection={type:'FeatureCollection',features};
  const center=d3.geoCentroid(collection);
  const projection=d3.geoMercator().rotate([-center[0],0]).fitExtent([[-400,-400],[400,400]],collection);
  const plane=coordinate=>{const [x,y]=projection(coordinate);return [x,-y];};
  const regions=features.map((feature,i)=>{
    const centroid=d3.geoCentroid(feature);
    let coordinate=centroid;
    if(!contains(bundle.geojson.features[i],centroid[0],centroid[1])) {
      coordinate=bundle.regions[i].points.map(p=>[p.longitude,p.latitude]).sort((a,b)=>d3.geoDistance(a,centroid)-d3.geoDistance(b,centroid))[0];
    }
    return {rings:polygons(feature).map(p=>p.map(r=>r.map(plane))),anchor:plane(coordinate),samples:bundle.regions[i].points.map(p=>plane([p.longitude,p.latitude]))};
  });
  for(let i=0;i<regions.length;i++) {
    let nearest=Infinity;
    for(let j=0;j<regions.length;j++)if(i!==j)nearest=Math.min(nearest,Math.hypot(regions[i].anchor[0]-regions[j].anchor[0],regions[i].anchor[1]-regions[j].anchor[1]));
    regions[i].width=Math.min(30,nearest*0.38);
    if(!Number.isFinite(regions[i].width))regions[i].width=30;
  }
  const points=regions.flatMap(r=>r.rings.flatMap(p=>p[0]));
  const bounds={minX:Infinity,maxX:-Infinity,minY:Infinity,maxY:-Infinity};
  for(const [x,y] of points){bounds.minX=Math.min(bounds.minX,x);bounds.maxX=Math.max(bounds.maxX,x);bounds.minY=Math.min(bounds.minY,y);bounds.maxY=Math.max(bounds.maxY,y);}
  return {regions,points:d3.polygonHull(points)||points,domain:rainfallDomain(bundle.regions),bounds};
}
function polygonPath(vertices,project) {
  const path=new Path2D();
  vertices.forEach((point,i)=>{const [x,y]=project(point);if(i)path.lineTo(x,y);else path.moveTo(x,y);});
  path.closePath();return path;
}
function regionPath(region,project,z=0) {
  const path=new Path2D();
  for(const polygon of region.rings)for(const ring of polygon){ring.forEach(([x,y],i)=>{const p=project([x,y,z]);if(i)path.lineTo(p[0],p[1]);else path.moveTo(p[0],p[1]);});path.closePath();}
  return path;
}
function line(ctx,project,a,b) {const p=project(a),q=project(b);ctx.beginPath();ctx.moveTo(p[0],p[1]);ctx.lineTo(q[0],q[1]);ctx.stroke();}
function shaded(d3,colour,brightness){const c=d3.rgb(colour);return `rgb(${Math.min(255,Math.round(c.r*brightness))},${Math.min(255,Math.round(c.g*brightness))},${Math.min(255,Math.round(c.b*brightness))})`;}

export function drawRainScene(ctx,w,h,bundle,scene,day,{d3,colours,camera=DEFAULT_CAMERA,gain=1,hover=-1,selected=-1,labels=false,points=false,exportMode=false}={}) {
  const compact=w<550,padding=compact?16:35;
  // The same full-range envelope is fitted for every day. Dry days are never auto-magnified.
  const ceiling=rainfallHeight(scene.domain,scene.domain,1);
  const rect={x:padding,y:96,width:w-padding-(compact?75:120),height:h-96-(exportMode?100:58)};
  const fit=fitCamera(scene.points,camera,rect,ceiling);
  const project=fit.project,hits=[],allFaces=[];
  ctx.save();ctx.beginPath();ctx.rect(0,80,w,h-80-(exportMode?86:36));ctx.clip();
  const b=scene.bounds,gridStep=100;
  ctx.strokeStyle='#284057';ctx.lineWidth=.7;
  for(let x=Math.floor((b.minX-75)/gridStep)*gridStep;x<b.maxX+100;x+=gridStep)line(ctx,project,[x,b.minY-55,0],[x,b.maxY+55,0]);
  for(let y=Math.floor((b.minY-55)/gridStep)*gridStep;y<b.maxY+100;y+=gridStep)line(ctx,project,[b.minX-75,y,0],[b.maxX+75,y,0]);
  // Shallow side walls make the country plane legible from low camera angles.
  for(const region of scene.regions){const path=regionPath(region,project,-12);ctx.fillStyle='#091520';ctx.fill(path,'evenodd');ctx.strokeStyle='#284459';ctx.stroke(path);}
  for(let i=0;i<scene.regions.length;i++) {
    const region=scene.regions[i],value=bundle.regions[i].values[day],path=regionPath(region,project);
    ctx.fillStyle=Number.isFinite(value)?'#214258':'#434f60';ctx.fill(path,'evenodd');ctx.strokeStyle=(i===hover||i===selected)?'#d4faff':'#6aadc3a0';ctx.lineWidth=(i===hover||i===selected)?1.8:.75;ctx.stroke(path);
    hits.push({path,index:i,ground:true});
    const height=rainfallHeight(value,scene.domain,gain),base=project([...region.anchor,0]);
    if(height===null||height===0) {
      // No false positive height: zero is a flat ring; missing data gets a cross.
      ctx.beginPath();ctx.arc(base[0],base[1],Math.max(2,region.width*fit.scale/3),0,2*Math.PI);ctx.strokeStyle=height===null?'#a4acba':'#69cbe0';ctx.lineWidth=1.3;ctx.stroke();
      if(height===null){ctx.beginPath();ctx.moveTo(base[0]-3,base[1]-3);ctx.lineTo(base[0]+3,base[1]+3);ctx.moveTo(base[0]+3,base[1]-3);ctx.lineTo(base[0]-3,base[1]+3);ctx.stroke();}
      continue;
    }
    // Subtle ground shadow anchors the column at its region.
    ctx.save();ctx.fillStyle='#07111d55';ctx.beginPath();ctx.ellipse(base[0]+4,base[1]+3,Math.max(3,region.width*fit.scale*.7),Math.max(2,region.width*fit.scale*.3),0,0,Math.PI*2);ctx.fill();ctx.restore();
    for(const face of columnFaces(region.anchor,region.width,height)) {
      const depth=face.vertices.reduce((sum,p)=>sum+project(p)[2],0)/4;
      allFaces.push({path:polygonPath(face.vertices,project),depth,index:i,fill:shaded(d3,colours(value),face.shade)});
    }
  }
  allFaces.sort((a,b)=>b.depth-a.depth);
  for(const face of allFaces){ctx.fillStyle=face.fill;ctx.fill(face.path);ctx.strokeStyle=(face.index===hover||face.index===selected)?'#e4fdff':'#d7faff35';ctx.lineWidth=(face.index===hover||face.index===selected)?1.5:.5;ctx.stroke(face.path);hits.push({path:face.path,index:face.index,ground:false});}
  if(points){ctx.fillStyle='#d5f4ff';for(const region of scene.regions)for(const point of region.samples){const p=project([...point,0]);ctx.beginPath();ctx.arc(p[0],p[1],exportMode?3:2,0,Math.PI*2);ctx.fill();}}
  if(labels||selected>=0||hover>=0){ctx.textAlign='center';ctx.textBaseline='bottom';ctx.font=`${exportMode?16:12}px "DM Sans",sans-serif`;scene.regions.forEach((r,i)=>{if(!labels&&i!==selected&&i!==hover)return;const value=bundle.regions[i].values[day],height=rainfallHeight(value,scene.domain,gain)??0;const p=project([...r.anchor,height]);const text=`${bundle.regions[i].name} · ${Number.isFinite(value)?value.toFixed(1)+' mm':'no data'}`;ctx.strokeStyle='#101e30';ctx.lineWidth=4;ctx.strokeText(text,p[0],p[1]-7);ctx.fillStyle='#ecfaff';ctx.fillText(text,p[0],p[1]-7);});ctx.textAlign='left';ctx.textBaseline='alphabetic';}
  ctx.restore();
  // Vertical ruler matches the world-height projection exactly; values remain linear.
  const axisX=w-(compact?51:82),baseY=h-(exportMode?110:66),heightPx=ceiling*gain*Math.cos(camera.tilt)*fit.scale;
  ctx.strokeStyle='#78d9ed';ctx.lineWidth=1.3;ctx.beginPath();ctx.moveTo(axisX,baseY);ctx.lineTo(axisX,baseY-heightPx);ctx.stroke();
  ctx.fillStyle='#adc7db';ctx.font=`${compact?10:12}px "DM Sans",sans-serif`;
  for(const tick of d3.ticks(0,scene.domain,4)){const y=baseY-heightPx*tick/scene.domain;ctx.beginPath();ctx.moveTo(axisX-4,y);ctx.lineTo(axisX+5,y);ctx.stroke();ctx.fillText(String(tick),axisX+10,y+4);}
  ctx.fillStyle='#70d7ed';ctx.font=`600 ${compact?10:12}px "DM Sans",sans-serif`;ctx.fillText('HEIGHT',axisX-8,Math.max(105,baseY-heightPx-32));ctx.fillStyle='#a4bbd0';ctx.font=`${compact?10:12}px "DM Sans",sans-serif`;ctx.fillText('mm/day',axisX-8,Math.max(120,baseY-heightPx-16));
  ctx.fillStyle='#8ba3bd';ctx.font=`${compact?10:12}px "DM Sans",sans-serif`;ctx.fillText(compact?'Height = daily total · fixed scale':'0 = flat ring · × = no data',padding,h-(exportMode?81:24));ctx.textAlign='right';if(!compact)ctx.fillText('Height = daily total · fixed scale',w-padding,h-(exportMode?81:24));ctx.textAlign='left';
  return {hits,project,fit};
}
