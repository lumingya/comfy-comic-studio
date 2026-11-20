import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { assetUrl } from '../../api/client';
import type { Episode } from '../../api/types';
import { Icon } from '../../app/icons';
import { Modal } from '../../components/ui';
import type { PageProgress } from './taskProgress';
import type { Task } from './assemblyTasks';

export function AssemblyTaskPages({
  task,
  panels,
  pages,
  openOnFailure,
  rerunning,
  onRerun,
}: {
  task: Task;
  panels: Episode['panels'];
  pages: Map<string, PageProgress>;
  openOnFailure: boolean;
  rerunning: boolean;
  onRerun: (ids: string[]) => void;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { album, episode, adopted } = task;
  const [preview, setPreview] = useState<{ asset: string; n: number } | null>(null);
  const pageOf = (id: string): PageProgress => pages.get(id) ?? { state: 'standby' };
  return (
    <>
      <details className="production-pages" open={openOnFailure ? true : undefined}>
        <summary>{t('ws.queue.pages')}</summary>
        <div className="production-page-list">
          {panels.map((p, i) => {
            const page = pageOf(p.id!);
            const st = page.state;
            // Legacy canRerun: a scene the engine still owns (running, queued or held) is not rerun.
            const busy = st === 'running' || st === 'queued' || st === 'paused';
            const tries = episode?.takes.filter((x) => x.panel_id === p.id).length ?? 0;
            const again = !!page.asset;
            const tailAgain = panels.slice(i).some((x) => adopted.has(x.id!));
            return (
              <div className="production-page" key={p.id}>
                <div className="production-page-number">{String(i + 1).padStart(2, '0')}</div>
                {page.asset ? (
                  <button
                    type="button"
                    className="production-page-preview"
                    aria-label={t('ws.queue.previewOf', { n: i + 1 })}
                    title={t('ws.queue.previewOf', { n: i + 1 })}
                    onClick={() => setPreview({ asset: page.asset!, n: i + 1 })}
                  >
                    <img src={assetUrl(page.asset, 160)} alt="" loading="lazy" />
                  </button>
                ) : (
                  <span className="production-page-blank" />
                )}
                <div className="grow production-page-main">
                  <button
                    type="button"
                    className="production-page-body"
                    disabled={st === 'running'}
                    title={st === 'running' ? t('ws.queue.pageBusy') : t('ws.queue.pageEdit')}
                    onClick={() =>
                      navigate(`/workshop/assembly/${episode!.id}/script?panel=${p.id}`)
                    }
                  >
                    <span className="production-page-status">
                      <strong className={`page-${st}`}>{t(`ws.queue.state.${st}`)}</strong>
                      <small>{t('ws.queue.tries', { count: tries })}</small>
                    </span>
                    <span className="production-page-excerpt">
                      <b>{p.description || t('ws.story.frameN', { n: i + 1 })}</b>
                      <span className="production-page-prompt">
                        {(p.overrides.raw_prompt ?? p.tags.join(', ')).slice(0, 80)}
                      </span>
                    </span>
                  </button>
                  {page.error && st !== 'done' ? (
                    <p className="production-error">{page.error.message}</p>
                  ) : page.error ? (
                    <p className="production-error-tail" title={page.error.message}>
                      {t('ws.queue.keptOriginal')}
                    </p>
                  ) : null}
                </div>
                <div>
                  <button
                    type="button"
                    className="btn small"
                    disabled={rerunning || busy}
                    title={again ? t('ws.queue.rerunHint') : undefined}
                    onClick={() => onRerun([p.id!])}
                  >
                    <Icon name={again ? 'refresh' : 'play'} sm />
                    {again ? t('ws.queue.rerunOne') : t('ws.queue.runOne')}
                  </button>
                  <button
                    type="button"
                    className="btn small ghost"
                    disabled={rerunning || busy}
                    title={tailAgain ? t('ws.queue.rerunHint') : undefined}
                    onClick={() => onRerun(panels.slice(i).map((x) => x.id!))}
                  >
                    <Icon name="list" sm />
                    {tailAgain ? t('ws.queue.rerunFrom') : t('ws.queue.runFrom')}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </details>
      {preview ? (
        <Modal
          open
          size="lg"
          onOpenChange={(open) => !open && setPreview(null)}
          title={`${album.title} · ${t('ws.story.frameN', { n: preview.n })}`}
        >
          <img
            className="production-page-full-image"
            src={assetUrl(preview.asset)}
            alt={t('ws.story.frameN', { n: preview.n })}
          />
        </Modal>
      ) : null}
    </>
  );
}
