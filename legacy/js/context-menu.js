/* Shared context menu: grouped items, one level of submenus, keyboard navigation and viewport clamping.
   Every entry is a real action: items dispatch through the normal data-act click path (or a `run` callback),
   so a menu never duplicates behaviour that lives elsewhere. Opening a menu never re-renders the page. */
'use strict';
const contextMenuUI={layers:[],registry:new Map(),focusEl:null,onClose:null,serial:0,hoverTimer:null,installed:false,openedAt:0};

function contextMenuOpen(){return contextMenuUI.layers.length>0}

function closeContextMenu(restoreFocus=false){
  if(!contextMenuUI.layers.length)return;
  clearTimeout(contextMenuUI.hoverTimer);
  for(const layer of contextMenuUI.layers.splice(0))layer.remove();
  contextMenuUI.registry.clear();
  const onClose=contextMenuUI.onClose,focusEl=contextMenuUI.focusEl;contextMenuUI.onClose=null;contextMenuUI.focusEl=null;
  document.documentElement.classList.remove('has-context-menu');
  if(typeof onClose==='function')try{onClose()}catch(error){console.warn('[context-menu]',error)}
  if(restoreFocus&&focusEl?.isConnected)focusEl.focus({preventScroll:true});
}

function contextMenuNormalize(items){
  const list=(items||[]).filter(Boolean).map(item=>item==='-'?{type:'separator'}:item);
  // Collapse leading, trailing and doubled separators so hidden items never leave stray lines.
  const clean=[];for(const item of list){if(item.type==='separator'){if(!clean.length||clean.at(-1).type==='separator')continue}clean.push(item)}
  while(clean.length&&clean.at(-1).type==='separator')clean.pop();
  return clean;
}

function contextMenuItemHTML(item){
  if(item.type==='separator')return '<div class="ctx-sep" role="separator"></div>';
  if(item.type==='label')return `<div class="ctx-group-label">${esc(item.label)}</div>`;
  const children=contextMenuNormalize(item.children);
  const sub=children.length?String(++contextMenuUI.serial):'';
  if(sub)contextMenuUI.registry.set(sub,children);
  const run=typeof item.run==='function'?String(++contextMenuUI.serial):'';
  if(run)contextMenuUI.registry.set(run,item.run);
  const data=Object.entries(item.data||{}).map(([key,value])=>`data-${esc(key)}="${esc(String(value))}"`).join(' ');
  const classes=['ctx-item',item.danger?'danger':'',item.primary?'primary':'',sub?'has-children':''].filter(Boolean).join(' ');
  const role=item.checked===undefined?'menuitem':'menuitemcheckbox';
  const disabled=item.disabled&&!sub;
  return `<button type="button" class="${classes}" role="${role}" ${item.checked===undefined?'':`aria-checked="${!!item.checked}"`} ${sub?`aria-haspopup="menu" aria-expanded="false" data-ctx-sub="${sub}"`:run?`data-ctx-run="${run}"`:`data-act="${esc(item.act||'')}"`} ${data} ${disabled?'disabled':''} ${item.title?`title="${esc(item.title)}"`:''}>${icon(item.icon||'more','sm')}<span class="ctx-text"><span>${esc(item.label)}</span>${item.hint?`<small>${esc(item.hint)}</small>`:''}</span>${item.checked?`<span class="ctx-check" aria-hidden="true">${icon('check','sm')}</span>`:''}${item.shortcut?`<kbd class="ctx-kbd">${esc(item.shortcut)}</kbd>`:''}${sub?icon('arrow','sm ctx-arrow'):''}</button>`;
}

function contextMenuPlace(layer,x,y,anchorRect=null){
  const width=layer.offsetWidth,height=layer.offsetHeight,margin=8;
  let left=x,top=y;
  if(anchorRect){
    left=anchorRect.right-4;top=anchorRect.top-6;
    if(left+width>innerWidth-margin)left=Math.max(margin,anchorRect.left-width+4);
  }
  left=Math.max(margin,Math.min(left,innerWidth-width-margin));
  top=Math.max(margin,Math.min(top,innerHeight-height-margin));
  layer.style.left=left+'px';layer.style.top=top+'px';
}

