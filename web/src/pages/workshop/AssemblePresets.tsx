import * as Popover from '@radix-ui/react-popover';
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { Preset, PresetEntry } from '../../api/workshop';
import { Icon } from '../../app/icons';
import './assemble-presets.css';

type PreviewMode = 'hover' | 'pinned';
const MERGE = Symbol('merge');
type PreviewId = string | typeof MERGE;

export function AssemblePresets({
  host,
  presets,
  ordered,
  onToggle,
  onMove,
}: {
  host: HTMLDialogElement | null;
  presets: Preset[];
  ordered: Preset[];
  onToggle: (id: string) => void;
  onMove: (id: string, step: -1 | 1) => void;
}) {
  const { t } = useTranslation();
  const [preview, setPreview] = useState<{ id: PreviewId; mode: PreviewMode } | null>(null);
  const selected = new Set(ordered.map((preset) => preset.id));
  function previewProps(id: PreviewId) {
    return {
      host,
      mode: preview?.id === id ? preview.mode : null,
      onMode: (mode: PreviewMode | null) =>
        setPreview((active) => {
          if (mode === null) return active?.id === id ? null : active;
          if (mode === 'hover' && active?.mode === 'pinned') return active;
          return { id, mode };
        }),
    };
  }

  return (
    <>
      <div className="designer-presets" role="group" aria-label={t('ws.assemble.presets')}>
        {presets.map((preset) => {
          const id = preset.id!;
          const on = selected.has(id);
          return (
            <div className="assembly-preset-card" key={id}>
              <label className={`designer-preset${on ? ' selected' : ''}`}>
                <input type="checkbox" checked={on} onChange={() => onToggle(id)} />
                <span className="designer-preset-mark" aria-hidden="true" />
                <span className="designer-preset-icon">
                  <Icon name="users" sm />
                </span>
                <span className="designer-preset-body">
                  <strong>{preset.title}</strong>
                  <small>{t('ws.assemble.presetKind', { count: preset.entries.length })}</small>
                  <span className="designer-preset-keys">
                    {preset.entries.slice(0, 4).map((entry, index) => (
                      <code key={entry.id ?? index}>{`{${entry.key}}`}</code>
                    ))}
                    {preset.entries.length > 4 ? <code>+{preset.entries.length - 4}</code> : null}
                  </span>
                </span>
              </label>
              <PresetPeek
                {...previewProps(id)}
                label={t('ws.assemble.presetPeek.preset', { title: preset.title })}
                title={preset.title}
                iconOnly
              >
                <PresetValues entries={preset.entries} />
              </PresetPeek>
            </div>
          );
        })}
      </div>
      {ordered.length ? (
        <section className="assembly-preset-order-section">
          <header>
            <h4>{t('ws.assemble.presetOrder')}</h4>
            <PresetPeek
              {...previewProps(MERGE)}
              label={t('ws.assemble.presetPeek.merge')}
              title={t('ws.assemble.presetPeek.merge')}
            >
              <MergedValues presets={ordered} />
            </PresetPeek>
          </header>
          <ol className="assembly-preset-order" aria-label={t('ws.assemble.presetOrder')}>
            {ordered.map((preset, index) => (
              <li key={preset.id}>
                <span title={preset.title}>{preset.title}</span>
                {([-1, 1] as const).map((direction) => (
                  <button
                    type="button"
                    className="btn ghost"
                    key={direction}
                    disabled={index + direction < 0 || index + direction >= ordered.length}
                    aria-label={t(direction < 0 ? 'ws.assemble.moveUp' : 'ws.assemble.moveDown', {
                      title: preset.title,
                    })}
                    onClick={() => onMove(preset.id!, direction)}
                  >
                    <Icon name={direction < 0 ? 'up' : 'down'} sm />
                  </button>
                ))}
              </li>
            ))}
          </ol>
        </section>
      ) : null}
    </>
  );
}

