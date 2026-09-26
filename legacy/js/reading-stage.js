/* Shared, non-destructive reader geometry. This exact runtime also runs in offline HTML. */
'use strict';
function readingStageRuntime(root,options={}){
  const native=!!options.native,win=root.ownerDocument.defaultView,doc=root.ownerDocument;
  const lists=[...root.querySelectorAll(native?'.room-scroll':'[data-cc-pages]')];
  if(!lists.length)return null;
  const entries=lists.map(list=>({list,book:list.closest('[data-cc-book]'),items:[...list.querySelectorAll(native?'[data-scroll-step]':'[data-cc-frame]')]}));
  const items=entries.flatMap(e=>e.items),original=new Map(),groups=[];
  let mode=options.mode||'auto',active=false,raf=0,disposed=false,current=0,layoutKey='',observer;
  const media=win.matchMedia('(min-width: 900px) and (min-height: 480px)'),reduced=win.matchMedia('(prefers-reduced-motion: reduce)');
  const scroller=native?root:doc.documentElement;
  const styleElements=items.flatMap(p=>[p,p.querySelector('.room-page'),p.querySelector('img')]).filter(Boolean);
  styleElements.forEach(el=>original.set(el,el.getAttribute('style')));
  function dimensions(p){const img=p.querySelector('img');return {img,w:img?.naturalWidth||Number(img?.getAttribute('width'))||0,h:img?.naturalHeight||Number(img?.getAttribute('height'))||0}}
  function position(){const rect=native?root.getBoundingClientRect():{top:0};let index=Math.max(0,items.length-1),best=Infinity;const nodes=active&&groups.length?groups:items;nodes.forEach((p,i)=>{const r=p.getBoundingClientRect();if(r.bottom<=rect.top+1)return;const d=Math.abs(r.top-rect.top);if(d<best){best=d;index=active?items.indexOf(p.querySelector('.mio-stage-item')):i}});return index}
  function scrollToItem(i,smooth=false){const p=items[Math.max(0,Math.min(items.length-1,i))];if(!p)return;current=items.indexOf(p);const target=active?p.closest('.mio-reading-stage'):p;if(active)current=items.indexOf(target.querySelector('.mio-stage-item'));const top=target.getBoundingClientRect().top-(native?root.getBoundingClientRect().top:0)+(native?root.scrollTop:win.scrollY);(native?root:win).scrollTo({top,behavior:smooth&&!reduced.matches?'smooth':'instant'});options.onPage?.(current,active?target.querySelectorAll('.mio-stage-item').length:1)}
  function restore(){observer?.disconnect();for(const {list,items:pages,book} of entries){const anchor=list.querySelector('.mio-reading-stage');for(const p of pages){p.classList.remove('mio-stage-item');if(anchor)list.insertBefore(p,anchor)}for(const g of list.querySelectorAll('.mio-reading-stage'))g.remove();list.classList.remove('mio-stage-pages');book?.classList.remove('mio-stage-book')}for(const [el,style] of original){if(style===null)el.removeAttribute('style');else el.setAttribute('style',style)}groups.length=0;root.classList.remove('mio-stage-root');scroller.classList.remove('mio-stage-scroll');root.querySelectorAll('.mio-stage-ending').forEach(e=>e.classList.remove('mio-stage-ending'))}
  function build(){
    raf=0;if(disposed||!root.isConnected)return;
    const W=native?root.clientWidth:win.innerWidth,H=native?root.clientHeight:win.innerHeight;
    if(!W||!H)return;
    const enabled=media.matches&&mode!=='continuous';
    const key=[W,H,enabled,mode,...items.map(p=>{const d=dimensions(p);return d.w+'x'+d.h})].join('|');if(key===layoutKey)return;
    const anchor=layoutKey?position():options.index||0;layoutKey=key;restore();active=enabled;
    if(!active){scrollToItem(anchor);options.onLayout?.(false);return}
    root.classList.add('mio-stage-root');scroller.classList.add('mio-stage-scroll');root.style.setProperty('--mio-stage-height',H+'px');
    const pad=16,bottom=native?16:64,space=16,usable=W-pad*2;
    observer=new IntersectionObserver(changes=>{for(const c of changes){if(!c.isIntersecting){c.target.style.removeProperty('--mio-stage-backdrop');continue}const src=c.target.querySelector('img')?.currentSrc||c.target.querySelector('img')?.src;if(src&&/^(data:image\/|blob:|https?:|file:|\/images\/)/.test(src))c.target.style.setProperty('--mio-stage-backdrop','url('+JSON.stringify(src)+')')}},{root:native?root:null,rootMargin:'100% 0px'});
    for(const {list,items:pages,book} of entries){
      list.classList.add('mio-stage-pages');book?.classList.add('mio-stage-book');
      for(let i=0;i<pages.length;){
        const first=dimensions(pages[i]),second=pages[i+1]&&dimensions(pages[i+1]);
        const portrait=d=>d&&d.w>0&&d.h>0&&d.w/d.h<=.88&&Math.min(d.h,H-pad-bottom)>=H*.5;
        const pair=mode==='auto'&&usable>=760&&portrait(first)&&portrait(second);
        const count=pair?2:1,g=doc.createElement('section');g.className='mio-reading-stage';g.dataset.count=String(count);g.setAttribute('aria-label','第 '+(items.indexOf(pages[i])+1)+(pair?'–'+(items.indexOf(pages[i])+2):'')+' 幕');list.insertBefore(g,pages[i]);
        for(let j=0;j<count;j++){
          const p=pages[i++],d=dimensions(p),caption=!![...p.querySelectorAll('.scroll-caption,figcaption,pre,details')].find(el=>el.textContent.trim()&&getComputedStyle(el).display!=='none');
          const maxH=Math.max(100,H-pad-bottom-(caption?80:0)),maxW=(usable-space*(count-1))/count;
          const scale=d.w&&d.h?Math.min(1,maxW/d.w,maxH/d.h):1,w=d.w?d.w*scale:maxW,h=d.h?d.h*scale:maxH;
          p.classList.add('mio-stage-item');p.style.setProperty('--mio-image-width',w+'px');p.style.setProperty('--mio-image-height',h+'px');g.append(p);
        }
        groups.push(g);observer.observe(g);
      }
    }
    root.querySelectorAll('[data-mio-colophon]').forEach(el=>el.classList.add('mio-stage-ending'));
    scrollToItem(anchor);options.onLayout?.(true);
  }
  function schedule(){if(!raf)raf=win.requestAnimationFrame(build)}
  function onScroll(){if(!active)return;const i=position();if(i!==current){current=i;const g=items[i]?.closest('.mio-reading-stage');options.onPage?.(i,g?.querySelectorAll('.mio-stage-item').length||1)}}
  function turn(direction){if(!active)return false;const g=items[current]?.closest('.mio-reading-stage'),index=groups.indexOf(g),next=groups[Math.max(0,Math.min(groups.length-1,index+direction))];if(next)scrollToItem(items.indexOf(next.querySelector('.mio-stage-item')),true);return true}
  const resize=new ResizeObserver(schedule);resize.observe(native?root:doc.documentElement);
  root.addEventListener('load',schedule,true);(native?root:win).addEventListener('scroll',onScroll,{passive:true});media.addEventListener('change',schedule);win.addEventListener('resize',schedule);
  let controls;
  if(!native){controls=doc.createElement('nav');controls.className='mio-reading-controls';controls.setAttribute('aria-label','阅读方式');controls.innerHTML='<button type="button" data-reading-mode="auto">自适应</button><button type="button" data-reading-mode="single">单页</button><button type="button" data-reading-mode="continuous">连续</button>';doc.body.append(controls);controls.addEventListener('click',e=>{if(e.target.dataset.readingMode)setMode(e.target.dataset.readingMode)});win.addEventListener('message',e=>{if(e.source===win.parent&&e.data?.type==='mio-reader-turn')turn(e.data.direction>0?1:-1)});doc.addEventListener('keydown',e=>{if(e.target.closest('input,textarea,select,button,a,[contenteditable]'))return;if(['ArrowRight','ArrowLeft','PageDown','PageUp'].includes(e.key)&&turn(['ArrowRight','PageDown'].includes(e.key)?1:-1)){e.preventDefault();e.stopImmediatePropagation()}},true)}
  function setMode(value){mode=['auto','single','continuous'].includes(value)?value:'auto';controls?.querySelectorAll('button').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.readingMode===mode)));if(!native&&win.parent!==win)win.parent.postMessage({type:'mio-reading-mode',mode},'*');schedule()}
  setMode(mode);schedule();
  return {get active(){return active},get mode(){return mode},range(){const g=items[current]?.closest('.mio-reading-stage');return active&&g?{index:items.indexOf(g.querySelector('.mio-stage-item')),count:g.querySelectorAll('.mio-stage-item').length}:null},setMode,go:scrollToItem,turn,dispose(){disposed=true;win.cancelAnimationFrame(raf);observer?.disconnect();resize.disconnect();root.removeEventListener('load',schedule,true);(native?root:win).removeEventListener('scroll',onScroll);media.removeEventListener('change',schedule);win.removeEventListener('resize',schedule);restore()}};
}
function installReadingStage(){
  window.addEventListener('message',e=>{if(e.source!==$('#presentation-preview')?.contentWindow||e.data?.type!=='mio-reading-mode'||!['auto','single','continuous'].includes(e.data.mode))return;const b=bookBy(ui.bookId);if(b&&(b.readingMode||'auto')!==e.data.mode){b.readingMode=e.data.mode;save()}});
  const oldSync=syncArtReader;syncArtReader=function(...args){oldSync(...args);const range=artUI.readingStage?.range();if(range&&$('#page-position'))$('#page-position').textContent=pad(range.index+1)+(range.count>1?'–'+pad(range.index+range.count):'')+' / '+pad(bookBy(ui.bookId).totalSteps)};
  const oldCanvas=renderArtCanvas;renderArtCanvas=function(...args){artUI.readingStage?.dispose();artUI.readingStage=null;oldCanvas(...args);if(presentationUI.templateId!=='mio-fit'||artUI.readerMode!=='webtoon'||presentationUI.exportPreview)return;const mode=bookBy(ui.bookId)?.readingMode||'auto';artUI.readingStage=readingStageRuntime($('#reader-canvas'),{native:true,mode,index:ui.step,onPage:(index,count)=>{ui.step=index;syncArtReader();if(count>1&&$('#page-position'))$('#page-position').textContent=pad(index+1)+'–'+pad(index+count)+' / '+pad(bookBy(ui.bookId).totalSteps)},onLayout:enabled=>{if(enabled)artUI.readerObserver?.disconnect();else $$('#reader-canvas [data-scroll-step]').forEach(el=>artUI.readerObserver?.observe(el))}})};
  const oldReader=renderArtReader;renderArtReader=function(...args){oldReader(...args);if(presentationUI.templateId!=='mio-fit'||artUI.readerMode!=='webtoon'||presentationUI.exportPreview)return;const spot=$('#reader .room-footer>span');if(spot){spot.className='native-reading-controls';spot.innerHTML=[['auto','自适应'],['single','单页'],['continuous','连续']].map(([id,name])=>`<button type="button" data-act="reading-mode" data-mode="${id}" aria-pressed="${(bookBy(ui.bookId).readingMode||'auto')===id}">${name}</button>`).join('')}};
  const oldScroll=scrollRoomTo;scrollRoomTo=function(index,smooth=true){if(artUI.readingStage?.active)return artUI.readingStage.go(index,smooth);return oldScroll(index,smooth)};
  const oldAction=handleAction;handleAction=async function(action,d,...args){if(action==='reading-mode'){bookBy(ui.bookId).readingMode=d.mode;artUI.readingStage?.setMode(d.mode);for(const el of $$('#reader [data-act="reading-mode"]'))el.setAttribute('aria-pressed',String(el.dataset.mode===d.mode));save();return}if(['page-prev','page-next'].includes(action)&&artUI.readingStage?.turn(action==='page-next'?1:-1))return;return oldAction(action,d,...args)};
  const oldCompile=compileTemplateDocument;compileTemplateDocument=function(t,books,options={}){let html=oldCompile(t,books,options);if(t.layout==='flip'||(!['mio-fit','export-seamless'].includes(t.id)&&!t.readingStage))return html;const doc=new DOMParser().parseFromString(html,'text/html'),style=doc.createElement('style'),script=doc.createElement('script');style.textContent=MioContent.readingCSS;doc.head.append(style);script.setAttribute('nonce',doc.querySelector('script[nonce]')?.getAttribute('nonce'));script.textContent='('+readingStageRuntime.toString()+')(document.body,'+JSON.stringify({mode:books.length===1?books[0].readingMode||'auto':'auto'}).replace(/</g,'\\u003c')+');';doc.body.append(script);return '<!DOCTYPE html>\n'+doc.documentElement.outerHTML};
  $('#reader').addEventListener('close',()=>{artUI.readingStage?.dispose();artUI.readingStage=null});
}