function contextMenuLayer(items,{depth,label,title,subtitle,x,y,anchorRect}){
  const layer=document.createElement('div');
  layer.className='ctx-menu'+(depth?' ctx-sub':' ctx-root');layer.setAttribute('role','menu');layer.setAttribute('aria-label',label||'上下文菜单');layer.dataset.depth=String(depth);
  if(depth===0)layer.id='mio-context-menu';
  layer.innerHTML=(title?`<div class="ctx-title"><strong>${esc(title)}</strong>${subtitle?`<small>${esc(subtitle)}</small>`:''}</div>`:'')+items.map(contextMenuItemHTML).join('');
  document.body.append(layer);
  contextMenuPlace(layer,x,y,anchorRect);
  contextMenuUI.layers.push(layer);
  return layer;
}

function contextMenuCloseDeeperThan(depth){
  while(contextMenuUI.layers.length>depth+1){const layer=contextMenuUI.layers.pop();const parent=contextMenuUI.layers.at(-1);parent?.querySelector('[aria-expanded="true"]')?.setAttribute('aria-expanded','false');layer.remove()}
}

function contextMenuOpenSub(button,focusFirst=false){
  const layer=button.closest('.ctx-menu');if(!layer)return null;
  const depth=Number(layer.dataset.depth||0);
  if(button.getAttribute('aria-expanded')==='true'){const existing=contextMenuUI.layers[depth+1];if(existing&&focusFirst)existing.querySelector('.ctx-item:not(:disabled)')?.focus({preventScroll:true});return existing||null}
  contextMenuCloseDeeperThan(depth);
  const items=contextMenuUI.registry.get(button.dataset.ctxSub);if(!items)return null;
  layer.querySelectorAll('[aria-expanded="true"]').forEach(el=>el.setAttribute('aria-expanded','false'));
  button.setAttribute('aria-expanded','true');
  const sub=contextMenuLayer(items,{depth:depth+1,label:button.querySelector('.ctx-text span')?.textContent||'子菜单',anchorRect:button.getBoundingClientRect(),x:0,y:0});
  if(focusFirst)sub.querySelector('.ctx-item:not(:disabled)')?.focus({preventScroll:true});
  return sub;
}

function contextMenuMoveFocus(layer,key){
  const items=[...layer.querySelectorAll('.ctx-item:not(:disabled)')];if(!items.length)return;
  const index=items.indexOf(document.activeElement);
  const next=key==='Home'?0:key==='End'?items.length-1:key==='ArrowDown'?(index+1)%items.length:(index-1+items.length)%items.length;
  items[next].focus({preventScroll:true});
}

function contextMenuHandleKey(event){
  if(!contextMenuOpen())return;
  const active=document.activeElement,layer=active?.closest?.('.ctx-menu')||contextMenuUI.layers.at(-1);
  if(event.key==='Escape'){event.preventDefault();event.stopImmediatePropagation();closeContextMenu(true);return}
  if(event.key==='Tab'){closeContextMenu();return}
  if(['ArrowDown','ArrowUp','Home','End'].includes(event.key)){event.preventDefault();event.stopImmediatePropagation();contextMenuMoveFocus(layer,event.key);return}
  if(event.key==='ArrowRight'){if(active?.matches?.('.ctx-item.has-children')){event.preventDefault();event.stopImmediatePropagation();contextMenuOpenSub(active,true)}return}
  if(event.key==='ArrowLeft'){const depth=Number(layer?.dataset.depth||0);if(depth>0){event.preventDefault();event.stopImmediatePropagation();const parent=contextMenuUI.layers[depth-1];contextMenuCloseDeeperThan(depth-1);parent?.querySelector('.ctx-item.has-children')?.focus({preventScroll:true})}}
}

