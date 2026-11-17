import { QueryError } from '../../app/errors';
import { ArrowLeft, ArrowRight, Check, Download, RefreshCw } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  updateBusy,
  useReleaseCatalog,
  useVersionAction,
  useVersionStatus,
} from '../../api/update';
import { usePatchSettings, useSettings } from '../../api/system';
import { toast, toastError } from '../../components/toast';
import { ConfigurationGuard } from './ConfigurationParts';
import { Field, Loading, TextInput } from '../../components/ui';
import './updates.css';

function FeedField() {
  const { t } = useTranslation();
  const settings = useSettings();
  const patch = usePatchSettings();
  const stored = (settings.data as unknown as { update_feed?: string } | undefined)?.update_feed;
  const [feed, setFeed] = useState<string | null>(null);
  const value = feed ?? stored ?? '';
  return (
    <>
      <ConfigurationGuard dirty={feed !== null && feed !== (stored ?? '')} />
      <Field label={t('settings.updates.feed')} hint={t('settings.updates.feedHint')}>
        <div className="row">
          <TextInput
            mono
            className="grow"
            disabled={patch.isPending}
            value={value}
            onChange={setFeed}
            placeholder="GitHub"
          />
          {feed !== null && feed !== stored ? (
            <button
              className="btn primary sm"
              disabled={patch.isPending}
              onClick={() =>
                patch.mutate(
                  { update_feed: feed.trim() },
                  {
                    onSuccess: () => (toast(t('common.saved')), setFeed(null)),
                    onError: toastError,
                  },
                )
              }
            >
              {t('common.save')}
            </button>
          ) : null}
        </div>
      </Field>
    </>
  );
}

