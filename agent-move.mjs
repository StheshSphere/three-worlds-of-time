const port=9336,sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function j(p,o={}){const r=await fetch(`http://127.0.0.1:${port}${p}`,o);if(!r.ok)throw Error(r.status);return r.json()}
let t=await j('/json/new?'+encodeURIComponent('http://localhost:8000/test-movement.html'),{method:'PUT'});let ws=new WebSocket(t.webSocketDebuggerUrl),id=0,pm=new Map();
function send(m,p={}){return new Promise((res,rej)=>{let i=++id;pm.set(i,{res,rej});ws.send(JSON.stringify({id:i,method:m,params:p}));setTimeout(()=>rej(Error('timeout '+m)),15000)})}
ws.onmessage=e=>{let m=JSON.parse(e.data);if(m.id&&pm.has(m.id)){let p=pm.get(m.id);pm.delete(m.id);m.error?p.rej(Error(JSON.stringify(m.error))):p.res(m.result)}};await new Promise(r=>ws.onopen=r);await send('Page.enable');await send('Runtime.enable');await send('Page.navigate',{url:'http://localhost:8000/test-movement.html'});await sleep(9000);
let expr=`(() => {const lines=document.body.innerText.split(/\n/).map(s=>s.trim()).filter(Boolean);return {summary:lines.find(l=>l.includes('ALL 15 CHECKS PASS'))||lines.find(l=>/FAIL/.test(l))||lines.at(-1),fails:lines.filter(l=>/FAIL/.test(l)),lines}})()`;
let data=(await send('Runtime.evaluate',{expression:expr,returnByValue:true})).result.value;console.log(JSON.stringify(data,null,2));await send('Target.closeTarget',{targetId:t.id}).catch(()=>{});ws.close();
