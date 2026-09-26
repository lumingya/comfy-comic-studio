/* One invocation per OS process. vm limits accidental access; NOT a hostile-code sandbox. */
import vm from 'node:vm';import readline from 'node:readline';
const lines=readline.createInterface({input:process.stdin,crlfDelay:Infinity});let started=false;let serial=0;const pending=new Map();
const emit=v=>process.stdout.write(JSON.stringify(v)+'\n');
lines.on('line',async line=>{
  try{
    const m=JSON.parse(line);
    if(started){const p=pending.get(m.id);if(p){pending.delete(m.id);m.error?p.reject(new Error(m.error)):p.resolve(m.result)}return}
    started=true;
    const bridge=(method,args)=>new Promise((resolve,reject)=>{const id=++serial;pending.set(id,{resolve,reject});emit({rpc:method,id,args})});
    const sandbox=vm.createContext({__data:JSON.stringify(m),__bridge:bridge},{codeGeneration:{strings:false,wasm:false}});
    const setup=`"use strict";const input=JSON.parse(__data);let s=input.seed>>>0;const random=()=>{s=(s+0x6D2B79F5)|0;let t=Math.imul(s^s>>>15,1|s);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296};
      const ctx=Object.freeze({seed:input.seed,random,get:key=>{if(!Object.hasOwn(input.values,key))throw Error('Undeclared or unresolved dependency: '+key);return JSON.parse(JSON.stringify(input.values[key]))},image:Object.freeze({generate:(prompt,options={})=>__bridge('image.generate',{prompt,options})}),llm:Object.freeze({chat:(prompt,options={})=>__bridge('llm.chat',{prompt,options})})});
      Math.random=random;const Date=undefined;const console=Object.freeze({log:()=>{}});`;
    const script=new vm.Script(setup+'\n(async()=>{'+m.script+'\n})()');
    const result=await script.runInContext(sandbox,{timeout:Math.min(m.timeout||30000,30000)});
    const json=JSON.stringify(result);if(json===undefined||json.length>1024*1024)throw Error('Script must return a JSON value of at most 1 MiB');
    emit({done:true,value:JSON.parse(json)});process.exit(0);
  }catch(e){emit({done:true,error:String(e.message).slice(0,500)});process.exit(1)}
});
