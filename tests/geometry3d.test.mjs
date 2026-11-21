import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {DEFAULT_CAMERA,rainfallDomain,rainfallHeight,viewPoint,fitCamera,columnFaces} from '../dist/geometry3d.mjs';

test('height scale is based on all daily frames, including a later extreme',()=>{
 const regions=[{values:[0,2,9,null]},{values:[1,3,4,43]}];
 const domain=rainfallDomain(regions);
 assert.equal(domain,50);
 assert.equal(rainfallHeight(20,domain),rainfallHeight(10,domain)*2);
 assert.equal(rainfallHeight(5,domain),rainfallHeight(10,domain)/2);
});
test('zero rainfall has zero height, missing and negative values have no column',()=>{
 assert.equal(rainfallHeight(0,50),0);
 for(const missing of [null,undefined,NaN,Infinity,-1])assert.equal(rainfallHeight(missing,50),null);
 assert.equal(rainfallDomain([{values:[0,null,0]}]),1);
});
test('equal rainfall has equal visible height in different regions and at every yaw',()=>{
 for(const yaw of [-2,-.48,0,2]){
  const camera={...DEFAULT_CAMERA,yaw};
  const rises=[[100,200],[-350,-300]].map(([x,y])=>viewPoint([x,y,0],camera)[1]-viewPoint([x,y,104],camera)[1]);
  assert(Math.abs(rises[0]-rises[1])<1e-10);
  assert(rises[0]>0);
 }
});
test('the whole-range camera envelope fits both dry ground and maximum-height bars',()=>{
 const corners=[[-400,-400],[400,-400],[400,400],[-400,400]],rect={x:20,y:100,width:800,height:400};
 const fit=fitCamera(corners,DEFAULT_CAMERA,rect,260);
 for(const p of corners)for(const z of [0,260]){const [x,y]=fit.project([...p,z]);assert(x>=rect.x-1e-7&&x<=rect.x+rect.width+1e-7);assert(y>=rect.y-1e-7&&y<=rect.y+rect.height+1e-7);}
});
test('changing days does not alter camera fit or rainfall-to-screen conversion',async()=>{
 const bundle=JSON.parse(await readFile(new URL('../dist/data/SRB-2024-05-01-2024-05-31.json',import.meta.url),'utf8'));
 const domain=rainfallDomain(bundle.regions),rect={x:0,y:0,width:800,height:400};
 const fit=fitCamera([[-300,-400],[300,400]],DEFAULT_CAMERA,rect,rainfallHeight(domain,domain));
 for(let day=0;day<bundle.dates.length;day++){
  const actualMax=Math.max(...bundle.regions.map(r=>r.values[day]??0));
  assert(actualMax<=domain);
  const delta=fit.project([0,0,0])[1]-fit.project([0,0,rainfallHeight(10,domain)])[1];
  const twice=fit.project([0,0,0])[1]-fit.project([0,0,rainfallHeight(20,domain)])[1];
  assert(Math.abs(twice-delta*2)<1e-9);
 }
});
test('3D column top preserves the exact rainfall height and its region anchor',()=>{
 const faces=columnFaces([20,-30],16,52),top=faces.at(-1).vertices;
 assert(top.every(p=>p[2]===52));
 assert.equal(top.reduce((s,p)=>s+p[0],0)/4,20);
 assert.equal(top.reduce((s,p)=>s+p[1],0)/4,-30);
});
