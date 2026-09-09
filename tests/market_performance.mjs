// Synthetic scroll/localization benchmark; no paid services or user data.
import {chromium} from 'playwright';
import {spawn} from 'node:child_process';
import {mkdtempSync,cpSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),temp=mkdtempSync(path.join(tmpdir(),'mio-market-'));
for(const name of ['server.py','mio_api.py','mio_credentials.py','mio_docs.py','index.html','styles.css','favicon.svg','vendor','js','docs'])cpSync(path.join(root,name),path.join(temp,name),{recursive:true});
if(process.env.MIO_BENCH_HTML)cpSync(process.env.MIO_BENCH_HTML,path.join(temp,'index.html'));
const port=8795,server=spawn('python',['-u','server.py'],{cwd:temp,env:{...process.env,MIO_PORT:String(port)},stdio:['ignore','pipe','pipe']});
let browser;
try{
 await new Promise((resolve,reject)=>{const t=setTimeout(()=>reject(Error('server timeout')),10000);server.stdout.on('data',d=>{if(d.toString().includes('物理落盘')){clearTimeout(t);resolve()}});server.on('error',reject)});
 browser=await chromium.launch({args:['--no-sandbox']});const page=await browser.newPage({viewport:{width:1360,height:900}});
 await page.route(/^https:\/\//,r=>r.abort());await page.goto('http://127.0.0.1:'+port);await page.waitForFunction(()=>!rt.booting);
 await page.evaluate(()=>{document.querySelectorAll('dialog[open]').forEach(d=>d.close());state.books.push(...Array.from({length:500},(_,i)=>({id:'bench_'+i,title:'Benchmark book '+i,steps:Array.from({length:32},(_,j)=>({name:'Frame '+j,prompt:'Unique prompt '+i+' '+j,caption:'Caption '+j}))})));catalog.push(...Array.from({length:240},(_,i)=>({id:'bench-card-'+i,title:'Resource '+i,desc:'A storyboard resource used in the scroll benchmark.',tags:'bench',type:'templates',author:'Benchmark',version:'1',icon:'book'})));ui.marketSearch='';ui.marketTab='all';marketModal()});
 await page.waitForTimeout(700);const cdp=await page.context().newCDPSession(page);await cdp.send('Emulation.setCPUThrottlingRate',{rate:4});
 const result=await page.evaluate(async()=>{
   const body=document.querySelector('#modal-body'),card=document.querySelector('.market-item'),input=document.querySelector('#market-search'),probe=document.createElement('span');probe.className='tiny muted';document.querySelector('#market-content').append(probe);
   let fullScans=0,localScans=0,localizationMs=0,marketRenders=0;const original=localizeWorkspace,renderOriginal=renderMarket;localizeWorkspace=function(root){const t=performance.now();if(!root||root===document.body)fullScans++;else localScans++;try{return original(root)}finally{localizationMs+=performance.now()-t}};renderMarket=function(...a){marketRenders++;return renderOriginal(...a)};
   const frames=[];let previous=performance.now();for(let i=0;i<120;i++){await new Promise(requestAnimationFrame);const now=performance.now();frames.push(now-previous);previous=now;body.scrollTop=(i%60)/60*(body.scrollHeight-body.clientHeight);if(i%10===0)probe.textContent='Benchmark progress '+i}
   frames.sort((a,b)=>a-b);return{fixture:'240 added market cards; 500 books x 32 frames; Chromium 4x CPU slowdown; 120 scroll frames; 12 local text updates',fullScans,localScans,localizationMs:Math.round(localizationMs*10)/10,marketRenders,p95FrameMs:Math.round(frames[Math.floor(frames.length*.95)]*10)/10,cardPreserved:card===document.querySelector('.market-item'),inputPreserved:input===document.querySelector('#market-search'),backdropFilter:getComputedStyle(document.querySelector('#modal'),'::backdrop').backdropFilter};
 });
 console.log(JSON.stringify(result,null,2));if(process.env.MIO_BENCH_OUTPUT)writeFileSync(process.env.MIO_BENCH_OUTPUT,JSON.stringify(result,null,2)+'\n');
}finally{await browser?.close();server.kill();await new Promise(resolve=>server.once('exit',resolve));rmSync(temp,{recursive:true,force:true})}
