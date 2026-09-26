import { useQuery } from '@tanstack/react-query';

type Series = {
  id: string;
  title: string;
  subtitle: string;
  status: 'draft' | 'active' | 'archived';
};

async function fetchSeries(): Promise<Series[]> {
  const response = await fetch('/api/series');
  if (!response.ok) throw new Error(`API ${response.status}`);
  return response.json();
}

export function App() {
  const { data, isLoading, error } = useQuery({ queryKey: ['series'], queryFn: fetchSeries });
  return (
    <main className="shell">
      <section className="hero">
        <p className="eyebrow">Mio v3 · 条漫工作室</p>
        <h1>从作品设定到一话条漫</h1>
        <p>Phase 1 已建立新 API 与 React 入口。下一步会把设定集、剧本和出图板接到同一套领域模型。</p>
      </section>
      <section className="panel">
        <h2>作品</h2>
        {isLoading && <p>正在读取本地库…</p>}
        {error && <p className="error">API 暂不可用：{String(error)}</p>}
        {data?.length === 0 && <p>还没有作品。先从 API 创建一个 Series。</p>}
        <ul>
          {data?.map((series) => (
            <li key={series.id}>
              <strong>{series.title}</strong>
              <span>{series.status}</span>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
