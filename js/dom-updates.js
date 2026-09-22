/* Reconcile the work surface without detaching active editors or IME sessions. */
'use strict';
const modalOrder=[];
function topDialog(){
  const modals=modalOrder.filter(d=>d.open&&d.isConnected);
  if(modals.length)return modals.at(-1);
  if(typeof document!=='undefined'){
    const openModals=[...document.querySelectorAll('dialog[open]')].filter(d=>d.matches?.(':modal'));
    if(openModals.length)return openModals.at(-1);
    return document.activeElement?.closest('dialog[open]')||[...document.querySelectorAll('dialog[open]')].at(-1)||document.body;
  }
  return null;
}
function ensureToastHost(){
  if(typeof document==='undefined')return;
  const toasts=document.querySelector('#toasts');
  if(!toasts)return;
  const host=topDialog();
  if(host&&toasts.parentElement!==host){
    host.append(toasts);
  }
}
if(typeof HTMLDialogElement!=='undefined'){
  const origShowModal=HTMLDialogElement.prototype.showModal;
  const origClose=HTMLDialogElement.prototype.close;
  const origRemove=HTMLDialogElement.prototype.remove;
  if(origShowModal){
    HTMLDialogElement.prototype.showModal=function(...args){
      const at=modalOrder.indexOf(this);if(at>=0)modalOrder.splice(at,1);
      modalOrder.push(this);
      const res=origShowModal.apply(this,args);
      ensureToastHost();
      return res;
    };
  }
  if(origClose){
    HTMLDialogElement.prototype.close=function(...args){
      const at=modalOrder.indexOf(this);if(at>=0)modalOrder.splice(at,1);
      const res=origClose.apply(this,args);
      ensureToastHost();
      return res;
    };
  }
  if(origRemove){
    HTMLDialogElement.prototype.remove=function(...args){
      const at=modalOrder.indexOf(this);if(at>=0)modalOrder.splice(at,1);
      const res=origRemove.apply(this,args);
      ensureToastHost();
      return res;
    };
  }
}
document.addEventListener('beforetoggle',event=>{
  if(event.target.tagName!=='DIALOG')return;
  const at=modalOrder.indexOf(event.target);if(at>=0)modalOrder.splice(at,1);
  if(event.newState==='open')modalOrder.push(event.target);
  ensureToastHost();
},true);
document.addEventListener('close',event=>{
  if(event.target.tagName!=='DIALOG')return;
  const at=modalOrder.indexOf(event.target);if(at>=0)modalOrder.splice(at,1);
  ensureToastHost();
},true);
if(typeof window!=='undefined'||typeof globalThis!=='undefined'){
  const g=typeof window!=='undefined'?window:globalThis;
  let activeToast=g.toast;
  const wrapToast=fn=>function(...args){
    const res=fn?.apply(this,args);
    ensureToastHost();
    return res;
  };
  try{
    Object.defineProperty(g,'toast',{
      configurable:true,
      enumerable:true,
      get(){return wrapToast(activeToast)},
      set(fn){activeToast=fn;}
    });
  }catch{
    if(typeof g.toast==='function')g.toast=wrapToast(g.toast);
  }
}
function patchMain(html){return patchDOM(document.querySelector('#main'),html)}
function patchDOM(root,html){
  const fragment=document.createElement('template');fragment.innerHTML=html;
  const focused=document.activeElement;
  function key(n){if(n.nodeType!==1)return '';return n.id||['data-id','data-index','name','data-key','data-layer-hit','data-editor-key','data-workshop-frame','data-workshop-preset','data-story-caption','data-script-caption','data-frame-field','data-setting','data-act','data-production-task','data-v3-frame','data-v3-template','data-sort-book','data-book'].map(k=>n.hasAttribute(k)?k+':'+n.getAttribute(k)+':'+(n.dataset.id||''):'').filter(Boolean).join('|')}
  function same(a,b){if(a.nodeType!==b.nodeType||a.nodeName!==b.nodeName||key(a)!==key(b))return false;if(a.nodeType===1&&!key(a)&&a!==focused&&a.contains(focused))return [...b.querySelectorAll('*')].some(n=>n.nodeName===focused.nodeName&&key(n)===key(focused));return true}
  function children(old,next){let cursor=old.firstChild;for(const incoming of [...next.childNodes]){
    let node=cursor;
    if(!node||!same(node,incoming)){
      node=null; // A failed match must never reuse the incompatible cursor.
      // Only search the unconsumed suffix. Inferred keys (e.g. data-act)
      // may repeat; already matched or newly inserted nodes cannot be reused.
      let cur=cursor?.nextSibling;
      while(cur){
        if(same(cur,incoming)){node=cur;break}
        cur=cur.nextSibling;
      }
      if(node){
        // Never detach the active editor (including IME) to reorder siblings.
        // Move intervening siblings around it instead; moveBefore() crashes
        // Chromium on some repeated select/settings subtree reconciliations.
        if(node===focused||node.contains?.(focused)){
          const after=node.nextSibling;let before=cursor;
          while(before&&before!==node){const nextBefore=before.nextSibling;old.insertBefore(before,after);before=nextBefore}
        }else old.insertBefore(node,cursor);
      }else{node=incoming.cloneNode(true);old.insertBefore(node,cursor)}
    }
    if(node.nodeType===1&&incoming.nodeType===1){
      for(const attr of [...node.attributes])if(!incoming.hasAttribute(attr.name)&&!(node===focused&&['value','checked'].includes(attr.name)))node.removeAttribute(attr.name);
      for(const attr of [...incoming.attributes])if(node.getAttribute(attr.name)!==attr.value&&!(node===focused&&['value','checked'].includes(attr.name)))node.setAttribute(attr.name,attr.value);
      if(node!==focused&&!node.contains(focused)){
        if(node.tagName==='INPUT'){if(node.value!==incoming.value)node.value=incoming.value;node.checked=incoming.checked}
        else if(node.tagName==='TEXTAREA'){if(node.value!==incoming.value)node.value=incoming.value}
        else if(node.tagName==='SELECT'){children(node,incoming);if(node.value!==incoming.value)node.value=incoming.value}
        else children(node,incoming);
      }else if(node!==focused)children(node,incoming);
      if(node.tagName==='OPTION'&&node.selected!==incoming.selected)node.selected=incoming.selected;
    }else if(node.nodeValue!==incoming.nodeValue)node.nodeValue=incoming.nodeValue;
    cursor=node.nextSibling;
  }while(cursor){const next=cursor.nextSibling;cursor.remove();cursor=next}}
  children(root,fragment.content);return html;
}

function thumbnailURL(src,size='320x240'){if(typeof src!=='string'||!src.startsWith('/images/'))return src;return src.split('?')[0]+'?thumb='+size}
