import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {fetchBoundaryGeoJSON,boundaryDownloadURL,contains,sampleRegion,areaKm2,dailyDates,aggregateDaily,frameStats,csvText} from '../dist/core.mjs';
const polygon=(coordinates)=>({type:'Feature',properties:{shapeName:'A, "region"'},geometry:{type:'Polygon',coordinates}});
const region=polygon([[[0,0],[2,0],[2,2],[0,2],[0,0]],[[.5,.5],[1.5,.5],[1.5,1.5],[.5,1.5],[.5,.5]]]);
test('samples remain inside a region and outside its holes',()=>{const points=sampleRegion(region,5);assert.equal(points.length,5);for(const p of points)assert(contains(region,p.longitude,p.latitude));assert.deepEqual(points,sampleRegion(region,5));});
test('spherical area subtracts holes and ignores winding',()=>{const outer=polygon([region.geometry.coordinates[0]]),hole=polygon([region.geometry.coordinates[1]]);assert(Math.abs(areaKm2(region)-(areaKm2(outer)-areaKm2(hole)))<1e-6);const reversed=structuredClone(region);reversed.geometry.coordinates.forEach(r=>r.reverse());assert.equal(areaKm2(region),areaKm2(reversed));});
test('each frame is exactly one day, including leap days and year boundaries',()=>{assert.deepEqual(dailyDates('2024-02-28','2024-03-01'),['2024-02-28','2024-02-29','2024-03-01']);assert.deepEqual(dailyDates('2024-12-31','2025-01-01'),['2024-12-31','2025-01-01']);assert.throws(()=>dailyDates('2024-02-30','2024-03-01'));assert.throws(()=>dailyDates('2024-05-03','2024-05-01'));});
const dates=['2024-05-01','2024-05-02'];
const response=values=>({daily_units:{rain_sum:'mm'},daily:{time:dates,rain_sum:values}});
test('daily samples are averaged independently, never accumulated; null is not zero',()=>{const regs=[{id:'r',name:'A',area:2,points:[{},{}]}];const [r]=aggregateDaily(regs,[response([2,5]),response([4,null])],dates,'rain_sum');assert.deepEqual(r.values,[3,null]);});
test('weather response alignment, units and sample counts are checked',()=>{const regs=[{points:[{}]}];assert.throws(()=>aggregateDaily(regs,[],dates,'rain_sum'));const row=response([1,2]);row.daily.time=[...dates].reverse();assert.throws(()=>aggregateDaily(regs,row,dates,'rain_sum'));row.daily.time=dates;row.daily_units.rain_sum='inch';assert.throws(()=>aggregateDaily(regs,row,dates,'rain_sum'));});
test('country summary uses region area and reports missing coverage',()=>{assert.deepEqual(frameStats([{area:1,values:[2]},{area:3,values:[6]},{area:9,values:[null]}],0),{mean:5,max:6,valid:2,total:3});});
test('CSV preserves every day and quotes region names',()=>{const result=csvText({country:'SRB',level:'ADM1',variable:'rain_sum',dates,regions:[{id:'r',name:'A, "region"',points:[{}],values:[0,null]}]});assert.equal(result.split('\n').length,3);assert(result.includes('"A, ""region"""'));assert(result.includes('2024-05-01,0,1'));assert(result.includes('2024-05-02,,1'));});
test('every Serbia sample is contained in its own actual district boundary',async()=>{const geo=JSON.parse(await readFile(new URL('../dist/data/SRB-ADM1.geojson',import.meta.url),'utf8'));assert.equal(geo.features.length,25);for(const feature of geo.features){for(const p of sampleRegion(feature,5))assert(contains(feature,p.longitude,p.latitude));assert(areaKm2(feature)>0);}});

test("GitHub boundary downloads use the browser-compatible raw origin",()=>{assert.equal(boundaryDownloadURL("https://github.com/wmgeolab/geoBoundaries/raw/9469f09/releaseData/gbOpen/ALB/ADM1/geoBoundaries-ALB-ADM1_simplified.geojson"),"https://raw.githubusercontent.com/wmgeolab/geoBoundaries/9469f09/releaseData/gbOpen/ALB/ADM1/geoBoundaries-ALB-ADM1_simplified.geojson");});

test('Git LFS boundary pointers resolve to the actual media GeoJSON',async()=>{
 const original=globalThis.fetch;
 const urls=[];
 globalThis.fetch=async url=>{urls.push(url);return new Response(urls.length===1?'version https://git-lfs.github.com/spec/v1\noid sha256:example':JSON.stringify({type:'FeatureCollection',features:[]}));};
 try{const data=await fetchBoundaryGeoJSON('https://github.com/wmgeolab/geoBoundaries/raw/9469f09/releaseData/gbOpen/ALB/ADM1/regions.geojson');assert.equal(data.type,'FeatureCollection');assert.equal(urls[1],'https://media.githubusercontent.com/media/wmgeolab/geoBoundaries/9469f09/releaseData/gbOpen/ALB/ADM1/regions.geojson');}finally{globalThis.fetch=original;}
});