export function UpdatesSection() {
  const { t } = useTranslation();
  const status = useVersionStatus();
  const action = useVersionAction();
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState('');
  const catalog = useReleaseCatalog(page);

  if (status.isError) return <QueryError error={status.error} onRetry={status.refetch} />;
  if (!status.data) return <Loading />;
  const s = status.data;
  const check = s.last_check;
  const busy = action.isPending || updateBusy(s);
  const release = catalog.data?.items.find((item) => item.tag === selected);
  const progress = s.activity.total
    ? Math.min(100, Math.round(((s.activity.received ?? 0) / s.activity.total) * 100))
    : null;
  const checkText = check?.latest
    ? check.available
      ? `发现新版本 v${check.latest}`
      : `最新正式版 v${check.latest}`
    : '尚未发布正式版本';

  return (
    <section className="updates-section" aria-label="版本更新">
      <div className="updates-summary">
        <div className="update-hero">
          <div className="col">
            <span className="small soft">{t('settings.updates.current')}</span>
            <span className="version">v{s.current}</span>
            {s.dev_checkout ? <span className="small soft">开发环境</span> : null}
          </div>
          <span className="grow" />
          <button
            className="btn"
            disabled={busy}
            onClick={() => action.mutate({ type: 'check' }, { onError: toastError })}
          >
            {s.activity.phase === 'checking' ? (
              <span className="spinner" />
            ) : (
              <RefreshCw size={15} />
            )}
            {t('settings.updates.check')}
          </button>
        </div>
        <label className="row small updates-auto">
          <input
            type="checkbox"
            checked={s.auto_check}
            disabled={action.isPending}
            onChange={(event) =>
              action.mutate(
                { type: 'preferences', auto_check: event.target.checked },
                { onError: toastError },
              )
            }
          />
          启动时检查更新
        </label>
        {check ? (
          <p className="small soft updates-status">
            {checkText}
            <span> · {new Date(check.at).toLocaleString()}</span>
          </p>
        ) : null}
        {busy ? (
          <p className="small updates-status" role="status">
            {s.activity.phase === 'checking'
              ? '正在检查版本…'
              : s.activity.phase === 'staging'
                ? '正在准备安装…'
                : `正在下载并校验${progress === null ? '…' : ` ${progress}%`}`}
          </p>
        ) : null}
        {s.activity.error ? (
          <p className="small warn-text updates-status" role="alert">
            {s.activity.error}
          </p>
        ) : null}
        {s.pending ? (
          <div className="row updates-pending" role="status">
            <Check size={16} />
            <span className="grow">v{s.pending.version} 已准备好，下次启动时安装</span>
            <button
              className="btn sm"
              disabled={busy}
              onClick={() => action.mutate({ type: 'cancel' }, { onError: toastError })}
            >
              取消安装
            </button>
          </div>
        ) : null}
      </div>
      <div className="updates-catalog">
        <h3>所有版本</h3>
        {catalog.isError ? <QueryError error={catalog.error} onRetry={catalog.refetch} /> : null}
        {catalog.isPending ? <Loading /> : null}
        {catalog.data?.items.length === 0 ? (
          <p className="soft small">官方仓库还没有发布版本。</p>
        ) : null}
        {catalog.data?.items.length ? (
          <div className="updates-browser">
            <div className="updates-list" aria-label="发布版本">
              {catalog.data.items.map((item) => (
                <button
                  key={item.tag}
                  type="button"
                  className={`updates-release${selected === item.tag ? ' selected' : ''}`}
                  onClick={() => setSelected(item.tag)}
                  aria-pressed={selected === item.tag}
                >
                  <span className="row">
                    <strong>{item.tag}</strong>
                    {item.prerelease ? <span className="badge">预览版</span> : null}
                    {item.version === s.current ? <span className="badge">当前</span> : null}
                  </span>
                  <span className="small soft">
                    {item.published_at ? new Date(item.published_at).toLocaleDateString() : ''}
                  </span>
                </button>
              ))}
            </div>
            <div className="updates-detail">
              {release ? (
                <>
                  <div className="row updates-detail-heading">
                    <h3>{release.name}</h3>
                    <span className="grow" />
                    <button
                      className="btn"
                      disabled={
                        busy ||
                        Boolean(s.pending) ||
                        !release.installable ||
                        release.version === s.current
                      }
                      onClick={() =>
                        action.mutate(
                          { type: 'install', tag: release.tag },
                          { onError: toastError },
                        )
                      }
                    >
                      <Download size={15} />
                      {release.version === s.current ? '当前版本' : '安装此版本'}
                    </button>
                  </div>
                  {release.unavailable_reason ? (
                    <p className="small soft">{release.unavailable_reason}</p>
                  ) : null}
                  <div className="updates-notes">
                    <ReactMarkdown
                      remarkPlugins={[remarkGfm]}
                      components={{
                        img: ({ alt }) => <span>{alt}</span>,
                        a: ({ href, children }) => (
                          <a href={href} target="_blank" rel="noopener noreferrer">
                            {children}
                          </a>
                        ),
                      }}
                    >
                      {release.notes || '此版本没有更新日志。'}
                    </ReactMarkdown>
                  </div>
                </>
              ) : (
                <p className="small soft">选择版本，查看更新日志。</p>
              )}
            </div>
          </div>
        ) : null}
        {page > 1 || catalog.data?.has_more ? (
          <div className="row updates-pagination">
            <button
              className="btn sm"
              disabled={page === 1 || catalog.isFetching}
              onClick={() => {
                setPage(page - 1);
                setSelected('');
              }}
            >
              <ArrowLeft size={14} />
              上一页
            </button>
            <span className="small soft">第 {page} 页</span>
            <button
              className="btn sm"
              disabled={!catalog.data?.has_more || catalog.isFetching}
              onClick={() => {
                setPage(page + 1);
                setSelected('');
              }}
            >
              下一页
              <ArrowRight size={14} />
            </button>
          </div>
        ) : null}
      </div>
      <details className="updates-advanced">
        <summary>更新来源</summary>
        <FeedField />
        {check?.source === 'feed' && check.available ? (
          <button
            className="btn"
            disabled={busy || s.dev_checkout || Boolean(s.pending)}
            onClick={() => action.mutate({ type: 'download' }, { onError: toastError })}
          >
            <Download size={15} />
            安装 v{check.latest}
          </button>
        ) : null}
      </details>
    </section>
  );
}
