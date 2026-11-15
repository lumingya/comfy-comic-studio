import { Check, Download, RefreshCw, Search } from 'lucide-react';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ApiError } from '../../api/client';
import {
  fetchModelCatalog,
  type ModelCatalogRequest,
  type ModelCatalogResponse,
} from '../../api/modelCatalog';
import './ModelCatalog.css';

type CatalogState = {
  request: ModelCatalogRequest;
  loading?: boolean;
  data?: ModelCatalogResponse;
  error?: string;
};

// Plugin-rich ComfyUI installations can expose thousands of model choices.
const VISIBLE_MODEL_LIMIT = 100;

export function ModelCatalog({
  request,
  selected = [],
  onSelect,
  disabled = false,
}: {
  request: ModelCatalogRequest;
  selected?: string[];
  onSelect?: (id: string) => void;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  const panelId = useId();
  const searchId = useId();
  // Identity stays in memory; credentials never become a React key or a DOM attribute.
  const identity = useMemo(
    () => ({ ...request }),
    [request.kind, request.base_url, request.api_key, request.channel_id],
  );
  const [state, setState] = useState<CatalogState | null>(null);
  const [search, setSearch] = useState('');
  const active = useRef<AbortController | null>(null);
  useEffect(() => {
    active.current?.abort();
    setState(null);
    setSearch('');
    return () => active.current?.abort();
  }, [identity]);

  // Hide old results immediately, even before the effect aborts an earlier request.
  const current = state?.request === identity ? state : null;
  const load = async () => {
    if (disabled || current?.loading) return;
    active.current?.abort();
    const controller = new AbortController();
    active.current = controller;
    setState({ request: identity, loading: true });
    setSearch('');
    try {
      const data = await fetchModelCatalog(identity, controller.signal);
      if (!controller.signal.aborted && active.current === controller) {
        setState({ request: identity, data });
      }
    } catch (error) {
      if (!controller.signal.aborted && active.current === controller) {
        setState({
          request: identity,
          error: error instanceof ApiError ? error.message : t('config.models.failed'),
        });
      }
    }
  };
  const data = current?.data;
  const query = search.trim().toLocaleLowerCase();
  const models = (data?.models ?? []).filter((model) =>
    [model.id, model.name, model.group].some((part) => part?.toLocaleLowerCase().includes(query)),
  );

  return (
    <section className="model-catalog" aria-label={t('config.models.catalog')}>
      <div className="model-catalog-actions">
        <button
          type="button"
          className="btn sm"
          disabled={disabled || !!current?.loading}
          aria-controls={panelId}
          aria-expanded={!!current}
          onClick={() => void load()}
        >
          {data ? <RefreshCw size={14} aria-hidden /> : <Download size={14} aria-hidden />}
          {t(
            current?.loading
              ? 'config.models.loading'
              : current?.error
                ? 'config.models.retry'
                : data
                  ? 'config.models.refresh'
                  : 'config.models.fetch',
          )}
        </button>
        {current?.loading ? (
          <span className="small muted" role="status">
            {t('config.models.loading')}
          </span>
        ) : null}
      </div>
      {current ? (
        <div id={panelId} className="model-catalog-panel" aria-busy={!!current.loading}>
          {current.error ? (
            <p className="notice error" role="alert">
              {current.error}
            </p>
          ) : null}
          {data ? (
            <>
              <div className="model-catalog-heading">
                <strong>
                  {t(data.source === 'bundled' ? 'config.models.bundled' : 'config.models.remote')}
                </strong>
                <span className="small muted" role="status">
                  {query
                    ? t('config.models.filtered', {
                        shown: models.length,
                        total: data.models.length,
                      })
                    : t('config.models.count', { count: data.models.length })}
                </span>
              </div>
              {data.notice ? <p className="small muted">{data.notice}</p> : null}
              {data.models.length ? (
                <>
                  <label className="model-catalog-search" htmlFor={searchId}>
                    <Search size={14} aria-hidden />
                    <span className="sr-only">{t('config.models.search')}</span>
                    <input
                      id={searchId}
                      className="input"
                      type="search"
                      value={search}
                      onChange={(event) => setSearch(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') event.preventDefault();
                      }}
                      placeholder={t('config.models.search')}
                      autoComplete="off"
                      disabled={disabled}
                    />
                  </label>
                  {models.length ? (
                    <ul className="model-catalog-list">
                      {models.slice(0, VISIBLE_MODEL_LIMIT).map((model) => {
                        const chosen = selected.includes(model.id);
                        const content = (
                          <>
                            <span className="model-catalog-model">
                              <span className="code">{model.id}</span>
                              {model.name && model.name !== model.id ? (
                                <small>{model.name}</small>
                              ) : null}
                              {model.group ? <small>{model.group}</small> : null}
                            </span>
                            {onSelect && chosen ? <Check size={15} aria-hidden /> : null}
                          </>
                        );
                        return (
                          <li key={`${model.group ?? ''}:${model.id}`}>
                            {onSelect ? (
                              <button
                                type="button"
                                className="model-catalog-option"
                                disabled={disabled}
                                aria-pressed={chosen}
                                onClick={() => onSelect(model.id)}
                              >
                                {content}
                              </button>
                            ) : (
                              <div className="model-catalog-option">{content}</div>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  ) : (
                    <p className="small muted" role="status">
                      {t('config.models.noMatches')}
                    </p>
                  )}
                  {models.length > VISIBLE_MODEL_LIMIT ? (
                    <p className="small muted" role="status">
                      {t('config.models.limited', { count: VISIBLE_MODEL_LIMIT })}
                    </p>
                  ) : null}
                </>
              ) : (
                <p className="small muted">
                  {t(onSelect ? 'config.models.empty' : 'config.models.emptyReadonly')}
                </p>
              )}
            </>
          ) : null}
          {!current.loading && (current.error || !!data?.models.length) ? (
            <p className="small muted">
              {t(onSelect ? 'config.models.manual' : 'config.models.readOnly')}
            </p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
