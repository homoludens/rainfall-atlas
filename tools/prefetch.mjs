/** Node 20+: node tools/prefetch.mjs SRB 2024-05-01 2024-05-31 ADM1 3 */
import {mkdir,writeFile} from 'node:fs/promises';
import {fetchBoundaryGeoJSON,fetchJSON,prepareRegions,fetchWeather,dailyDates} from '../dist/core.mjs';
const [country='SRB',start='2024-05-01',end='2024-05-31',level='ADM1',samples='3']=process.argv.slice(2);
if(!/^[A-Z]{3}$/.test(country)||!/^ADM[12]$/.test(level)||![1,3,5].includes(Number(samples))) throw new Error('Use ISO3 ADM1/ADM2 and 1, 3 or 5 samples.');
const dates=dailyDates(start,end);
const metadata=await fetchJSON(`https://www.geoboundaries.org/api/current/gbOpen/${country}/${level}/`);
const geojson=await fetchBoundaryGeoJSON(metadata.simplifiedGeometryGeoJSON);
const regions=prepareRegions(geojson,Number(samples));
const result=await fetchWeather(regions,dates,'rain_sum',(n,total)=>console.log(`Fetched ${n}/${total} locations`));
const bundle={version:1,country,countryName:metadata.boundaryName,level,variable:'rain_sum',model:'era5',timezone:'GMT',requestedSamples:Number(samples),metadata,geojson,dates,regions:result,retrievedAt:new Date().toISOString()};
await mkdir('dist/data',{recursive:true});
const path=`dist/data/${country}-${start}-${end}.json`;
await writeFile(path,JSON.stringify(bundle));
console.log(`Saved ${path}`);