function PresetPeek({
  host,
  label,
  title,
  iconOnly,
  mode,
  onMode,
  children,
}: {
  host: HTMLDialogElement | null;
  label: string;
  title: string;
  iconOnly?: boolean;
  mode: PreviewMode | null;
  onMode: (mode: PreviewMode | null) => void;
  children: ReactNode;
}) {
  const titleId = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const leaveTimer = useRef<number>(undefined);
  const restoreFocus = useRef(false);
  const clearLeave = () => window.clearTimeout(leaveTimer.current);
  const leave = () => {
    clearLeave();
    if (mode === 'hover') leaveTimer.current = window.setTimeout(() => onMode(null), 180);
  };
  useEffect(() => () => window.clearTimeout(leaveTimer.current), []);
  useEffect(() => {
    if (mode !== 'pinned') return;
    // Floating UI hides a new portal while measuring it; focus after placement.
    const frame = requestAnimationFrame(() => content.current?.focus({ preventScroll: true }));
    return () => cancelAnimationFrame(frame);
  }, [mode]);

  return (
    <Popover.Root open={mode !== null} onOpenChange={(open) => onMode(open ? 'pinned' : null)}>
      <Popover.Trigger
        ref={trigger}
        className={iconOnly ? 'ibtn assembly-preset-peek' : 'btn ghost assembly-merge-peek'}
        aria-label={label}
        onPointerEnter={(event) => {
          clearLeave();
          if (event.pointerType === 'mouse' && !event.buttons && !mode) onMode('hover');
        }}
        onPointerLeave={leave}
        onClick={(event) => {
          event.preventDefault();
          clearLeave();
          onMode(mode === 'pinned' ? null : 'pinned');
        }}
      >
        <Icon name="eye" sm />
        {iconOnly ? null : label}
      </Popover.Trigger>
      <Popover.Portal container={host}>
        <Popover.Content
          ref={content}
          className="assembly-preset-popover"
          aria-labelledby={titleId}
          align="end"
          sideOffset={5}
          collisionPadding={12}
          collisionBoundary={host ?? undefined}
          hideWhenDetached
          onPointerEnter={clearLeave}
          onPointerLeave={leave}
          onOpenAutoFocus={(event) => event.preventDefault()}
          onEscapeKeyDown={(event) => {
            if (event.isComposing) event.preventDefault();
            else restoreFocus.current = mode === 'pinned';
          }}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            if (restoreFocus.current) trigger.current?.focus({ preventScroll: true });
            restoreFocus.current = false;
          }}
          onKeyDown={(event) => {
            if (event.key !== 'Tab') return;
            // Continue in the dialog's tab order from the trigger, not from the portal.
            trigger.current?.focus({ preventScroll: true });
            onMode(null);
          }}
        >
          <h4 id={titleId}>{title}</h4>
          {children}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

function PresetValues({ entries }: { entries: PresetEntry[] }) {
  const { t } = useTranslation();
  if (!entries.length) return <p>{t('ws.assemble.presetPeek.empty')}</p>;
  return (
    <dl>
      {entries.map(({ id, key, value, label }, index) => (
        <div key={id ?? index}>
          <dt>
            <code>{`{${key}}`}</code>
            {label ? <small>{label}</small> : null}
          </dt>
          <dd>{value === '' ? t('ws.assemble.presetPeek.emptyValue') : value}</dd>
        </div>
      ))}
    </dl>
  );
}

function MergedValues({ presets }: { presets: Preset[] }) {
  const { t } = useTranslation();
  type Source = { value: string; title: string; order: number };
  // build_snapshot applies preset.variables() in request order. Empty strings also override.
  const values = new Map<string, Source[]>();
  presets.forEach((preset, order) => {
    preset.entries.forEach(({ key, value }) => {
      const source = { value, title: preset.title, order: order + 1 };
      const rows = values.get(key);
      if (rows) rows.push(source);
      else values.set(key, [source]);
    });
  });
  if (!values.size) return <p>{t('ws.assemble.presetPeek.empty')}</p>;
  return (
    <dl>
      {[...values].map(([key, rows]) => (
        <div key={key}>
          <dt>
            <code>{`{${key}}`}</code>
          </dt>
          {[...rows].reverse().map(({ title, order, value }, index) => {
            const text = value === '' ? t('ws.assemble.presetPeek.emptyValue') : value;
            const source = t('ws.assemble.presetPeek.source', { order, title });
            return (
              <dd key={index} className={index ? 'is-overridden' : undefined}>
                <small>{index ? t('ws.assemble.presetPeek.overridden', { source }) : source}</small>
                {index ? <del>{text}</del> : text}
              </dd>
            );
          })}
        </div>
      ))}
    </dl>
  );
}
