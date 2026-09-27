import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { lazy, Suspense, type ReactNode } from 'react';
import { createBrowserRouter, Navigate, RouterProvider, useSearchParams } from 'react-router-dom';
import { ApiError } from '../api/client';
import { Loading } from '../components/ui';
import { Shell } from './Shell';
import { NotFound, RouteError } from './errors';

const Home = lazy(() => import('../pages/home/HomePage'));
const Works = lazy(() => import('../pages/works/WorksPage'));
const Workshop = lazy(() => import('../pages/workshop/WorkshopPage'));
const WorkshopIndex = lazy(() =>
  import('../pages/workshop/WorkshopPage').then((m) => ({ default: m.WorkshopIndex })),
);
const Engine = lazy(() => import('../pages/engine/EnginePage'));
const SeriesPage = lazy(() => import('../pages/series/SeriesPage'));
const EpisodesTab = lazy(() => import('../pages/series/EpisodesTab'));
const BibleTab = lazy(() => import('../pages/bible/BibleTab'));
const VariantsTab = lazy(() => import('../pages/series/VariantsTab'));
const EpisodeRedirect = lazy(() => import('../pages/episode/EpisodePage'));
const ScriptTab = lazy(() => import('../pages/script/ScriptTab'));
const BoardTab = lazy(() => import('../pages/board/BoardTab'));
const CanvasTab = lazy(() => import('../pages/canvas/CanvasTab'));
const ReaderTab = lazy(() => import('../pages/episode/ReaderTab'));
const ExportTab = lazy(() => import('../pages/episode/ExportTab'));
const ExtensionTab = lazy(() => import('../pages/episode/ExtensionTab'));
const Jobs = lazy(() => import('../pages/jobs/JobsPage'));
const Settings = lazy(() => import('../pages/settings/SettingsPage'));

const s = (node: ReactNode) => <Suspense fallback={<Loading />}>{node}</Suspense>;

/** Render settings moved to 工作流与 API 配置: keep old `/settings?tab=instances` links working. */
const ENGINE_TABS = ['instances', 'workflows', 'profiles', 'channels'];
function SettingsRoute() {
  const [params] = useSearchParams();
  const tab = params.get('tab') ?? '';
  if (ENGINE_TABS.includes(tab)) return <Navigate to={`/engine?tab=${tab}`} replace />;
  return s(<Settings />);
}

export const routes = [
  {
    path: '/',
    element: <Shell />,
    errorElement: <RouteError />,
    children: [
      { index: true, element: s(<Home />) },
      { path: 'gallery', element: s(<Works />) },
      {
        path: 'series/:seriesId',
        element: s(<SeriesPage />),
        children: [
          { index: true, element: <Navigate to="episodes" replace /> },
          { path: 'episodes', element: s(<EpisodesTab />) },
          { path: 'bible', element: s(<BibleTab />) },
          { path: 'variants', element: s(<VariantsTab />) },
        ],
      },
      { path: 'workshop', element: s(<WorkshopIndex />) },
      {
        path: 'workshop/:episodeId',
        element: s(<Workshop />),
        children: [
          { index: true, element: <Navigate to="script" replace /> },
          { path: 'script', element: s(<ScriptTab />) },
          { path: 'presets', element: s(<BibleTab />) },
          { path: 'board', element: s(<BoardTab />) },
          { path: 'canvas', element: s(<CanvasTab />) },
          { path: 'read', element: s(<ReaderTab />) },
          { path: 'export', element: s(<ExportTab />) },
          { path: 'ext/:panelId', element: s(<ExtensionTab />) },
        ],
      },
      { path: 'episodes/:episodeId/*', element: s(<EpisodeRedirect />) },
      { path: 'jobs', element: s(<Jobs />) },
      { path: 'engine', element: s(<Engine />) },
      { path: 'settings', element: <SettingsRoute /> },
      { path: 'trash', element: <Navigate to="/settings?tab=data" replace /> },
      { path: '*', element: <NotFound /> },
    ],
  },
];

export function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 10_000,
        refetchOnWindowFocus: false,
        retry: (count, error) => !(error instanceof ApiError && error.status < 500) && count < 2,
      },
    },
  });
}

const queryClient = makeQueryClient();
const router = createBrowserRouter(routes);

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  );
}
