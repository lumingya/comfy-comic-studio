/* One selection model for every desktop asset surface (shelf, frame rail, workflow library, mapping rows, designer presets).
   Rules follow the file-manager / ComfyUI canvas convention, with a single entry point:
     · plain click      → opens / switches the item through its own handler; any multi-selection dissolves first
     · Ctrl / ⌘ + click → toggles the item in the selection
     · Shift + click    → selects the range from the last anchor
     · drag (marquee)   → selects everything the rectangle touches (Ctrl adds, Shift keeps)
     · right-click      → an item outside the selection becomes the sole target; a selected item opens the multi-select menu
     · Ctrl / ⌘ + A, Escape, Delete, Enter → select all, clear, delete the selection, open the single selected item
   There is no mode switch, no toolbar, no checkboxes: the selection itself *is* the mode, and the context menu carries the actions. */
'use strict';
function installDesktopSelection() {
  const scopes = [
    {root:'#gallery-results', item:'[data-sort-book]', key:e=>e.dataset.sortBook,
      get:()=>ui.selected, set:s=>{ui.selected=s;ui.bulk=s.size>0;if(!s.size)ui.bulkPinned=false}, render:()=>refreshGallery(),
      open:e=>handleAction('read',{id:e.dataset.sortBook}), remove:ids=>handleAction('org-context-delete',{ids:JSON.stringify(ids)})},
    {root:'.designer-presets', item:'.designer-preset', key:e=>e.querySelector('input').dataset.designerPreset,
      get:()=>assemblyDesign.presets, set:s=>{assemblyDesign.presets=s}, render:()=>{const e=document.querySelector('#designer-presets-status');if(e)e.textContent=designerPresetsStatus()}},
    {root:'.workshop-frames-list', item:'button[data-index]', key:e=>Number(e.dataset.index),
      get:()=>workshop.pickedFrames, set:s=>{workshop.pickedFrames=s}, render:()=>render(), open:e=>e.click(),
      remove:()=>handleAction('workshop-frame-delete-bulk',{})},
    {root:'#wf-rail-list', item:'[data-workflow-id]', key:e=>e.dataset.workflowId,
      get:()=>mapperUI.libSel, set:s=>{mapperUI.libSel=s}, render:()=>render(), open:e=>e.querySelector('.wf-item-body')?.click(),
      remove:()=>handleAction('ws-lib-delete-bulk',{})},
    {root:'#wm-binding-rows', item:'[data-binding-row]', key:e=>e.dataset.bindingRow,
      get:()=>mapperUI.sel, set:s=>{mapperUI.sel=s}, render:()=>render(), open:e=>e.querySelector('.wf-row-main')?.click(),
      remove:()=>handleAction('wm-delete-bulk',{})}
  ];
  const OPENERS='.wf-item-body,.wf-row-main,[data-act="read"],[data-select-book],[data-designer-preset]';
  let gesture=null, active=null, suppress=false, raf=0;
  const anchors=new Map();
  const editable=e=>e.closest('textarea,select,[contenteditable="true"],input:not([type="checkbox"])');
  const coarse=()=>typeof matchMedia==='function'&&matchMedia('(pointer:coarse)').matches;
  function locate(target) {
    if(!(target instanceof Element))return null;
    for(const s of scopes){const root=target.closest(s.root);if(root)return {s,root,item:target.closest(s.item)}}
    return null;
  }
  function items(c){return [...c.root.querySelectorAll(c.s.item)].filter(e=>e.getClientRects().length)}
  function paint(c){
    const sel=c.s.get();
    for(const e of items(c)){
      const on=sel.has(c.s.key(e));
      e.classList.toggle('desktop-selected',on);e.classList.toggle('is-picked',on);
      if(c.s.root==='.designer-presets'){e.classList.toggle('selected',on);const cb=e.querySelector('input[type="checkbox"]');if(cb)cb.checked=on}
      if(c.s.root==='#gallery-results'){e.classList.toggle('is-selected',on);e.setAttribute('aria-selected',String(on));const cb=e.querySelector('[data-select-book]');if(cb)cb.checked=on}
    }
    c.root.classList.toggle('has-selection',sel.size>0);
  }
  function commit(c){c.s.render();const root=document.querySelector(c.s.root);if(root){active={...c,root};if(c.s.get().size){root.tabIndex=0;root.focus({preventScroll:true})}paint({...c,root})}}
  function rectHits(a,b){return a.left<b.right&&a.right>b.left&&a.top<b.bottom&&a.bottom>b.top}
  function scrollParent(el){for(let p=el;p;p=p.parentElement){if(p.scrollHeight>p.clientHeight+2&&/(auto|scroll)/.test(getComputedStyle(p).overflowY))return p}return document.scrollingElement}
  function update(){
    const g=gesture;if(!g?.drag)return;
    const host=g.scroll, bounds=host===document.scrollingElement?{top:0,bottom:innerHeight}:host.getBoundingClientRect();
    const speed=g.y<bounds.top+36?-Math.ceil((bounds.top+36-g.y)/4):g.y>bounds.bottom-36?Math.ceil((g.y-bounds.bottom+36)/4):0;
    host.scrollTop+=Math.max(-22,Math.min(22,speed));
    const originY=g.startY-(host.scrollTop-g.scrollY), originX=g.startX-(host.scrollLeft-g.scrollX);
    const r={left:Math.min(originX,g.x),right:Math.max(originX,g.x),top:Math.min(originY,g.y),bottom:Math.max(originY,g.y)};
    const clip=g.c.root.getBoundingClientRect();
    const visible={left:Math.max(r.left,clip.left),right:Math.min(r.right,clip.right),top:Math.max(r.top,clip.top,bounds.top),bottom:Math.min(r.bottom,clip.bottom,bounds.bottom)};
    Object.assign(g.box.style,{left:visible.left+'px',top:visible.top+'px',width:Math.max(0,visible.right-visible.left)+'px',height:Math.max(0,visible.bottom-visible.top)+'px'});
    const next=new Set(g.add?g.before:[]);
    for(const el of items(g.c)){if(rectHits(r,el.getBoundingClientRect())){const id=g.c.s.key(el);if(g.toggle&&g.before.has(id))next.delete(id);else next.add(id)}}
    g.c.s.set(next);paint(g.c);raf=requestAnimationFrame(update);
  }
  function stop(cancel=false){const g=gesture;if(!g)return;gesture=null;cancelAnimationFrame(raf);g.box?.remove();document.body.classList.remove('desktop-selecting');if(cancel)g.c.s.set(g.before);if(g.drag){suppress=true;commit(g.c)}}
  function clearSelection(c,rerender=true){if(!c.s.get().size)return;c.s.set(new Set());paint(c);if(rerender)commit(c)}

  window.addEventListener('pointerdown',e=>{
    suppress=false;if(e.button!==0||e.pointerType==='touch'||editable(e.target))return;
    const c=locate(e.target);if(!c)return;
    // Shelf cards reorder by dragging while nothing is selected; the marquee takes over once a selection exists (or with a modifier).
    if(c.s.root==='#gallery-results'&&c.item&&!c.s.get().size&&!e.ctrlKey&&!e.metaKey&&!e.shiftKey)return;
    const control=e.target.closest('button,input,a,[data-act]');
    if(control&&!c.item)return;
    if(control&&control!==c.item&&!control.matches(OPENERS))return;
    active=c;const scroll=scrollParent(c.root);
    gesture={c,startX:e.clientX,startY:e.clientY,x:e.clientX,y:e.clientY,scroll,scrollX:scroll.scrollLeft,scrollY:scroll.scrollTop,before:new Set(c.s.get()),add:e.ctrlKey||e.metaKey||e.shiftKey,toggle:e.ctrlKey||e.metaKey,drag:false};
  },true);
  window.addEventListener('pointermove',e=>{
    const g=gesture;if(!g)return;g.x=e.clientX;g.y=e.clientY;
    if(!g.drag&&Math.hypot(g.x-g.startX,g.y-g.startY)>5){g.drag=true;g.box=document.createElement('div');g.box.className='desktop-marquee';(g.c.root.closest('dialog')||document.body).append(g.box);document.body.classList.add('desktop-selecting');if(typeof closeContextMenu==='function')closeContextMenu();update()}
    if(g.drag){e.preventDefault();e.stopImmediatePropagation()}
  },true);
  window.addEventListener('pointerup',()=>stop(),true);
  window.addEventListener('pointercancel',()=>stop(true),true);
  window.addEventListener('blur',()=>stop(true));
  window.addEventListener('dragstart',e=>{if(gesture){e.preventDefault();e.stopImmediatePropagation()}},true);

  window.addEventListener('click',e=>{
    if(suppress){suppress=false;e.preventDefault();e.stopImmediatePropagation();return}
    const c=locate(e.target);if(!c||editable(e.target))return;
    // Touch and keyboard activation keep their native behaviour (visible checkboxes, Enter on buttons).
    if(e.pointerType==='touch'||e.detail===0)return;
    const control=e.target.closest('button,input,a,[data-act]');
    if(control&&!c.item)return;
    if(control&&control!==c.item&&!control.matches(OPENERS))return;
    active=c;
    const id=c.item?c.s.key(c.item):null, mods=e.ctrlKey||e.metaKey||e.shiftKey;
    if(!mods&&c.s.open){
      // Plain click: the item opens through its own handler. The selection dissolves first so the handler sees a normal shelf.
      if(id!==null)anchors.set(c.s,id);
      if(c.s.get().size){c.s.set(new Set());paint(c);if(id===null)commit(c)}
      return;
    }
    e.preventDefault();e.stopImmediatePropagation();
    const before=c.s.get(), toggle=e.ctrlKey||e.metaKey||control?.matches('input[type="checkbox"]');
    let next=new Set(toggle?before:[]);
    if(id!==null){const all=items(c).map(c.s.key),anchor=anchors.get(c.s);
      if(e.shiftKey&&all.includes(anchor)){if(e.ctrlKey||e.metaKey)next=new Set(before);const a=all.indexOf(anchor),b=all.indexOf(id);all.slice(Math.min(a,b),Math.max(a,b)+1).forEach(k=>next.add(k))}
      else{if(toggle&&before.has(id))next.delete(id);else next.add(id);anchors.set(c.s,id)}
    }
    c.s.set(next);paint(c);commit(c);queueMicrotask(()=>{const root=document.querySelector(c.s.root);if(root)paint({...c,root})});
  },true);

  /* Right-click follows the desktop convention: an item outside the selection becomes the only target (the multi-select
     menu is reserved for items that are part of it). Ctrl / ⌘ keeps the selection so the menu can extend it. */
  window.addEventListener('contextmenu',e=>{
    if(e.ctrlKey||e.metaKey)return;
    const c=locate(e.target);if(!c||editable(e.target))return;
    if(c.item&&!c.s.get().has(c.s.key(c.item)))clearSelection(c,false);
    if(c.item)anchors.set(c.s,c.s.key(c.item));
  },true);

  window.addEventListener('keydown',e=>{
    if(editable(e.target)||e.isComposing)return;
    const c=locate(e.target)||active;if(!c||!c.root.isConnected)return;
    const dialog=document.querySelector('dialog[open]');if(dialog&&!dialog.contains(c.root))return;
    if(typeof contextMenuOpen==='function'&&contextMenuOpen())return;
    if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='a'){e.preventDefault();e.stopImmediatePropagation();c.s.set(new Set(items(c).map(c.s.key)));commit(c)}
    if(e.key==='Escape'&&(c.s.get().size||gesture)){e.preventDefault();e.stopImmediatePropagation();stop(true);c.s.set(new Set());commit(c)}
    if(e.key==='Delete'&&c.s.get().size&&c.s.remove&&!e.altKey&&!e.ctrlKey&&!e.metaKey){e.preventDefault();e.stopImmediatePropagation();const ids=[...c.s.get()];Promise.resolve(c.s.remove(ids)).catch(error=>{if(typeof toast==='function')toast(error.message||'操作未完成。','error')})}
    if(e.key==='Enter'){
      const focusedBtn=document.activeElement?.closest?.('button,[data-act]');
      if(focusedBtn&&c.root.contains(focusedBtn))return;
      if(c.s.get().size===1&&c.s.open){const el=items(c).find(x=>c.s.get().has(c.s.key(x)));if(el){e.preventDefault();c.s.set(new Set());paint(c);c.s.open(el)}}
    }
  },true);

  /* Small public surface for the context menus: repaint after a silent state change, or clear a scope. */
  window.desktopSelection={
    clear(rootSelector,rerender=true){const root=document.querySelector(rootSelector);const s=scopes.find(x=>x.root===rootSelector);if(!root||!s)return;clearSelection({s,root,item:null},rerender)},
    repaint(rootSelector){const root=document.querySelector(rootSelector);const s=scopes.find(x=>x.root===rootSelector);if(root&&s)paint({s,root,item:null})},
    isTouch:coarse
  };
}

if(typeof window!=='undefined')installDesktopSelection();
