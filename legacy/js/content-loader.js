/* Bootstrap private API access and recoverable, non-destructive startup. */
'use strict';
(()=>{
  const source=document.currentScript.dataset.app;
  const originalFetch=globalThis.fetch.bind(globalThis);
  const token=document.querySelector('meta[name="mio-csrf"]')?.content;
  globalThis.fetch=function(input,options={}){
    const url=new URL(typeof input==='string'||input instanceof URL?input:input.url,location.href);
    if(token&&url.origin===location.origin&&url.pathname.startsWith('/api/')&&!url.pathname.startsWith('/api/v1/')){
      const headers=new Headers(options.headers||(input instanceof Request?input.headers:undefined));
      headers.set('X-Mio-CSRF',token);options={...options,headers};
    }
    return originalFetch(input,options);
  };
  let loading=false,started=false,box;
  async function load(){
    if(loading||started)return;loading=true;box?.remove();
    try{
      const [response,readingCSS]=await Promise.all([fetch('/api/content',{credentials:'same-origin',cache:'no-store'}),fetch('/js/reading-stage.css',{credentials:'same-origin'})]);
      if(!readingCSS.ok)throw Error('缺少阅读器样式，请使用完整程序包。');
      if(!response.ok)throw Error((await response.json()).error||'HTTP '+response.status);
      globalThis.MioContent=await response.json();globalThis.MioContent.readingCSS=await readingCSS.text();
      const script=document.createElement('script');script.src=source;script.async=false;script.onerror=()=>{started=false;script.remove();failure('无法加载应用程序。')};
      started=true;document.body.append(script);
    }catch(e){failure(e.message)}finally{loading=false}
  }
  function failure(message){
    box?.remove();box=document.createElement('section');box.className='bootstrap-error';box.setAttribute('role','alert');
    const title=document.createElement('h1');title.textContent='Mio 暂时未能启动';
    const help=document.createElement('p');help.textContent='MIO-BOOT-001 · 未替换或重置您的数据。请检查服务日志与完整程序包。';
    const retry=document.createElement('button');retry.type='button';retry.className='btn primary';retry.textContent='重试加载';retry.onclick=load;
    const details=document.createElement('details'),summary=document.createElement('summary'),pre=document.createElement('pre');
    summary.textContent='打开诊断与启动命令';pre.textContent=message+'\n\n在项目目录运行：\npython tools/check_distribution.py\npython server.py\n\n完整诊断来自服务器终端。';details.append(summary,pre);
    const link=document.createElement('a');link.href='/docs/SECURITY.md';link.textContent='查看运行与安全说明';box.append(title,help,retry,details,link);document.body.append(box);
  }
  void load();
})();
