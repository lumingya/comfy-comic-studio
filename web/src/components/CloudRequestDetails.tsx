import { useTranslation } from 'react-i18next';
import { assetUrl } from '../api/client';
import type { Take } from '../api/types';
import './CloudRequestDetails.css';

type Snapshot = NonNullable<Take['cloud_request']>;

/** Output dimensions come from the image; a request is not evidence of an applied seed. */
export function TakeParameterSummary({ take }: { take: Take }) {
  const { t } = useTranslation();
  const mode = take.cloud_request?.parameter_modes.seed;
  const seed = mode && mode !== 'native' ? t(`cloudRequest.seed.${mode}`) : (take.seed ?? '—');
  return (
    <>
      {take.width ?? '?'}×{take.height ?? '?'} · {t('board.seed')} {seed}
    </>
  );
}

export function CloudRequestDetails({ snapshot }: { snapshot: Snapshot | null }) {
  const { t } = useTranslation();
  if (!snapshot) return null;
  const { requested, effective, parameter_modes: modes } = snapshot;
  const dimensions = (width: number | null, height: number | null) =>
    `${width ?? '?'}×${height ?? '?'}`;
  const size =
    effective.size ||
    (effective.width && effective.height ? dimensions(effective.width, effective.height) : '—');
  const mode = (value: Snapshot['parameter_modes']['size']) => t(`cloudRequest.mode.${value}`);
  const options = ['quality', 'steps', 'scale', 'sampler', 'ref_strength']
    .map((key) => ({ key, value: effective.options[key] }))
    .filter(({ value }) => typeof value === 'string' || typeof value === 'number');
  const knownAdjustments = new Set([
    'seed_modulo_32bit',
    'width_aligned_64',
    'height_aligned_64',
    'multi_reference_lineup',
    'adapter_capabilities_unknown',
    'novelai_reference_tokens_removed',
  ]);
  return (
    <details className="cloud-request">
      <summary>{t('cloudRequest.title')}</summary>
      <p className="small muted">
        {snapshot.channel_id || t('route.chatFallback')} · {snapshot.kind} · {snapshot.model || '—'}
      </p>
      <p className="small muted">{t('cloudRequest.explanation')}</p>
      <div className="cloud-request-table">
        <table>
          <thead>
            <tr>
              <th>{t('cloudRequest.parameter')}</th>
              <th>{t('cloudRequest.requested')}</th>
              <th>{t('cloudRequest.effective')}</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <th scope="row">{t('cloudRequest.size')}</th>
              <td>{dimensions(requested.width, requested.height)}</td>
              <td>
                {modes.size === 'native' ? size : '—'}
                <small>{mode(modes.size)}</small>
              </td>
            </tr>
            <tr>
              <th scope="row">{t('board.seed')}</th>
              <td>{requested.seed ?? '—'}</td>
              <td>
                {modes.seed === 'native'
                  ? (effective.seed ?? '—')
                  : t(`cloudRequest.seed.${modes.seed}`)}
                <small>{mode(modes.seed)}</small>
              </td>
            </tr>
            <tr>
              <th scope="row">{t('cloudRequest.negative')}</th>
              <td className="cloud-request-text">{requested.negative || '—'}</td>
              <td className="cloud-request-text">
                {effective.negative || '—'}
                <small>{mode(modes.negative)}</small>
              </td>
            </tr>
            <tr>
              <th scope="row">{t('cloudRequest.references')}</th>
              <td>
                {t(`cloudRequest.requestRefs.${requested.reference_mode}`)} ·{' '}
                {requested.refs.length}
              </td>
              <td>
                {t(`cloudRequest.effectiveRefs.${effective.reference_mode}`)} ·{' '}
                {effective.refs.length}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      {options.length ? (
        <dl className="cloud-request-options">
          {options.map(({ key, value }) => (
            <div key={key}>
              <dt>{t(`cloudRequest.options.${key}`)}</dt>
              <dd>{String(value)}</dd>
            </div>
          ))}
        </dl>
      ) : null}
      {snapshot.adjustments.length ? (
        <ul className="small muted">
          {snapshot.adjustments.map((code, index) => (
            <li key={`${code}-${index}`}>
              {knownAdjustments.has(code)
                ? t(`cloudRequest.adjustments.${code}`)
                : t('cloudRequest.otherAdjustment', { code })}
            </li>
          ))}
        </ul>
      ) : null}
      <details>
        <summary>{t('cloudRequest.prompts')}</summary>
        <p className="small muted">{t('cloudRequest.requested')}</p>
        <pre className="cloud-request-text">{requested.prompt || '—'}</pre>
        <p className="small muted">{t('cloudRequest.effective')}</p>
        <pre className="cloud-request-text">{effective.prompt || '—'}</pre>
      </details>
      {requested.refs.length || effective.refs.length ? (
        <details>
          <summary>{t('cloudRequest.referenceAssets')}</summary>
          {(
            [
              { title: 'requested', refs: requested.refs },
              { title: 'effective', refs: effective.refs },
            ] as const
          ).map(({ title, refs }) => (
            <section key={title} aria-label={t(`cloudRequest.${title}`)}>
              <p className="small muted">{t(`cloudRequest.${title}`)}</p>
              <div className="ref-strip small">
                {refs.map((ref) => (
                  <figure
                    key={`${ref.slot}-${ref.asset_id}`}
                    className="ref-card mini"
                    title={ref.reason}
                  >
                    <img
                      src={assetUrl(ref.asset_id, 160)}
                      alt={`${ref.owner} · ${ref.role}`}
                      loading="lazy"
                    />
                    <figcaption className="muted">
                      #{ref.slot} {ref.owner} · {ref.role}
                    </figcaption>
                  </figure>
                ))}
              </div>
            </section>
          ))}
        </details>
      ) : null}
    </details>
  );
}
