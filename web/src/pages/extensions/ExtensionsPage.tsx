import { useRef, useState, type KeyboardEvent } from 'react';
import { Download, ExternalLink, Power, Puzzle, RefreshCw, Search, Settings2 } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import { useExtensionMarket, useMarketAction, type MarketItem } from '../../api/extension-market';
import { useExtensionAction, useExtensions, type ExtensionInfo } from '../../api/open';
import { QueryError } from '../../app/errors';
import { usePageTitle } from '../../app/title';
import { Empty, Field, Loading, Modal, TextInput } from '../../components/ui';
import { toast, toastError } from '../../components/toast';
import { ExtensionsSection, TrustDialog } from '../settings/ExtensionsSection';
import { useMarketText } from './strings';
import './extensions.css';

export default function ExtensionsPage() {
  const text = useMarketText();
  const [params, setParams] = useSearchParams();
  const installed = params.get('tab') === 'installed';
  const catalog = useExtensionMarket();
  const local = useExtensions();
  const action = useMarketAction();
  const enable = useExtensionAction();
  const [query, setQuery] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);
  const [sourceOpen, setSourceOpen] = useState(false);
  const [sourceUrl, setSourceUrl] = useState('');
  const [selected, setSelected] = useState<MarketItem | null>(null);
  const [trusting, setTrusting] = useState<ExtensionInfo | null>(null);
  usePageTitle(installed ? text.installed : text.market);
  const items = (catalog.data?.items ?? []).filter((item) =>
    `${item.name} ${item.id} ${item.description} ${item.author} ${item.tags.join(' ')}`
      .toLocaleLowerCase()
      .includes(query.toLocaleLowerCase()),
  );
  const manage = () => {
    setSelected(null);
    setParams({ tab: 'installed' });
  };
  const handleTabKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    const tabs = Array.from(
      event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]') ?? [],
    );
    const index = tabs.indexOf(event.currentTarget);
    const nextIndex =
      event.key === 'ArrowRight'
        ? (index + 1) % tabs.length
        : event.key === 'ArrowLeft'
          ? (index - 1 + tabs.length) % tabs.length
          : event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? tabs.length - 1
              : -1;
    if (nextIndex < 0) return;
    event.preventDefault();
    tabs[nextIndex].focus();
    tabs[nextIndex].click();
  };
  const activate = (item: MarketItem) => {
    const ext = local.data?.items.find((entry) => entry.id === item.id);
    if (!ext) {
      manage();
      return;
    }
    if (!ext.builtin) {
      setSelected(null);
      setTrusting(ext);
      return;
    }
    enable.mutate(
      { id: ext.id, action: 'enable', digest: ext.digest },
      {
        onSuccess: (result) => {
          if ((result as ExtensionInfo).status !== 'active')
            toastError((result as ExtensionInfo).error || text.enableFailed);
          else manage();
        },
        onError: toastError,
      },
    );
  };
  const run = (item: MarketItem) => {
    if (item.action === 'installed') {
      manage();
      return;
    }
    if (item.action === 'enable') {
      activate(item);
      return;
    }
    if (!catalog.data) return;
    action.mutate(
      { action: 'install', item, digest: catalog.data.catalog_digest },
      {
        onSuccess: (value) => {
          setSelected(null);
          setTrusting(value as ExtensionInfo);
          toast(text.installedHint);
        },
        onError: toastError,
      },
    );
  };
  const label = (item: MarketItem) => text[item.action === 'installed' ? 'manage' : item.action];
  const busy = action.isPending || enable.isPending;
  return (
    <div className="view extension-center">
      <div className="extension-toolbar">
        <div className="extension-tabs" role="tablist" aria-label={text.market}>
          <button
            className={!installed ? 'active' : ''}
            role="tab"
            id="extension-market-tab"
            aria-controls="extension-market-panel"
            aria-selected={!installed}
            tabIndex={installed ? -1 : 0}
            onKeyDown={handleTabKeyDown}
            onClick={() => setParams({})}
          >
            {text.market}
          </button>
          <button
            className={installed ? 'active' : ''}
            role="tab"
            id="extension-installed-tab"
            aria-controls="extension-installed-panel"
            aria-selected={installed}
            tabIndex={installed ? 0 : -1}
            onKeyDown={handleTabKeyDown}
            onClick={() => setParams({ tab: 'installed' })}
          >
            {text.installed}
            <span className="small muted">{local.data?.items.length ?? ''}</span>
          </button>
        </div>
        <div className="extension-search">
          <Search size={16} />
          <input
            ref={searchRef}
            aria-label={text.search}
            placeholder={text.search}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
        {!installed && (
          <>
            <button
              className="btn ghost icon"
              aria-label={text.source}
              title={text.source}
              onClick={() => {
                setSourceUrl(catalog.data?.source.url ?? '');
                setSourceOpen(true);
              }}
            >
              <Settings2 size={18} />
            </button>
            <button
              className="btn"
              disabled={busy || catalog.isFetching}
              onClick={() => action.mutate({ action: 'refresh' }, { onError: toastError })}
            >
              <RefreshCw
                size={16}
                className={catalog.isFetching || action.isPending ? 'spin' : ''}
              />
              {text.refresh}
            </button>
          </>
        )}
      </div>
      <div
        id="extension-market-panel"
        role="tabpanel"
        aria-labelledby="extension-market-tab"
        tabIndex={0}
        hidden={installed}
      >
        {!installed && (
          <>
            {catalog.data?.source.error && (
              <p className="small warn-text" role="status">
                {text.sourceError} <span>{catalog.data.source.error}</span>
              </p>
            )}
            {catalog.isPending ? (
              <Loading />
            ) : catalog.isError ? (
              <QueryError error={catalog.error} onRetry={catalog.refetch} />
            ) : !items.length ? (
              <Empty
                action={
                  query ? (
                    <button
                      type="button"
                      className="btn"
                      onClick={() => {
                        setQuery('');
                        searchRef.current?.focus();
                      }}
                    >
                      {text.clearSearch}
                    </button>
                  ) : undefined
                }
              >
                {query ? text.noMatches : text.empty}
              </Empty>
            ) : (
              <div className="extension-market-grid">
                {items.map((item) => (
                  <article className="extension-market-card" key={item.id}>
                    <button
                      className="extension-card-detail"
                      onClick={() => setSelected(item)}
                      aria-label={`${text.details} · ${item.name}`}
                    >
                      <span className="extension-emblem">
                        <Puzzle size={25} />
                      </span>
                      <span className="extension-card-heading">
                        <strong>{item.name}</strong>
                        <span className="small muted">
                          {item.author || 'Mio'} · v{item.version}
                        </span>
                      </span>
                      <span className="extension-card-description">{item.description}</span>
                    </button>
                    <footer>
                      <span className="small muted">
                        {item.source === 'bundled' ? text.bundled : item.tags.join(' · ')}
                      </span>
                      <button className="btn sm" disabled={busy} onClick={() => run(item)}>
                        {item.action === 'enable' ? (
                          <Power size={14} />
                        ) : ['install', 'update'].includes(item.action) ? (
                          <Download size={14} />
                        ) : null}
                        {label(item)}
                      </button>
                    </footer>
                  </article>
                ))}
              </div>
            )}
          </>
        )}
      </div>
      <div
        id="extension-installed-panel"
        role="tabpanel"
        aria-labelledby="extension-installed-tab"
        tabIndex={0}
        hidden={!installed}
      >
        {installed && <ExtensionsSection query={query} />}
      </div>
      <Modal
        open={sourceOpen}
        onOpenChange={(open) => !busy && setSourceOpen(open)}
        title={text.sourceTitle}
        footer={
          <>
            <button className="btn ghost" disabled={busy} onClick={() => setSourceOpen(false)}>
              {text.cancel}
            </button>
            <button
              className="btn primary"
              disabled={busy || (!!sourceUrl.trim() && !/^https?:\/\//i.test(sourceUrl.trim()))}
              onClick={() =>
                action.mutate(
                  { action: 'source', url: sourceUrl.trim() },
                  { onSuccess: () => setSourceOpen(false), onError: toastError },
                )
              }
            >
              {text.save}
            </button>
          </>
        }
      >
        <Field label={text.sourceUrl}>
          <TextInput
            value={sourceUrl}
            onChange={setSourceUrl}
            placeholder={text.sourcePlaceholder}
          />
        </Field>
      </Modal>
      <Modal
        open={!!selected}
        onOpenChange={(open) => !busy && !open && setSelected(null)}
        title={selected?.name ?? ''}
        footer={
          selected && (
            <button className="btn primary" disabled={busy} onClick={() => run(selected)}>
              {label(selected)}
            </button>
          )
        }
      >
        {selected && (
          <div className="col" style={{ gap: 18 }}>
            <div className="small muted">
              {selected.author} · v{selected.version}
            </div>
            <p className="extension-detail-description">{selected.description}</p>
            {/^https?:\/\//i.test(selected.homepage) && (
              <a className="btn" target="_blank" rel="noopener noreferrer" href={selected.homepage}>
                <ExternalLink size={15} />
                {text.homepage}
              </a>
            )}
          </div>
        )}
      </Modal>
      <TrustDialog ext={trusting} onClose={() => setTrusting(null)} />
    </div>
  );
}
