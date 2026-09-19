/* SDK 2 kernel. No application globals: integrations are explicit adapters.
 * Trusted, same-realm code, NOT a security sandbox. All SDK resources are owned.
 */
'use strict';
(function(global){
  function create(adapter={}) {
    const owners=new Map(), registries=Object.fromEntries(['commands','panels','slots','workspaces','types','hooks'].map(k=>[k,new Map()]));
    const errors=[]; let serial=0;
    const identifier=s=>{if(typeof s!=='string'||! /^[a-z][a-z0-9_-]{0,63}$/.test(s))throw Error('Use a local identifier (a-z, 0-9, -, _)');return s};
    function report(owner,phase,error){
      const item={owner,phase,message:String(error?.message||error),time:Date.now()};errors.push(item);if(errors.length>100)errors.shift();adapter.report?.(item);return item;
    }
    function session(id){const owner=owners.get(id);if(!owner||owner.controller.signal.aborted)throw Error('Extension is disposed: '+id);return owner}
    function own(id,fn){
      const owner=session(id);if(typeof fn!=='function')throw Error('Cleanup must be a function');
      let active=true;
      const dispose=()=>{if(!active)return;active=false;owner.cleanups.delete(dispose);try{Promise.resolve(fn()).catch(e=>report(id,'cleanup',e))}catch(e){report(id,'cleanup',e)}};
      owner.cleanups.add(dispose);return dispose;
    }
    function register(id,kind,item){
      session(id);const key=id+':'+identifier(item.id),map=registries[kind];
      if(map.has(key))throw Error('Duplicate registration: '+key);
      const value={...item,key,owner:id,order:Number(item.order)||0,serial:serial++};map.set(key,value);
      const dispose=own(id,()=>{map.delete(key);adapter.changed?.(kind)});adapter.changed?.(kind);return dispose;
    }
    const list=kind=>[...registries[kind].values()].sort((a,b)=>a.order-b.order||a.serial-b.serial);
    async function invoke(item,fn,args=[],strict=false){
      if(!owners.has(item.owner))return;
      const owner=owners.get(item.owner);let timer,expired=false;const timeout=adapter.callbackTimeout||15000;
      try {
        return await Promise.race([Promise.resolve().then(()=>fn(...args)).then(value=>{if(expired&&typeof value==='function'){try{Promise.resolve(value()).catch(e=>report(item.owner,'late cleanup',e))}catch(e){report(item.owner,'late cleanup',e)}return undefined}return value}),new Promise((_,reject)=>{timer=setTimeout(()=>{expired=true;reject(Error('Extension callback timed out'))},timeout)})]);
      }catch(e){report(item.owner,'callback',e);if(strict)throw Error('['+item.owner+'] '+e.message)}
      finally{clearTimeout(timer);if(owner.controller.signal.aborted)adapter.changed?.('disposed')}
    }
    async function emit(event,payload,{strict=false}={}){
      for(const item of list('hooks').filter(x=>x.event===event)){
        if(!owners.has(item.owner))continue;
        await invoke(item,item.handler,[payload],strict);
      }
      return payload;
    }
    async function execute(key,...args){const item=registries.commands.get(key);if(!item)throw Error('Command unavailable: '+key);if(item.when&&!item.when())throw Error('Command unavailable in this context');return invoke(item,item.run,args,true)}
    function dispose(id){
      const owner=owners.get(id);if(!owner)return;
      owner.controller.abort();
      for(const fn of [...owner.cleanups].reverse())fn();
      owners.delete(id);adapter.changed?.('disposed');
    }
    function context(id,services={}){
      identifier(id);if(!owners.has(id))owners.set(id,{controller:new AbortController(),cleanups:new Set()});
      const owner=session(id),assertLive=()=>{if(owner.controller.signal.aborted||owners.get(id)!==owner)throw Error('Extension is disposed: '+id)};
      const managed=fn=>(...args)=>{assertLive();return fn(...args)};
      const add=(kind,item)=>{assertLive();return register(id,kind,item)};
      const renderable=(kind,item)=>{if(typeof item.render!=='function')throw Error(kind+' requires render(root, ctx)');return add(kind,item)};
      const commands={register:item=>{if(typeof item.run!=='function'||!item.label)throw Error('Command requires label and run');if(item.shortcut&&(!/^(?:mod\+)?(?:alt\+)?(?:shift\+)?[a-z0-9]$/i.test(item.shortcut)||item.shortcut.toLowerCase()==='mod+shift+p'))throw Error('Invalid or reserved shortcut');if(item.shortcut&&list('commands').some(c=>c.shortcut?.toLowerCase()===item.shortcut.toLowerCase()))throw Error('Shortcut already registered');return add('commands',item)},execute:managed(execute),list:()=>list('commands').map(({key,label,shortcut})=>({key,label,shortcut}))};
      const ctx={...services,id,apiVersion:2,signal:owner.controller.signal,
        dispose:managed(fn=>own(id,fn)),commands,
        toolbar:{register:item=>commands.register({...item,toolbar:true})},
        panels:{register:item=>renderable('panels',item)},
        workspaces:{register:item=>renderable('workspaces',item),open:managed(local=>adapter.openWorkspace(id+':'+identifier(local)))},
        slots:{register:item=>{if(!['sidebar.bottom','topbar.end','workspace.before','workspace.after','story.toolbar','settings.toolbar'].includes(item.slot))throw Error('Unknown UI slot');return renderable('slots',item)}},
        variables:{registerType:(name,definition)=>{if(typeof definition.normalize!=='function')throw Error('Type requires normalize');const off=add('types',{...definition,id:name});adapter.type?.('plugin:'+id+':'+name,definition);return own(id,()=>{off();adapter.type?.('plugin:'+id+':'+name,null)})}},
        on:managed((event,handler,options={})=>{if(typeof event!=='string'||!event||typeof handler!=='function')throw Error('Event requires a name and handler');return add('hooks',{id:'hook-'+serial++,event,handler,order:options.priority||0})}),
        events:{emit:managed((name,data)=>emit('plugin:'+id+':'+name,data))},
        styles:{add:managed((css,options={})=>{const node=adapter.style?.(id,css,options);return own(id,()=>node?.remove())})},
        dom:{listen:managed((target,event,handler,options)=>{target.addEventListener(event,handler,options);return own(id,()=>target.removeEventListener(event,handler,options))})},
        timers:{interval:managed((fn,ms)=>{const timer=setInterval(()=>{void invoke({owner:id},fn)},Math.max(16,ms));return own(id,()=>clearInterval(timer))}),timeout:managed((fn,ms)=>{let off;const timer=setTimeout(()=>{off();void invoke({owner:id},fn)},ms);off=own(id,()=>clearTimeout(timer));return off})}
      };
      return Object.freeze(ctx);
    }
    return Object.freeze({context,dispose,emit,execute,list,invoke,report,errors,registries,owners});
  }
  global.MioExtensionRuntime=Object.freeze({create});
})(globalThis);
