import {writeFileSync, mkdirSync} from 'node:fs';
import {join, resolve} from 'node:path';
const port=9333, out=resolve('movement-test-output'); mkdirSync(out,{recursive:true});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function getJson(path,opts={}){const r=await fetch(`http://127.0.0.1:${port}${path}`,opts); if(!r.ok) throw Error(path+' '+r.status); return await r.json();}
let target=await getJson('/json/new?http://localhost:8000/test-movement.html',{method:'PUT'});
const ws=new WebSocket(target.webSocketDebuggerUrl); let id=0; const pending=new Map(); const errors=[];
function send(method,params={}){return new Promise((resolve,reject)=>{const mid=++id; pending.set(mid,{resolve,reject}); ws.send(JSON.stringify({id:mid,method,params})); setTimeout(()=>{if(pending.has(mid)){pending.delete(mid); reject(Error('timeout '+method));}},10000);});}
ws.onmessage=e=>{const m=JSON.parse(e.data); if(m.id&&pending.has(m.id)){const p=pending.get(m.id); pending.delete(m.id); m.error?p.reject(Error(JSON.stringify(m.error))):p.resolve(m.result);} else if(m.method){if(m.method==='Runtime.exceptionThrown') errors.push('EXCEPTION '+(m.params.exceptionDetails.text||'')+' '+(m.params.exceptionDetails.exception?.description||'')); if(m.method==='Log.entryAdded'&&m.params.entry.level==='error') errors.push('LOG '+m.params.entry.text); if(m.method==='Runtime.consoleAPICalled'&&m.params.type==='error') errors.push('CONSOLE '+m.params.args.map(a=>a.value??a.description).join(' '));}};
await new Promise((res,rej)=>{ws.onopen=res; ws.onerror=rej;});
await send('Page.enable'); await send('Runtime.enable'); await send('Log.enable'); await send('Network.enable'); await send('Network.setCacheDisabled',{cacheDisabled:true});
await send('Emulation.setDeviceMetricsOverride',{width:900,height:3000,deviceScaleFactor:1,mobile:false});
await send('Page.navigate',{url:'http://localhost:8000/test-movement.html'}); await sleep(14000);
const ev=`(() => { const kids=[...document.querySelectorAll('#results > div, #results > pre')]; const traces=[...document.querySelectorAll('#results > pre')]; const canvas=document.querySelector('#view'); const rr=e=>{const r=e.getBoundingClientRect(); return {top:r.top+scrollY,bottom:r.bottom+scrollY,left:r.left+scrollX,right:r.right+scrollX,width:r.width,height:r.height};}; return {text:kids.map(e=>({tag:e.tagName, cls:e.className, text:e.textContent})), traceRects:traces.map(rr), canvasRect:rr(canvas), body:{width:Math.ceil(document.documentElement.scrollWidth),height:Math.ceil(document.documentElement.scrollHeight)}}; })()`;
const data=(await send('Runtime.evaluate',{returnByValue:true,expression:ev})).result.value;
writeFileSync(join(out,'pose-run.json'),JSON.stringify({data,errors},null,2));
function clip(x,y,w,h){return {x:Math.max(0,x),y:Math.max(0,y),width:Math.ceil(w),height:Math.ceil(h),scale:1};}
const width=Math.max(900, Math.ceil(data.body.width));
let topH=Math.ceil((data.traceRects[1]?.bottom||900)+12);
let top=await send('Page.captureScreenshot',{format:'png',fromSurface:true,captureBeyondViewport:true,clip:clip(0,0,width,topH)}); writeFileSync(join(out,'pose-run-top.png'),Buffer.from(top.data,'base64'));
let y2=Math.max(0, Math.floor((data.traceRects[2]?.top||topH)-10)); let h2=Math.ceil(data.canvasRect.bottom-y2+25);
let rest=await send('Page.captureScreenshot',{format:'png',fromSurface:true,captureBeyondViewport:true,clip:clip(0,y2,width,h2)}); writeFileSync(join(out,'pose-run.png'),Buffer.from(rest.data,'base64'));
await send('Target.closeTarget',{targetId:target.id}).catch(()=>{}); ws.close(); console.log(JSON.stringify({screenshots:[join(out,'pose-run-top.png'),join(out,'pose-run.png')],errors,data},null,2)); process.exit(0);

