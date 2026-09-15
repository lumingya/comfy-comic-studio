export default async function setup(ctx){
  ctx.variables.registerType('palette',{label:'场记本 · 配色词',normalize:value=>String(value||'').split(',').map(s=>s.trim()).filter(Boolean).join(', ')});
  ctx.toolbar.register({id:'note',label:'记一笔',icon:'edit',run:async()=>{const title=ctx.getAlbum()?.title||'未命名画册';await ctx.api('/notes',{title,text:'一次新的创作记录',createdAt:Date.now()});ctx.toast('已记录到独立的扩展数据目录。')}});
  ctx.panels.register({id:'notebook',title:'场记本',render:async root=>{const notes=await ctx.api('/notes');const list=document.createElement('div');for(const note of notes){const row=document.createElement('p');row.textContent=note.title+' · '+note.text;list.append(row)}if(!notes.length)list.textContent='还没有记录，点击工具栏的“记一笔”开始。';root.append(list)}});
  return ()=>{}; // SDK removes registered actions, panels, types and hooks on disable.
}
