import { StrictMode, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { AssistChat } from './AssistChat';
import { ConfirmHost, notifyHost, Toaster } from './runtime';
import './ui.css';
import './assist.css';

void i18n.use(initReactI18next).init({
  lng: navigator.language.startsWith('zh') ? 'zh-CN' : 'en',
  resources: {},
  interpolation: { escapeValue: false },
});
const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 10000, retry: false, refetchOnWindowFocus: false },
    mutations: { retry: false },
  },
});
const hash = new URLSearchParams(location.hash.slice(1));
function App() {
  useEffect(() => {
    const handler = (event: MessageEvent) => {
      if (
        event.source !== parent ||
        event.origin !== location.origin ||
        event.data?.session !== hash.get('mio-session') ||
        event.data.type !== 'mio:workspace:context'
      )
        return;
      const data = event.data;
      for (const [key, value] of Object.entries(data.tokens || {}))
        if (/^--[a-zA-Z0-9_-]+$/.test(key) && typeof value === 'string')
          document.documentElement.style.setProperty(key, value);
      document.documentElement.dataset.theme = data.theme || 'light';
      document.documentElement.lang = data.locale || 'zh-CN';
      void i18n.changeLanguage(data.locale || 'zh-CN');
    };
    addEventListener('message', handler);
    notifyHost('ready');
    return () => removeEventListener('message', handler);
  }, []);
  return (
    <QueryClientProvider client={queryClient}>
      <AssistChat floating={hash.get('floating') === '1'} />
      <ConfirmHost />
      <Toaster />
    </QueryClientProvider>
  );
}
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
