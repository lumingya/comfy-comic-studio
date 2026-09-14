/* Load file-backed content before the classic application's shared lexical state is initialized. */
'use strict';
(async()=>{
  const source=document.currentScript.dataset.app;
  try{
    const [response,readingCSS]=await Promise.all([fetch('/api/content',{credentials:'same-origin',cache:'no-store'}),fetch('/js/reading-stage.css',{credentials:'same-origin'})]);
    if(!readingCSS.ok)throw Error('缺少阅读器样式，请使用完整程序包。');
    if(!response.ok)throw Error((await response.json()).error||'HTTP '+response.status);
    globalThis.MioContent=await response.json();
    globalThis.MioContent.readingCSS=await readingCSS.text();
    const script=document.createElement('script');script.src=source;script.onerror=()=>failure('无法加载应用程序。');document.body.append(script);
  }catch(e){failure(e.message)}
  function failure(message){const box=document.createElement('div');box.style.cssText='padding:32px;white-space:pre-wrap;color:#b96555';box.textContent='Mio 启动失败：'+message+'\n请使用完整源码包（包括 data/）启动 Python 服务。未替换或重置您的数据。';document.body.append(box)}
})();
