// Geometry and daily data functions are shared by the browser and prefetch CLI.
export function polygons(feature) {
  const g = feature.geometry;
  if (g?.type === 'Polygon') return [g.coordinates];
  if (g?.type === 'MultiPolygon') return g.coordinates;
  throw new Error('Only Polygon and MultiPolygon region boundaries are supported.');
}
function ringContains(ring, x, y) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < (xj-xi)*(y-yi)/(yj-yi)+xi) inside = !inside;
  }
  return inside;
}
export function contains(feature, x, y) {
  return polygons(feature).some(p => ringContains(p[0], x, y) && !p.slice(1).some(r => ringContains(r, x, y)));
}
function halton(i, base) {
  let result = 0, f = 1;
  while (i > 0) { f /= base; result += f*(i%base); i = Math.floor(i/base); }
  return result;
}
// Uniform-in-area low-discrepancy samples inside the supplied region.
// Sample means are estimates, not an integration of every model grid cell.
export function sampleRegion(feature, count = 3) {
  const coords = polygons(feature).flatMap(p => p[0]);
  const xs = coords.map(p => p[0]), ys = coords.map(p => p[1]);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minSin = Math.sin(Math.min(...ys)*Math.PI/180), maxSin = Math.sin(Math.max(...ys)*Math.PI/180);
  const points = [];
  for (let i = 1; i <= 150000 && points.length < count; i++) {
    const x = minX+(maxX-minX)*halton(i, 2);
    const y = Math.asin(minSin+(maxSin-minSin)*halton(i, 3))*180/Math.PI;
    if (contains(feature, x, y)) points.push({latitude:+y.toFixed(5), longitude:+x.toFixed(5)});
  }
  if (points.length !== count) throw new Error(`Could not sample ${feature.properties?.shapeName || 'region'}. Try fewer points or another boundary level.`);
  return points;
}
export function areaKm2(feature) {
  const rad = Math.PI/180, radius = 6371.0088;
  function ringArea(ring) {
    let total = 0;
    for (let i=0;i<ring.length;i++) {
      const a=ring[i], b=ring[(i+1)%ring.length];
      let d=(b[0]-a[0])*rad;
      if (d>Math.PI) d-=2*Math.PI;
      if (d<-Math.PI) d+=2*Math.PI;
      total+=d*(2+Math.sin(a[1]*rad)+Math.sin(b[1]*rad));
    }
    return Math.abs(total*radius*radius/2);
  }
  return polygons(feature).reduce((sum,p)=>sum+Math.max(0,ringArea(p[0])-p.slice(1).reduce((s,r)=>s+ringArea(r),0)),0);
}
export function dailyDates(start, end) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start)||!/^\d{4}-\d{2}-\d{2}$/.test(end)) throw new Error('Choose valid dates.');
  const a = new Date(start+'T00:00:00Z'), b = new Date(end+'T00:00:00Z');
  if (!Number.isFinite(+a)||!Number.isFinite(+b)||a.toISOString().slice(0,10)!==start||b.toISOString().slice(0,10)!==end||a>b) throw new Error('The end date must be on or after the start date.');
  const dates=[];
  for(let t=+a;t<=+b;t+=86400000) dates.push(new Date(t).toISOString().slice(0,10));
  return dates;
}
export function prepareRegions(geojson, requestedSamples) {
  if (!Array.isArray(geojson.features)||!geojson.features.length) throw new Error('No region polygons were returned.');
  if (geojson.features.length>500) throw new Error('This boundary level has over 500 regions. Please use ADM1.');
  const sampleCount=Math.max(1,Math.min(requestedSamples,Math.floor(250/geojson.features.length)));
  return geojson.features.map((feature,i)=>({id:String(feature.properties?.shapeID||i),name:feature.properties?.shapeName||`Region ${i+1}`,area:areaKm2(feature),points:sampleRegion(feature,sampleCount)}));
}
export function aggregateDaily(regions, responses, dates, variable) {
  const rows = Array.isArray(responses)?responses:[responses];
  const pointCount = regions.reduce((s,r)=>s+r.points.length,0);
  if(rows.length!==pointCount) throw new Error(`Expected ${pointCount} locations, received ${rows.length}.`);
  let cursor=0;
  return regions.map(region=>{
    const series=rows.slice(cursor,cursor+=region.points.length).map(row=>{
      if(row.error||!row.daily||!Array.isArray(row.daily[variable])) throw new Error(row.reason||'Weather response is missing daily rainfall.');
      if(row.daily_units?.[variable]!=='mm') throw new Error('Weather response has unexpected units.');
      if(row.daily.time.length!==dates.length||row.daily.time.some((d,i)=>d!==dates[i])||row.daily[variable].length!==dates.length) throw new Error('Weather dates do not match the requested days.');
      return row.daily[variable];
    });
    // A missing sample makes the entire region/day missing. Never turn null into zero.
    const values=dates.map((_,i)=>{
      const numbers=series.map(s=>s[i]);
      return numbers.every(v=>typeof v==='number'&&Number.isFinite(v)&&v>=0)?numbers.reduce((s,n)=>s+n,0)/numbers.length:null;
    });
    return {...region,values};
  });
}
export function frameStats(regions, index) {
  const valid=regions.filter(r=>Number.isFinite(r.values[index]));
  const area=valid.reduce((s,r)=>s+r.area,0);
  return {mean:area?valid.reduce((s,r)=>s+r.values[index]*r.area,0)/area:null,max:valid.length?Math.max(...valid.map(r=>r.values[index])):null,valid:valid.length,total:regions.length};
}
export function csvText(bundle) {
  const quote=s=>'"'+String(s).replaceAll('"','""')+'"';
  const lines=['country_iso3,boundary_level,region_id,region,date,rainfall_mm,sample_count,variable,model,timezone'];
  for(const region of bundle.regions) bundle.dates.forEach((date,i)=>lines.push([bundle.country,bundle.level,quote(region.id),quote(region.name),date,region.values[i]??'',region.points.length,bundle.variable,'era5','GMT'].join(',')));
  return lines.join('\n');
}
// GitHub's /raw/ redirect does not consistently allow browser cross-origin fetches.
// Use the equivalent raw content origin returned by this known provider.
export function boundaryDownloadURL(url) {
  const parsed = new URL(url);
  if(parsed.hostname === 'github.com') {
    const parts = parsed.pathname.split('/');
    if(parts[3] === 'raw') {
      parts.splice(3, 1);
      parsed.hostname = 'raw.githubusercontent.com';
      parsed.pathname = parts.join('/');
    }
  }
  return parsed.href;
}
export async function fetchBoundaryGeoJSON(url, options = {}) {
  const rawURL=boundaryDownloadURL(url);
  try { return await fetchJSON(rawURL,options); }
  catch(error) {
    // Git LFS serves a text pointer from raw.githubusercontent.com for large files.
    // The media origin resolves that pointer into the actual GeoJSON bytes.
    const media=new URL(rawURL);
    if(!(error instanceof SyntaxError)||media.hostname!=='raw.githubusercontent.com') throw error;
    media.hostname='media.githubusercontent.com';
    media.pathname='/media'+media.pathname;
    return fetchJSON(media.href,options);
  }
}
export async function fetchJSON(url,{signal,retries=3}={}) {
  for(let attempt=0;;attempt++) {
    const response=await fetch(url,{signal});
    if(response.ok) return response.json();
    let reason='';try { reason=(await response.json()).reason||''; } catch {}
    if((response.status===429||response.status>=500)&&attempt<retries) {
      const retry=Number(response.headers.get('Retry-After'));
      const ms=Math.min(60000,retry>0?retry*1000:2000*2**attempt);
      await new Promise((resolve,reject)=>{
        const onAbort=()=>{clearTimeout(timer);reject(new DOMException('Cancelled','AbortError'));};
        const timer=setTimeout(()=>{signal?.removeEventListener('abort',onAbort);resolve();},ms);
        if(signal?.aborted) onAbort(); else signal?.addEventListener('abort',onAbort,{once:true});
      });
      continue;
    }
    throw new Error(reason||`Data service returned HTTP ${response.status}. Please try again later.`);
  }
}
export async function fetchWeather(regions,dates,variable,onProgress=()=>{},{signal}={}) {
  const points=regions.flatMap(r=>r.points), all=[];
  for(let i=0;i<points.length;i+=10) {
    const batch=points.slice(i,i+10);
    const params=new URLSearchParams({latitude:batch.map(p=>p.latitude).join(','),longitude:batch.map(p=>p.longitude).join(','),start_date:dates[0],end_date:dates.at(-1),daily:variable,timezone:'GMT',models:'era5',precipitation_unit:'mm'});
    const data=await fetchJSON('https://archive-api.open-meteo.com/v1/archive?'+params,{signal});
    all.push(...(Array.isArray(data)?data:[data]));
    onProgress(Math.min(i+10,points.length),points.length);
    if(i+10<points.length) await new Promise(resolve=>setTimeout(resolve,800));
  }
  return aggregateDaily(regions,all,dates,variable);
}
