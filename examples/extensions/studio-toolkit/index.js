/* This example uses only documented SDK 2 APIs; no private application globals. */
export default function setup(ctx) {
  ctx.styles.add('[data-extension-owner="studio-toolkit"] .toolkit-note { padding:16px;border:1px solid var(--line);border-radius:12px;line-height:1.8 }');
  ctx.commands.register({id:'open',label:'打开创作工具箱',shortcut:'mod+shift+y',toolbar:true,run:()=>ctx.workspaces.open('desk')});
  ctx.commands.register({id:'count',label:'统计当前企划分镜',run:()=>{
    const stories=ctx.app.getStories();ctx.toast(`${stories.length} 份分镜，${stories.reduce((n,s)=>n+s.frames.length,0)} 幕。`);
  }});
  ctx.slots.register({id:'hint',slot:'workspace.after',when:({workspace})=>workspace==='creation',render(root){
    const note=document.createElement('p');note.className='toolkit-note';note.textContent='工具箱提示：扩展可以为工作区添加控件，而不必修改主程序。按 Ctrl / ⌘ + Shift + Y 打开笔记。';root.append(note);
  }});
  ctx.workspaces.register({id:'desk',title:'创作工具箱',async render(root,{mountSignal}){
    const heading=document.createElement('h2');heading.textContent='你的创作便签';
    const help=document.createElement('p');help.textContent='这是扩展提供的独立工作区。笔记保存在本机，停用扩展不会删除。';
    const label=document.createElement('label');label.textContent='便签内容';
    const text=document.createElement('textarea');text.setAttribute('aria-label','创作便签');text.style.minHeight='220px';label.append(text);
    const save=document.createElement('button');save.className='btn primary';save.textContent='保存便签';save.disabled=true;
    const status=document.createElement('p');status.setAttribute('role','status');
    root.append(heading,help,label,save,status);
    try{const value=await ctx.storage.get('note');if(mountSignal.aborted)return;text.value=value||'';save.disabled=false}catch(e){status.textContent=e.message}
    save.addEventListener('click',async()=>{save.disabled=true;try{await ctx.storage.set('note',text.value);if(!mountSignal.aborted)status.textContent='已保存到本机。'}catch(e){status.textContent=e.message}finally{save.disabled=false}},{signal:mountSignal});
  }});
  // Throws / cancellation in this before-hook stops the HTTP request, never retries it.
  ctx.on('production:beforeRequest',event=>{
    if(!['assemble','assemble-batch'].includes(event.route))return;
    const items=event.route==='assemble-batch'?event.body.items:[event.body];
    for(const item of items)if(typeof item.title==='string')item.title=item.title.trim();
  });
  ctx.on('workspace:changed',({workspace})=>console.debug('[studio-toolkit] workspace:',workspace));
}
