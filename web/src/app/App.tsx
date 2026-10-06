import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { lazy, Suspense, type ReactNode } from 'react';
import { createBrowserRouter, Navigate, RouterProvider, useSearchParams } from 'react-router-dom';
import { ApiError } from '../api/client';
import { Loading } from '../components/ui';
import { Shell } from './Shell';
import { NotFound, RouteError } from './errors';

const Home = lazy(() => import('../pages/home/HomePage'));
const Works = lazy(() => import('../pages/works/WorksPage'));
const ws = () => import('../pages/workshop/WorkshopPage');
const StoryIndex = lazy(() => ws().then((m) => ({ default: m.StoryIndex })));
const StoryTab = lazy(() => ws().then((m) => ({ default: m.StoryTab })));
const StoryBody = lazy(() => ws().then((m) => ({ default: m.StoryBody })));
const TaskDetail = lazy(() => ws().then((m) => ({ default: m.TaskDetail })));
const LegacyRedirect = lazy(() => ws().then((m) => ({ default: m.LegacyRedirect })));
const PresetsTab = lazy(() => import('../pages/workshop/PresetsTab'));
const AssemblyTab = lazy(() => import('../pages/workshop/AssemblyTab'));
const Reader = lazy(() => import('../pages/works/ReaderPage'));
const Engine = lazy(() => import('../pages/engine/EnginePage'));
const SeriesPage = lazy(() => import('../pages/series/SeriesPage'));
const EpisodesTab = lazy(() => import('../pages/series/EpisodesTab'));
const BibleTab = lazy(() => import('../pages/bible/BibleTab'));
const EpisodeRedirect = lazy(() => import('../pages/episode/EpisodePage'));
const ScriptTab = lazy(() => import('../pages/script/ScriptTab'));
const BoardTab = lazy(() => import('../pages/board/BoardTab'));
const CanvasTab = lazy(() => import('../pages/canvas/CanvasTab'));
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
      {
        path: 'gallery',
        element: s(<Works />),
        children: [
          {
            path: ':seriesId',
            element: s(<Reader />),
            children: [
              // The presentation drawer lives in the reader itself; the path only opens it.
              { path: 'export', element: null },
              { path: 'layout', element: s(<CanvasTab />) },
            ],
          },
        ],
      },
      {
        path: 'series/:seriesId',
        element: s(<SeriesPage />),
        children: [
          { index: true, element: <Navigate to="episodes" replace /> },
          { path: 'episodes', element: s(<EpisodesTab />) },
          { path: 'bible', element: s(<BibleTab />) },
        ],
      },
      {
        path: 'workshop',
        children: [
          { index: true, element: <Navigate to="story" replace /> },
          { path: 'story', element: s(<StoryIndex />) },
          {
            path: 'story/:episodeId',
            element: s(<StoryTab />),
            children: [{ index: true, element: s(<StoryBody />) }],
          },
          { path: 'presets', element: s(<PresetsTab />) },
          { path: 'assembly', element: s(<AssemblyTab />) },
          {
            path: 'assembly/:episodeId',
            element: s(<TaskDetail />),
            children: [
              { index: true, element: <Navigate to="board" replace /> },
              { path: 'board', element: s(<BoardTab />) },
              { path: 'script', element: s(<ScriptTab />) },
              { path: 'ext/:panelId', element: s(<ExtensionTab />) },
            ],
          },
          { path: ':episodeId/*', element: s(<LegacyRedirect />) },
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
