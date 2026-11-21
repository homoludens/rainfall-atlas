// Orthographic 3D camera: x/east, y/north, z/rainfall above the map plane.
// Orthographic projection keeps equal rainfall heights equal on screen, at any location.
export const DEFAULT_CAMERA = Object.freeze({yaw:-0.48, tilt:0.68, zoom:1});
export function rainfallDomain(regions) {
  let max=0;
  for(const region of regions) for(const value of region.values) if(Number.isFinite(value)&&value>max)max=value;
  if(max===0)return 1;
  const power=10**Math.floor(Math.log10(max)), normalized=max/power;
  return (normalized<=1?1:normalized<=2?2:normalized<=2.5?2.5:normalized<=5?5:10)*power;
}
export function rainfallHeight(value,domain,gain=1) {
  if(!Number.isFinite(value)||value<0)return null;
  return value/domain*260*gain;
}
export function viewPoint([x,y,z=0],camera) {
  const c=Math.cos(camera.yaw),s=Math.sin(camera.yaw);
  const rx=x*c-y*s,ry=x*s+y*c;
  return [rx,-ry*Math.sin(camera.tilt)-z*Math.cos(camera.tilt),ry*Math.cos(camera.tilt)-z*Math.sin(camera.tilt)];
}
export function fitCamera(points,camera,rect,maxHeight) {
  const projected=points.flatMap(([x,y])=>[viewPoint([x,y,0],camera),viewPoint([x,y,maxHeight],camera)]);
  let minX=Infinity,maxX=-Infinity,minY=Infinity,maxY=-Infinity;
  for(const [x,y] of projected){minX=Math.min(minX,x);maxX=Math.max(maxX,x);minY=Math.min(minY,y);maxY=Math.max(maxY,y);}
  const scale=Math.min(rect.width/Math.max(1,maxX-minX),rect.height/Math.max(1,maxY-minY))*camera.zoom;
  const cx=rect.x+rect.width/2-(minX+maxX)/2*scale,cy=rect.y+rect.height/2-(minY+maxY)/2*scale;
  return {scale,project:point=>{const [x,y,depth]=viewPoint(point,camera);return [cx+x*scale,cy+y*scale,depth];}};
}
export function columnFaces([x,y],width,height) {
  const a=width/2;
  const p=[[x-a,y-a,0],[x+a,y-a,0],[x+a,y+a,0],[x-a,y+a,0],[x-a,y-a,height],[x+a,y-a,height],[x+a,y+a,height],[x-a,y+a,height]];
  return [
    {vertices:[p[0],p[1],p[5],p[4]],shade:0.72},
    {vertices:[p[1],p[2],p[6],p[5]],shade:0.9},
    {vertices:[p[2],p[3],p[7],p[6]],shade:0.65},
    {vertices:[p[3],p[0],p[4],p[7]],shade:0.82},
    {vertices:[p[4],p[5],p[6],p[7]],shade:1.18}
  ];
}