function contextMenuInstall(){
  if(contextMenuUI.installed)return;contextMenuUI.installed=true;
  document.addEventListener('pointerdown',event=>{if(contextMenuOpen()&&!event.target.closest('.ctx-menu'))closeContextMenu()});
  document.addEventListener('keydown',contextMenuHandleKey,true);
  document.addEventListener('click',event=>{
    const button=event.target.closest('.ctx-menu .ctx-item');if(!button||button.disabled)return;
    if(button.dataset.ctxSub){event.preventDefault();event.stopPropagation();contextMenuOpenSub(button,true);return}
    if(button.dataset.ctxRun){
      event.preventDefault();event.stopPropagation();const run=contextMenuUI.registry.get(button.dataset.ctxRun);closeContextMenu();
      if(run)Promise.resolve().then(()=>run(button.dataset,button)).catch(error=>{toast(error.message||'操作未完成。','error')});
      return;
    }
    // data-act items are dispatched by the global click handler; close once that handler has seen the event.
    setTimeout(()=>closeContextMenu(),0);
  });
  document.addEventListener('pointerover',event=>{
    const button=event.target.closest('.ctx-menu .ctx-item');if(!button)return;
    clearTimeout(contextMenuUI.hoverTimer);
    const layer=button.closest('.ctx-menu'),depth=Number(layer.dataset.depth||0);
    contextMenuUI.hoverTimer=setTimeout(()=>{if(!button.isConnected)return;if(button.dataset.ctxSub)contextMenuOpenSub(button);else contextMenuCloseDeeperThan(depth)},button.dataset.ctxSub?90:260);
  });
  document.addEventListener('contextmenu',event=>{if(event.target.closest('.ctx-menu'))event.preventDefault()});
  window.addEventListener('resize',()=>closeContextMenu());
  window.addEventListener('blur',()=>closeContextMenu());
  for(const type of ['wheel','touchmove'])document.addEventListener(type,event=>{if(contextMenuOpen()&&!event.target.closest?.('.ctx-menu'))closeContextMenu()},{passive:true});
  // Scroll events that were already queued when the menu opened (scroll-into-view, layout settling) must not close it.
  document.addEventListener('scroll',event=>{if(contextMenuOpen()&&performance.now()-contextMenuUI.openedAt>250&&!(event.target instanceof Element&&event.target.closest('.ctx-menu')))closeContextMenu()},true);
}

/* openContextMenu({x, y, title, subtitle, label, items, focusEl, onClose})
   item: {label, icon, act, data, run, shortcut, hint, disabled, danger, checked, children:[...]} | '-' | {type:'label', label} */
function openContextMenu({x=0,y=0,title='',subtitle='',label='上下文菜单',items=[],focusEl=null,onClose=null}={}){
  contextMenuInstall();
  closeContextMenu();
  const list=contextMenuNormalize(items);
  if(!list.some(item=>item.type!=='separator'&&item.type!=='label'))return null;
  contextMenuUI.focusEl=focusEl||(document.activeElement instanceof HTMLElement?document.activeElement:null);
  contextMenuUI.onClose=onClose;
  document.documentElement.classList.add('has-context-menu');
  contextMenuUI.openedAt=performance.now();
  const layer=contextMenuLayer(list,{depth:0,label,title,subtitle,x,y});
  layer.querySelector('.ctx-item:not(:disabled)')?.focus({preventScroll:true});
  return layer;
}

/* Extension entries registered on the platform 'context-menu' slot, expressed as menu items. */
function contextMenuExtensionItems(kind,context){
  if(typeof MioPlatform==='undefined')return [];
  const items=MioPlatform.items('context-menu',{kind,...context}).filter(item=>!item.kinds||item.kinds.includes(kind));
  return items.map(item=>({label:item.label,icon:item.icon||'box',act:'mio-context-item',data:{key:item.key,...(context.id?{id:context.id}:{}),...(Number.isInteger(context.index)?{index:context.index}:{})}}));
}
