import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

type Series = { id: string; title: string; subtitle: string; status: 'draft' | 'active' | 'archived'; bible: Bible };
type Bible = { characters: { id: string; name: string; appearance: string[] }[]; locations: { id: string; name: string }[]; styles: { id: string; name: string }[] };
type Episode = { id: string; series_id: string; title: string; panels: Panel[] };
type Panel = { id: string; order: number; shot: string; description: string; dialogues: { text: string; kind: string }[]; aspect_ratio: string };
type StripExport = { width: number; height: number; slices: { index: number; y: number; height: number }[]; panels: Record<string, [number, number, number, number]> };

const tabs = ['作品', '设定集', '剧本', '出图板', '条漫画布', '阅读导出', '回收站'] as const;
type Tab = (typeof tabs)[number];

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  if (!response.ok) throw new Error(await response.text());
  if (response.status === 204) return undefined as T;
  const type = response.headers.get('content-type') || '';
  return (type.includes('json') ? response.json() : response.blob()) as T;
}

export function App() {
  const qc = useQueryClient();
  const [tab, setTab] = useState<Tab>('作品');
  const [idea, setIdea] = useState('雨夜相遇，旧书店重逢，未完成的画稿重新发光');
  const series = useQuery({ queryKey: ['series'], queryFn: () => api<Series[]>('/api/series') });
  const current = series.data?.[0];
  const episodes = useQuery({ queryKey: ['episodes', current?.id], queryFn: () => api<Episode[]>(`/api/series/${current!.id}/episodes`), enabled: !!current });
  const episode = episodes.data?.[0];
  const strip = useQuery({ queryKey: ['strip', episode?.id], queryFn: () => api<StripExport>(`/api/episodes/${episode!.id}/export/strip`), enabled: !!episode });
  const trash = useQuery({ queryKey: ['trash'], queryFn: () => api<Series[]>('/api/trash/series') });

  const createSeries = useMutation({ mutationFn: () => api<Series>('/api/series', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: '新的条漫作品' }) }), onSuccess: () => qc.invalidateQueries({ queryKey: ['series'] }) });
  const makeScript = useMutation({ mutationFn: () => api('/api/series/' + current!.id + '/assistant/script', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ idea, panel_count: 12 }) }), onSuccess: () => qc.invalidateQueries({ queryKey: ['episodes', current?.id] }) });
  const deleteSeries = useMutation({ mutationFn: (id: string) => api(`/api/series/${id}`, { method: 'DELETE' }), onSuccess: () => { qc.invalidateQueries({ queryKey: ['series'] }); qc.invalidateQueries({ queryKey: ['trash'] }); } });

  const orderedPanels = useMemo(() => [...(episode?.panels || [])].sort((a, b) => a.order - b.order), [episode]);

  return <main className="shell">
    <header className="hero"><p className="eyebrow">Mio v3 · 条漫工作室</p><h1>从作品设定到一话条漫</h1><p>Phase 2 主链路骨架：作品、设定集、剧本、出图板、画布、阅读导出、回收站。</p></header>
    <nav className="tabs">{tabs.map((t) => <button className={tab === t ? 'active' : ''} onClick={() => setTab(t)} key={t}>{t}</button>)}</nav>
    {tab === '作品' && <section className="panel"><h2>作品首页</h2><button onClick={() => createSeries.mutate()}>新建作品</button>{series.data?.map((s) => <article className="card" key={s.id}><h3>{s.title}</h3><p>{s.subtitle || '暂无副标题'}</p><button onClick={() => deleteSeries.mutate(s.id)}>移到回收站</button></article>)}</section>}
    {tab === '设定集' && <section className="panel"><h2>设定集</h2>{current ? <><h3>{current.title}</h3><p>角色 {current.bible.characters.length}，场景 {current.bible.locations.length}，画风 {current.bible.styles.length}</p><pre>{JSON.stringify(current.bible, null, 2)}</pre></> : <p>先创建作品。</p>}</section>}
    {tab === '剧本' && <section className="panel"><h2>结构化剧本助手</h2><textarea value={idea} onChange={(e) => setIdea(e.target.value)} /><button disabled={!current} onClick={() => makeScript.mutate()}>生成 12 格并显示 diff</button><p>{makeScript.isSuccess ? '已创建 Episode，可在下方审阅。' : '生成结果会写入 Episode，同时返回 added_panels diff。'}</p>{orderedPanels.map((p) => <article className="row" key={p.id}><b>{p.order + 1}. {p.shot}</b><span>{p.description}</span></article>)}</section>}
    {tab === '出图板' && <section className="panel"><h2>出图板</h2><p>候选联系表、采用和修图入口会绑定统一任务引擎。当前列出待出图分格。</p>{orderedPanels.map((p) => <div className="thumb" key={p.id}>#{p.order + 1}<br />{p.description}</div>)}</section>}
    {tab === '条漫画布' && <section className="panel"><h2>条漫画布</h2><div className="strip">{orderedPanels.map((p) => <div className="comic-panel" key={p.id}><strong>{p.order + 1}</strong><p>{p.dialogues?.[0]?.text || p.description}</p></div>)}</div></section>}
    {tab === '阅读导出' && <section className="panel"><h2>阅读与导出</h2>{strip.data ? <><p>宽 {strip.data.width}px，总高 {strip.data.height}px，切片 {strip.data.slices.length} 张。</p><a href={current ? `/api/series/${current.id}/package` : '#'}>下载 .mio.zip</a><pre>{JSON.stringify(strip.data.slices, null, 2)}</pre></> : <p>先生成剧本。</p>}</section>}
    {tab === '回收站' && <section className="panel"><h2>回收站</h2>{trash.data?.map((s) => <article className="card" key={s.id}>{s.title}</article>)}</section>}
  </main>;
}
