import {fetchBoundaryGeoJSON,fetchJSON,prepareRegions,fetchWeather,dailyDates,frameStats,csvText} from './core.mjs';
import {DEFAULT_CAMERA} from './geometry3d.mjs';
import {createRainScene,drawRainScene} from './renderer3d.mjs';
const $=id=>document.getElementById(id);
let bundle=null,index=0,timer=null,busy=false,exporting=false,controller=null,hover=-1,selected=-1,projection=null,displayFeatures=[];
const canvas=$('map'),context=canvas.getContext('2d');
let viewMode='3d',camera={...DEFAULT_CAMERA},scene3D=null,hitAreas3D=[],drag=null,didDrag=false,queuedRender=false;
const pointers=new Map();
function requestRender(){if(queuedRender)return;queuedRender=true;requestAnimationFrame(()=>{queuedRender=false;render();});}
function clamp(value,min,max){return Math.max(min,Math.min(max,value));}
function resetCamera(){camera={...DEFAULT_CAMERA};$('tilt').value=String(Math.round(camera.tilt*180/Math.PI));render();}
function setView(mode){if(exporting)return;viewMode=mode;hover=-1;hitAreas3D=[];$('tooltip').classList.add('hidden');$('view-3d').setAttribute('aria-pressed',String(mode==='3d'));$('view-2d').setAttribute('aria-pressed',String(mode==='2d'));$('camera-controls').classList.toggle('hidden',mode!=='3d');$('camera-instructions').classList.toggle('hidden',mode!=='3d');canvas.style.touchAction=mode==='3d'?'none':'auto';if(bundle)canvas.setAttribute('aria-label',`${bundle.countryName}: ${mode==='3d'?'3D rainfall bars':'rainfall map'}, ${dateLabel(bundle.dates[index])}. Values are millimetres per day.`);render();}
const palette=['#263b51','#29637d','#2198ac','#61c6ba','#c1df78','#f5d665','#f3a154','#dd6655','#c74670'];
const thresholds=[0.1,1,3,5,10,20,35,50];
const colours=d3.scaleThreshold(thresholds,palette);
const fmt=n=>Number.isFinite(n)?n.toFixed(1):'—';
const dateLabel=(date,options={day:'2-digit',month:'short',year:'numeric'})=>new Date(date+'T12:00:00Z').toLocaleDateString('en-GB',{...options,timeZone:'UTC'});
const escape=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const latest=new Date();latest.setUTCDate(latest.getUTCDate()-7);
for(const id of ['start','end']) $(id).max=latest.toISOString().slice(0,10);
function status(text,error=false){$('status').textContent=text;$('status').classList.toggle('error',error);}
function setBusy(value){busy=value;for(const id of ['country','level','start','end','variable','samples'])$(id).disabled=value;$('load').disabled=value;$('load').textContent=value?'Loading rainfall…':'Load rainfall';$('cancel').classList.toggle('hidden',!value);updateControls();}
function updateControls(){for(const id of ['play','prev','next','scrubber','csv','export','save-png']) $(id).disabled=!bundle||busy||exporting;}
function pause(){if(timer)clearInterval(timer);timer=null;$('play').innerHTML='▶ <span>Play</span>';$('play').setAttribute('aria-label','Play animation');}
function play(){if(!bundle||busy||exporting)return;if(timer){pause();return;}if(index===bundle.dates.length-1)setDay(0);$('play').innerHTML='Ⅱ <span>Pause</span>';$('play').setAttribute('aria-label','Pause animation');timer=setInterval(()=>{if(index>=bundle.dates.length-1){pause();return;}setDay(index+1);},1000/Number($('speed').value));}
function setDay(value){if(!bundle)return;index=Math.max(0,Math.min(bundle.dates.length-1,Number(value)));$('scrubber').value=String(index);$('scrubber').setAttribute('aria-valuetext',dateLabel(bundle.dates[index]));$('counter').textContent=`Day ${index+1} / ${bundle.dates.length}`;$('frame-label').textContent=`${dateLabel(bundle.dates[index])} · Daily UTC total`;canvas.setAttribute('aria-label',`${bundle.countryName}: ${viewMode==='3d'?'3D rainfall bars':'rainfall map'}, ${dateLabel(bundle.dates[index])}. Bar height represents millimetres of rain per day.`);document.querySelectorAll('.rain-bars i').forEach((el,i)=>el.classList.toggle('active',i===index));updateStats();render();}
function setBundle(data){
  if(!data.regions?.length||!data.dates?.length||data.regions.length!==data.geojson?.features?.length)throw new Error('Invalid dataset.');
  bundle=data;selected=-1;hover=-1;for(const [id,value] of Object.entries({country:data.country,level:data.level,start:data.dates[0],end:data.dates.at(-1),variable:data.variable,samples:data.requestedSamples}))$(id).value=String(value);
  // D3 spherical paths expect clockwise exterior rings. Normalize only the display copy.
  displayFeatures=structuredClone(bundle.geojson.features);
  for(const feature of displayFeatures){if(d3.geoArea(feature)>2*Math.PI){const polys=feature.geometry.type==='Polygon'?[feature.geometry.coordinates]:feature.geometry.coordinates;for(const p of polys)for(const ring of p)ring.reverse();}}
  $('title').innerHTML=`${escape(bundle.countryName)} <span>daily ${bundle.variable==='rain_sum'?'rainfall':'precipitation'}</span>`;
  $('subtitle').textContent=`${dateLabel(bundle.dates[0])} – ${dateLabel(bundle.dates.at(-1))} · one frame per day · UTC`;
  $('map-measure').textContent=bundle.variable==='rain_sum'?'Daily rainfall':'Daily precipitation';
  $('region-count').textContent=`${bundle.regions.length} regions`;
  $('scrubber').max=String(bundle.dates.length-1);
  $('first-date').textContent=dateLabel(bundle.dates[0]);$('last-date').textContent=dateLabel(bundle.dates.at(-1));
  const counts=[...new Set(bundle.regions.map(r=>r.points.length))].join('–');
  $('sampling-note').textContent=`${counts} sampled point${counts==='1'?'':'s'} per region · ERA5 reanalysis · Daily UTC totals`;
  const means=bundle.dates.map((_,i)=>frameStats(bundle.regions,i).mean??0),max=Math.max(1,...means);
  $('rain-bars').innerHTML=means.map((v,i)=>`<i style="height:${Math.max(5,v/max*100)}%" title="${bundle.dates[i]}: ${fmt(v)} mm"></i>`).join('');
  scene3D=createRainScene(bundle,displayFeatures,d3);camera={...DEFAULT_CAMERA};$('tilt').value=String(Math.round(camera.tilt*180/Math.PI));$('map-empty').classList.add('hidden');updateControls();setDay(0);
}
function updateStats(){
  const stats=frameStats(bundle.regions,index);
  $('average').innerHTML=`${fmt(stats.mean)} <small>mm</small>`;$('maximum').innerHTML=`${fmt(stats.max)} <small>mm</small>`;
  $('coverage').textContent=`${stats.valid} of ${stats.total} regions with data`;
  const sorted=bundle.regions.map((r,i)=>({...r,i,value:r.values[index]})).sort((a,b)=>(b.value??-1)-(a.value??-1));
  $('wettest').textContent=stats.valid?sorted[0].name:'No data for this day';
  $('rankings').innerHTML=sorted.map(r=>`<div class="region-row ${selected===r.i?'active':''}" data-region="${r.i}" tabindex="0" role="button" aria-label="Highlight ${escape(r.name)}"><span title="${escape(r.name)}">${escape(r.name)}</span><span class="region-bar"><i style="width:${Number.isFinite(r.value)?Math.max(0,r.value/Math.max(1,stats.max)*100):0}%;background:${Number.isFinite(r.value)?colours(r.value):'#728298'}"></i></span><span class="region-number">${fmt(r.value)}</span></div>`).join('');
}
function draw(ctx,w,h,day=index,exportMode=false){
  ctx.clearRect(0,0,w,h);ctx.fillStyle='#101e30';ctx.fillRect(0,0,w,h);
  ctx.strokeStyle='#1c2d42';ctx.lineWidth=.6;
  for(let x=0;x<w;x+=48){ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,h);ctx.stroke();}
  for(let y=0;y<h;y+=48){ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(w,y);ctx.stroke();}
  if(!bundle)return;
  const compact=w<550, margin=compact?20:36, titleSize=compact?23:30;
  ctx.fillStyle='#edf5ff';ctx.font=`500 ${titleSize}px Manrope, sans-serif`;ctx.fillText(dateLabel(bundle.dates[day]),margin,46);
  ctx.fillStyle='#819bb8';ctx.font='12px "DM Sans", sans-serif';ctx.fillText(`${bundle.countryName} · ${bundle.variable==='rain_sum'?'rainfall':'precipitation'} · mm/day`,margin,68);
  if(viewMode==='3d'&&scene3D){
    const result=drawRainScene(ctx,w,h,bundle,scene3D,day,{d3,colours,camera,hover:exportMode?-1:hover,selected,labels:$('labels').checked,points:$('points').checked,exportMode});
    if(!exportMode)hitAreas3D=result.hits;
    if(exportMode)drawExportCredits(ctx,w,h,margin,day);
    return;
  }
  const collection={type:'FeatureCollection',features:displayFeatures};
  const center=d3.geoCentroid(collection);
  const proj=d3.geoMercator().rotate([-center[0],0]).fitExtent([[margin+12,94],[w-(compact?65:115),h-(exportMode?90:26)]],collection);
  if(!exportMode)projection=proj;
  const path=d3.geoPath(proj,ctx);
  displayFeatures.forEach((feature,i)=>{const value=bundle.regions[i].values[day];ctx.beginPath();path(feature);ctx.fillStyle=Number.isFinite(value)?colours(value):'#7b8494';ctx.fill();ctx.strokeStyle='#c0e0e4aa';ctx.lineWidth=exportMode?1.2:.8;ctx.stroke();});
  if(!exportMode&&(hover>=0||selected>=0))for(const i of new Set([hover,selected].filter(i=>i>=0))){ctx.beginPath();path(displayFeatures[i]);ctx.strokeStyle='#fff';ctx.lineWidth=2.3;ctx.stroke();}
  if($('points').checked){ctx.fillStyle='#f6feff';for(const region of bundle.regions)for(const p of region.points){const xy=proj([p.longitude,p.latitude]);if(!xy)continue;ctx.beginPath();ctx.arc(xy[0],xy[1],exportMode?3:2,0,2*Math.PI);ctx.fill();}}
  if($('labels').checked){ctx.font=`${exportMode?15:10}px "DM Sans", sans-serif`;ctx.textAlign='center';ctx.textBaseline='middle';displayFeatures.forEach((feature,i)=>{const [x,y]=path.centroid(feature);const name=bundle.regions[i].name;ctx.lineWidth=3;ctx.strokeStyle='#101e30';ctx.strokeText(name,x,y);ctx.fillStyle='#fff';ctx.fillText(name,x,y);});ctx.textAlign='left';ctx.textBaseline='alphabetic';}
  const lx=w-(compact?52:86), ly=Math.max(100,(h-300)/2), sw=compact?10:13, sh=24;
  ctx.fillStyle='#9fb3cb';ctx.font='11px "DM Sans", sans-serif';ctx.fillText('mm',lx,ly-14);
  const labels=['< 0.1','0.1–1','1–3','3–5','5–10','10–20','20–35','35–50','≥ 50'];
  for(let j=0;j<9;j++){ctx.fillStyle=palette[8-j];ctx.fillRect(lx,ly+j*sh,sw,sh-1);ctx.fillStyle='#adbed2';ctx.font=`${compact?9:11}px "DM Sans", sans-serif`;ctx.fillText(labels[8-j],lx+sw+6,ly+j*sh+15);}
  ctx.fillStyle='#7b8494';ctx.fillRect(lx,ly+9*sh+12,sw,11);ctx.fillStyle='#8fa3bd';ctx.font='10px "DM Sans", sans-serif';ctx.fillText('No data',lx-(compact?3:0),ly+9*sh+40);
  if(exportMode)drawExportCredits(ctx,w,h,margin,day);
}
function drawExportCredits(ctx,w,h,margin,day){ctx.fillStyle='#91a9c3';ctx.font='15px "DM Sans", sans-serif';ctx.fillText('Rainfall Atlas · Open-Meteo / ERA5 · geoBoundaries',margin,h-40);ctx.font='13px "DM Sans", sans-serif';ctx.fillText(`${bundle.regions[0].points.length} point samples per region · Daily total, UTC · ${bundle.metadata.boundaryLicense}`,margin,h-18);ctx.textAlign='right';ctx.fillText(`Day ${day+1} / ${bundle.dates.length}`,w-margin,h-62);ctx.textAlign='left';}
function render(){const rect=canvas.getBoundingClientRect(),ratio=Math.min(window.devicePixelRatio||1,2);canvas.width=Math.round(rect.width*ratio);canvas.height=Math.round(rect.height*ratio);context.setTransform(ratio,0,0,ratio,0,0);draw(context,rect.width,rect.height);}
function showTooltip(event){
  if(!bundle||(viewMode==='2d'&&!projection)||drag)return;const rect=canvas.getBoundingClientRect(),x=event.clientX-rect.left,y=event.clientY-rect.top;
  const ctx=context;let found=-1;
  ctx.save();ctx.setTransform(1,0,0,1,0,0);
  if(viewMode==='3d'){for(let i=hitAreas3D.length-1;i>=0;i--){const hit=hitAreas3D[i];if(ctx.isPointInPath(hit.path,x,y,hit.ground?'evenodd':'nonzero')){found=hit.index;break;}}}
  else{const path=d3.geoPath(projection,ctx);for(let i=0;i<displayFeatures.length;i++){ctx.beginPath();path(displayFeatures[i]);if(ctx.isPointInPath(x,y)){found=i;break;}}}
  ctx.restore();
  if(found!==hover){hover=found;render();}
  canvas.style.cursor=found>=0?'pointer':viewMode==='3d'?'grab':'default';const tip=$('tooltip');
  if(found<0){tip.classList.add('hidden');return;}
  const r=bundle.regions[found],v=r.values[index];tip.innerHTML=`<strong>${escape(r.name)}</strong>${Number.isFinite(v)?`${fmt(v)} mm · ${dateLabel(bundle.dates[index])}`:'No data for this day'}<br><span class="muted">${r.points.length} sampled point${r.points.length===1?'':'s'}</span>`;tip.classList.remove('hidden');
  tip.style.left=Math.max(8,Math.min(x+14,rect.width-tip.offsetWidth-8))+'px';tip.style.top=Math.max(8,Math.min(y+14,rect.height-tip.offsetHeight-8))+'px';
}
function saveBlob(blob,name){const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),10000);}
function makeExportCanvas(day){const c=document.createElement('canvas');c.width=1600;c.height=1200;draw(c.getContext('2d'),c.width,c.height,day,true);return c;}
async function loadData(event){
  event?.preventDefault();if(busy||exporting)return;pause();
  const country=$('country').value,level=$('level').value,start=$('start').value,end=$('end').value,variable=$('variable').value,samples=Number($('samples').value);
  let dates;try{dates=dailyDates(start,end);if(start<'1940-01-01'||end>$('end').max)throw new Error('Choose dates from 1940 up to seven days ago.');if(dates.length>366)throw new Error('Choose up to 366 days per animation.');}catch(error){status(error.message,true);return;}
  controller=new AbortController();const {signal}=controller;setBusy(true);
  const cacheKey=`rainfall-v1:${country}:${level}:${start}:${end}:${variable}:${samples}`;
  try{
    let cached;try{cached=JSON.parse(localStorage.getItem(cacheKey));}catch{}
    if(cached){setBundle(cached);status('Loaded saved data. One frame per day.');return;}
    status(`Loading ${country} region boundaries…`);
    let metadata,geojson;
    if(country==='SRB'&&level==='ADM1'){
      [metadata,geojson]=await Promise.all([fetchJSON('data/SRB-ADM1-metadata.json',{signal}),fetchJSON('data/SRB-ADM1.geojson',{signal})]);
    }else{
      try{metadata=await fetchJSON(`https://www.geoboundaries.org/api/current/gbOpen/${country}/${level}/`,{signal});}catch(error){if(error.name==='AbortError')throw error;throw new Error(`Could not load ${level} boundaries for this country. Try ADM1 or another country. ${error.message}`);}
      if(!metadata.simplifiedGeometryGeoJSON)throw new Error('No boundaries are available for this country and level.');
      geojson=await fetchBoundaryGeoJSON(metadata.simplifiedGeometryGeoJSON,{signal});
    }
    const regions=prepareRegions(geojson,samples),points=regions.reduce((s,r)=>s+r.points.length,0);
    status(`Fetching ${dates.length} daily frames · 0 / ${points} locations…`);
    const result=await fetchWeather(regions,dates,variable,(n,total)=>status(`Fetching ${dates.length} daily frames · ${n} / ${total} locations…`),{signal});
    const data={version:1,country,countryName:metadata.boundaryName,level,variable,model:'era5',timezone:'GMT',requestedSamples:samples,metadata,geojson,dates,regions:result,retrievedAt:new Date().toISOString()};
    setBundle(data);try{localStorage.setItem(cacheKey,JSON.stringify(data));}catch{}
    status(`${dates.length} daily frames ready · ${points} point samples. Press Play.`);
  }catch(error){status(error.name==='AbortError'?'Loading cancelled.':`Could not load rainfall: ${error.message}`,error.name!=='AbortError');if(!bundle){$('map-empty').innerHTML='<strong>No rainfall loaded yet</strong><span>Choose a country and dates, then load rainfall.</span>';}}
  finally{controller=null;setBusy(false);}
}
async function exportVideo(){
  if(!bundle||busy||exporting)return;
  if(!window.MediaRecorder||!HTMLCanvasElement.prototype.captureStream){status('Video export is unavailable in this browser. PNG and CSV downloads are available.',true);return;}
  pause();exporting=true;updateControls();$('load').disabled=true;for(const el of document.querySelectorAll('.view-tools button,.view-tools input'))el.disabled=true;
  const c=makeExportCanvas(0),fps=Number($('speed').value),stream=c.captureStream(fps),chunks=[];
  let recorder;
  try{
    const type=['video/webm;codecs=vp9','video/webm;codecs=vp8','video/webm','video/mp4'].find(t=>MediaRecorder.isTypeSupported(t));
    if(!type)throw new Error('This browser has no supported video encoder.');
    recorder=new MediaRecorder(stream,{mimeType:type,videoBitsPerSecond:4500000});
    recorder.ondataavailable=event=>{if(event.data.size)chunks.push(event.data);};
    const stopped=new Promise((resolve,reject)=>{recorder.onstop=resolve;recorder.onerror=e=>reject(e.error||new Error('Video encoding failed.'));});
    recorder.start();
    for(let i=0;i<bundle.dates.length;i++){
      draw(c.getContext('2d'),c.width,c.height,i,true);setDay(i);$('export').textContent=`Exporting ${i+1}/${bundle.dates.length}`;
      await new Promise(resolve=>setTimeout(resolve,1000/fps));
    }
    recorder.stop();await stopped;
    saveBlob(new Blob(chunks,{type}),`${bundle.country}-${bundle.variable}-${bundle.dates[0]}-${bundle.dates.at(-1)}.${type.includes('mp4')?'mp4':'webm'}`);
    status(`Video exported · ${bundle.dates.length} daily frames at ${fps} days/second.`);
  }catch(error){status(`Video export failed: ${error.message}`,true);if(recorder?.state==='recording')recorder.stop();}
  finally{stream.getTracks().forEach(t=>t.stop());exporting=false;for(const el of document.querySelectorAll('.view-tools button,.view-tools input'))el.disabled=false;$('export').textContent='Export video';$('load').disabled=false;updateControls();}
}
function showDetails(){
  const m=bundle?.metadata;
  $('details-body').innerHTML=`<p><strong>One frame, one calendar day.</strong> Each map shows that day’s rainfall in millimetres, using a shared UTC day (00:00–24:00). Values are daily totals, not cumulative totals across the animation. A fixed colour scale is used for every day and country.</p><p><strong>3D rainfall bars.</strong> One vertical column represents one region. Column height is linear in that day’s rainfall (mm); 20 mm is twice as tall as 10 mm. The height ruler is fixed over the whole selected date range and is fitted to its largest value. The map uses an orthographic 3D camera so equal rainfall heights remain equal on screen at every region. A zero day is a flat ring; a missing value is a cross. Drag to rotate, scroll or pinch to zoom, and use the angle slider to tilt. Arrow keys rotate/tilt, +/− zoom, and Home resets the view. PNG/video exports preserve the current view.</p><p><strong>Regional estimates.</strong> We place 1, 3 or 5 deterministic, approximately uniform-in-area point samples inside each region polygon, request daily ERA5 values, then take the arithmetic mean. At most 250 sampling locations are used where possible, with at least one per region. Multiple points can resolve to the same ERA5 grid cell. A missing sample is shown as missing data for that region/day. The country summary weights region estimates by spherical polygon area and includes only regions with valid data.</p><p>This is a sampled regional estimate, not a full grid-cell area integration. ERA5 rainfall has a spatial resolution of about 25 km, so this map cannot show local rainfall at street or field scale. Small regions may share identical values.</p><p><strong>Weather data.</strong> <a href="https://open-meteo.com/en/docs/historical-weather-api" target="_blank" rel="noopener">Open-Meteo Historical Weather API</a>, model <code>era5</code>. Rainfall uses <code>rain_sum</code> (liquid rain); all precipitation uses <code>precipitation_sum</code> (including snowfall as water equivalent). The date picker leaves seven days for archive availability. The free endpoint is for <a href="https://open-meteo.com/en/terms" target="_blank" rel="noopener">non-commercial use</a>. Data attribution: Open-Meteo, <a href="https://open-meteo.com/en/licence" target="_blank" rel="noopener">CC BY 4.0</a>, and Copernicus Climate Change Service / ECMWF ERA5.</p><p><strong>Boundaries.</strong> <a href="https://www.geoboundaries.org/" target="_blank" rel="noopener">geoBoundaries gbOpen</a>. Coverage and administrative definitions follow the selected source dataset. Some territories have no ADM1/ADM2 dataset. Different countries’ administrative levels are not directly comparable.</p>${m?`<dl><dt>Current dataset</dt><dd>${escape(m.boundaryName)} · ${escape(m.boundaryType)} · ${escape(m.boundaryID)}</dd><dt>Boundary year represented</dt><dd>${escape(m.boundaryYearRepresented)}</dd><dt>Boundary source / licence</dt><dd>${escape(m.boundarySource)} / ${escape(m.boundaryLicense)}</dd><dt>Weather retrieved</dt><dd>${escape(bundle.retrievedAt?.slice(0,10))} · ${bundle.regions.length} regions</dd></dl>`:''}<p><strong>Exports.</strong> CSV contains every region and day. PNG saves the current day. Video plays each day for an equal duration at the selected speed. The source package runs on any static web server; no API key or build step is required.</p>`;
  $('details').showModal();
}
$('settings').addEventListener('submit',loadData);$('cancel').onclick=()=>controller?.abort();$('play').onclick=play;
$('prev').onclick=()=>{pause();setDay(index-1);};$('next').onclick=()=>{pause();setDay(index+1);};
$('scrubber').oninput=e=>{pause();setDay(e.target.value);};$('speed').onchange=()=>{if(timer){pause();play();}};
for(const id of ['labels','points'])$(id).onchange=render;
$('view-3d').onclick=()=>setView('3d');$('view-2d').onclick=()=>setView('2d');
$('reset-view').onclick=resetCamera;
$('zoom-in').onclick=()=>{camera.zoom=clamp(camera.zoom*1.2,.6,2.5);render();};
$('zoom-out').onclick=()=>{camera.zoom=clamp(camera.zoom/1.2,.6,2.5);render();};
$('tilt').oninput=e=>{camera.tilt=Number(e.target.value)*Math.PI/180;render();};
canvas.addEventListener('pointerdown',e=>{if(viewMode!=='3d'||exporting)return;pointers.set(e.pointerId,{x:e.clientX,y:e.clientY});canvas.setPointerCapture(e.pointerId);drag={x:e.clientX,y:e.clientY,yaw:camera.yaw,tilt:camera.tilt};didDrag=false;canvas.style.cursor='grabbing';});
canvas.addEventListener('pointermove',e=>{
 if(drag&&viewMode==='3d'){
  if(pointers.size===2){const previous=[...pointers.values()],oldDistance=Math.hypot(previous[0].x-previous[1].x,previous[0].y-previous[1].y);pointers.set(e.pointerId,{x:e.clientX,y:e.clientY});const current=[...pointers.values()],distance=Math.hypot(current[0].x-current[1].x,current[0].y-current[1].y);if(oldDistance>0)camera.zoom=clamp(camera.zoom*distance/oldDistance,.6,2.5);didDrag=true;}
  else{pointers.set(e.pointerId,{x:e.clientX,y:e.clientY});const dx=e.clientX-drag.x,dy=e.clientY-drag.y;if(Math.hypot(dx,dy)>3)didDrag=true;camera.yaw=drag.yaw+dx*.008;camera.tilt=clamp(drag.tilt+dy*.006,20*Math.PI/180,70*Math.PI/180);$('tilt').value=String(Math.round(camera.tilt*180/Math.PI));}
  hover=-1;$('tooltip').classList.add('hidden');requestRender();return;
 }
 showTooltip(e);
});
function releasePointer(e){pointers.delete(e.pointerId);if(canvas.hasPointerCapture(e.pointerId))canvas.releasePointerCapture(e.pointerId);if(pointers.size===0){drag=null;canvas.style.cursor='grab';}else{const p=[...pointers.values()][0];drag={...p,yaw:camera.yaw,tilt:camera.tilt};}}
canvas.addEventListener('pointerup',releasePointer);canvas.addEventListener('pointercancel',releasePointer);
canvas.addEventListener('pointerleave',()=>{if(drag)return;hover=-1;$('tooltip').classList.add('hidden');render();});
canvas.addEventListener('wheel',e=>{if(viewMode!=='3d'||exporting)return;e.preventDefault();camera.zoom=clamp(camera.zoom*Math.exp(-e.deltaY*.001),.6,2.5);requestRender();},{passive:false});
canvas.addEventListener('keydown',e=>{if(viewMode!=='3d'||exporting)return;const k=e.key;if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','+','=','-','Home'].includes(k))return;e.preventDefault();if(k==='Home'){resetCamera();return;}if(k==='ArrowLeft')camera.yaw-=.1;if(k==='ArrowRight')camera.yaw+=.1;if(k==='ArrowUp')camera.tilt=clamp(camera.tilt+.06,.35,1.22);if(k==='ArrowDown')camera.tilt=clamp(camera.tilt-.06,.35,1.22);if(k==='+'||k==='=')camera.zoom=clamp(camera.zoom*1.1,.6,2.5);if(k==='-')camera.zoom=clamp(camera.zoom/1.1,.6,2.5);$('tilt').value=String(Math.round(camera.tilt*180/Math.PI));render();});
canvas.onclick=e=>{if(!bundle||didDrag){didDrag=false;return;}showTooltip(e);selected=hover;updateStats();render();};
$('rankings').addEventListener('click',e=>{const row=e.target.closest('[data-region]');if(row){const n=Number(row.dataset.region);selected=selected===n?-1:n;updateStats();render();}});
$('rankings').addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();e.target.click();}});
$('csv').onclick=()=>saveBlob(new Blob([csvText(bundle)],{type:'text/csv;charset=utf-8'}),`${bundle.country}-daily-${bundle.variable}.csv`);
$('save-png').onclick=()=>makeExportCanvas(index).toBlob(blob=>saveBlob(blob,`${bundle.country}-${bundle.dates[index]}.png`));
$('export').onclick=exportVideo;
for(const id of ['about','method','data-details'])$(id).onclick=showDetails;
$('close-details').onclick=()=>$('details').close();
$('details').onclick=e=>{if(e.target===$('details')){const r=$('details').getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)$('details').close();}};
new ResizeObserver(render).observe($('canvas-wrap'));
async function init(){
  try{const countries=await fetchJSON('data/countries.json');$('country').innerHTML=countries.map(c=>`<option value="${c.code}" ${c.code==='SRB'?'selected':''}>${escape(c.name)}</option>`).join('');}catch{}
  try{const sample=await fetchJSON('data/SRB-2024-05-01-2024-05-31.json',{retries:0});setBundle(sample);status(`${sample.dates.length} daily frames ready · Serbia, May 2024. Press Play.`);}catch{await loadData();}
}
setView('3d');
init();
