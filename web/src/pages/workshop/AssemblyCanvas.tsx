import { useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { useTranslation } from 'react-i18next';
import type { Preset } from '../../api/workshop';
import { Icon } from '../../app/icons';

/** One storyboard on the board: it becomes one standby task named `title`. */
export interface StoryNode {
  id: string;
  storyId: string;
  title: string;
  x: number;
  y: number;
}
/** One preset on the board; it can feed any number of storyboards. */
export interface PresetNode {
  id: string;
  presetId: string;
  x: number;
  y: number;
}
export interface Edge {
  story: string;
  preset: string;
}
export interface CanvasDesign {
  stories: StoryNode[];
  presets: PresetNode[];
  edges: Edge[];
}
export const EMPTY_DESIGN: CanvasDesign = { stories: [], presets: [], edges: [] };

const NODE_W = 244;
const PORT_Y = 64;
const WORLD_W = 1180;
let seq = 0;
const nodeId = () => `node_${Date.now().toString(36)}_${(seq += 1)}`;

/**
 * The standby tasks a design produces: one per storyboard node, merging every preset linked to it
 * in the order the preset cards were added (no cartesian product). Throws a readable message when
 * a node has no preset or no name. Exported for tests.
 */
export function canvasTasks(d: CanvasDesign, messages: { empty: string; unlinked: string }) {
  if (!d.stories.length) throw new Error(messages.empty);
  return d.stories.map((s) => {
    const presetIds = d.presets
      .filter((p) => d.edges.some((e) => e.story === s.id && e.preset === p.id))
      .map((p) => p.presetId);
    if (!presetIds.length || !s.title.trim())
      throw new Error(messages.unlinked.replace('{{title}}', s.title || '—'));
    return { storyboard_id: s.storyId, preset_ids: presetIds, title: s.title.trim() };
  });
}

type Drag =
  | { kind: 'move'; id: string; x: number; y: number; ox: number; oy: number }
  | { kind: 'link'; id: string; point: { x: number; y: number } | null };

/**
 * 画布连线 (legacy assembly designer canvas mode): drop storyboards and presets on a board and
 * wire them; every storyboard node becomes one standby task using all the presets linked to it.
 */
export function AssemblyCanvas({
  design,
  onChange,
  boards,
  presets,
}: {
  design: CanvasDesign;
  onChange: (next: CanvasDesign) => void;
  boards: readonly { id?: string; title: string; panel_count?: number }[];
  presets: readonly Preset[];
}) {
  const { t } = useTranslation();
  const world = useRef<HTMLDivElement>(null);
  const [storyChoice, setStoryChoice] = useState('');
  const [presetChoice, setPresetChoice] = useState('');
  const [drag, setDrag] = useState<Drag | null>(null);
  const d = design;
  const height = Math.max(700, Math.max(d.stories.length, d.presets.length) * 180 + 70);
  const boardTitle = (id: string) => boards.find((b) => b.id === id)?.title ?? t('ws.canvas.story');
  const presetOf = (id: string) => presets.find((p) => p.id === id);

  const addStory = () => {
    const id = storyChoice || boards[0]?.id;
    if (!id) return;
    onChange({
      ...d,
      stories: [
        ...d.stories,
        {
          id: nodeId(),
          storyId: id,
          title: t('ws.canvas.newAlbum', { title: boardTitle(id) }),
          x: 35,
          y: 30 + d.stories.length * 180,
        },
      ],
    });
  };
  const addPreset = () => {
    const id = presetChoice || presets[0]?.id;
    if (!id || d.presets.some((p) => p.presetId === id)) return;
    onChange({
      ...d,
      presets: [
        ...d.presets,
        { id: nodeId(), presetId: id, x: 760, y: 30 + d.presets.length * 180 },
      ],
    });
  };
  const remove = (id: string) =>
    onChange({
      stories: d.stories.filter((n) => n.id !== id),
      presets: d.presets.filter((n) => n.id !== id),
      edges: d.edges.filter((e) => e.story !== id && e.preset !== id),
    });
  const link = (story: string, preset: string) => {
    setDrag(null);
    if (d.edges.some((e) => e.story === story && e.preset === preset)) return;
    onChange({ ...d, edges: [...d.edges, { story, preset }] });
  };
  const unlink = (story: string, preset: string) =>
    onChange({ ...d, edges: d.edges.filter((e) => !(e.story === story && e.preset === preset)) });

  const local = (e: { clientX: number; clientY: number }) => {
    const r = world.current?.getBoundingClientRect();
    return r ? { x: e.clientX - r.left, y: e.clientY - r.top } : { x: 0, y: 0 };
  };
  const onMove = (e: ReactPointerEvent) => {
    if (!drag) return;
    if (drag.kind === 'link') return setDrag({ ...drag, point: local(e) });
    const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
    const x = clamp(drag.ox + e.clientX - drag.x, 12, WORLD_W - NODE_W - 16);
    const y = clamp(drag.oy + e.clientY - drag.y, 12, height - 165);
    onChange({
      ...d,
      stories: d.stories.map((n) => (n.id === drag.id ? { ...n, x, y } : n)),
      presets: d.presets.map((n) => (n.id === drag.id ? { ...n, x, y } : n)),
    });
  };
  const onUp = (e: ReactPointerEvent) => {
    if (drag?.kind !== 'link') return setDrag(null);
    // Dropped on a preset port: link. Released on the port itself: keep it armed for a click.
    const el = document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null;
    const target = el?.closest<HTMLElement>('[data-port-preset]')?.dataset.portPreset;
    if (target) link(drag.id, target);
    else if (!el?.closest(`[data-port-story="${drag.id}"]`)) setDrag(null);
  };
  const startMove = (e: ReactPointerEvent, n: StoryNode | PresetNode) => {
    if ((e.target as HTMLElement).closest('button')) return;
    e.preventDefault();
    setDrag({ kind: 'move', id: n.id, x: e.clientX, y: e.clientY, ox: n.x, oy: n.y });
  };
  const curve = (a: { x: number; y: number }, b: { x: number; y: number }) =>
    `M ${a.x} ${a.y} C ${a.x + 110} ${a.y}, ${b.x - 110} ${b.y}, ${b.x} ${b.y}`;
  const armed = drag?.kind === 'link' ? d.stories.find((n) => n.id === drag.id) : undefined;

  return (
    <>
      <div className="canvas-toolbar">
        <label>
          {t('ws.canvas.story')}
          <select
            id="canvas-story-choice"
            value={storyChoice || boards[0]?.id || ''}
            onChange={(e) => setStoryChoice(e.target.value)}
          >
            {boards.map((b) => (
              <option key={b.id} value={b.id}>
                {b.title}
              </option>
            ))}
          </select>
        </label>
        <button type="button" className="btn" disabled={!boards.length} onClick={addStory}>
          <Icon name="plus" sm />
          {t('ws.canvas.addStory')}
        </button>
        <label>
          {t('ws.canvas.preset')}
          <select
            id="canvas-preset-choice"
            value={presetChoice || presets[0]?.id || ''}
            onChange={(e) => setPresetChoice(e.target.value)}
          >
            {presets.map((p) => (
              <option key={p.id} value={p.id}>
                {p.title}
              </option>
            ))}
          </select>
        </label>
        <button type="button" className="btn" disabled={!presets.length} onClick={addPreset}>
          <Icon name="plus" sm />
          {t('ws.canvas.addPreset')}
        </button>
      </div>
      <p className="help">{t('ws.canvas.help')}</p>
      <div className="link-board">
        <div
          className="link-world"
          ref={world}
          style={{ height }}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerLeave={() => drag?.kind === 'move' && setDrag(null)}
        >
          <svg
            className="link-lines"
            width={WORLD_W}
            height={height}
            aria-label={t('ws.canvas.lines')}
          >
            {d.edges.map((e, i) => {
              const a = d.stories.find((n) => n.id === e.story);
              const b = d.presets.find((n) => n.id === e.preset);
              return a && b ? (
                <path
                  key={`${e.story}-${e.preset}`}
                  tabIndex={0}
                  role="button"
                  aria-label={t('ws.canvas.unlink', { n: i + 1 })}
                  d={curve({ x: a.x + NODE_W, y: a.y + PORT_Y }, { x: b.x, y: b.y + PORT_Y })}
                  onClick={() => unlink(e.story, e.preset)}
                  onKeyDown={(k) => {
                    if (k.key === 'Enter' || k.key === 'Delete' || k.key === 'Backspace')
                      unlink(e.story, e.preset);
                  }}
                />
              ) : null;
            })}
            {armed && drag?.kind === 'link' && drag.point ? (
              <path
                className="pending"
                d={curve({ x: armed.x + NODE_W, y: armed.y + PORT_Y }, drag.point)}
              />
            ) : null}
          </svg>
          {d.stories.map((n) => (
            <section
              key={n.id}
              className="link-node story-node"
              data-node={n.id}
              style={{ left: n.x, top: n.y }}
            >
              <header onPointerDown={(e) => startMove(e, n)}>
                <Icon name="story" />
                <strong>{boardTitle(n.storyId)}</strong>
                <button
                  type="button"
                  className="ibtn"
                  aria-label={t('ws.canvas.removeStory')}
                  title={t('ws.canvas.removeStory')}
                  onClick={() => remove(n.id)}
                >
                  <Icon name="close" sm />
                </button>
              </header>
              <label>
                {t('ws.canvas.outputName')}
                <input
                  value={n.title}
                  maxLength={150}
                  onChange={(e) =>
                    onChange({
                      ...d,
                      stories: d.stories.map((x) =>
                        x.id === n.id ? { ...x, title: e.target.value } : x,
                      ),
                    })
                  }
                />
              </label>
              <button
                type="button"
                className="node-port output"
                data-port-story={n.id}
                aria-pressed={drag?.kind === 'link' && drag.id === n.id}
                aria-label={t('ws.canvas.portStory', { title: n.title })}
                onPointerDown={(e) => {
                  e.preventDefault();
                  setDrag({ kind: 'link', id: n.id, point: null });
                }}
              />
            </section>
          ))}
          {d.presets.map((n) => {
            const p = presetOf(n.presetId);
            return (
              <section
                key={n.id}
                className="link-node preset-node"
                data-node={n.id}
                style={{ left: n.x, top: n.y }}
              >
                <header onPointerDown={(e) => startMove(e, n)}>
                  <Icon name="box" />
                  <strong>{p?.title ?? t('ws.canvas.preset')}</strong>
                  <button
                    type="button"
                    className="ibtn"
                    aria-label={t('ws.canvas.removePreset')}
                    title={t('ws.canvas.removePreset')}
                    onClick={() => remove(n.id)}
                  >
                    <Icon name="close" sm />
                  </button>
                </header>
                <p>{t('ws.canvas.presetNote', { count: p?.entries.length ?? 0 })}</p>
                <button
                  type="button"
                  className="node-port input"
                  data-port-preset={n.id}
                  aria-label={t('ws.canvas.portPreset', { title: p?.title ?? '' })}
                  onClick={() => armed && link(armed.id, n.id)}
                />
              </section>
            );
          })}
        </div>
      </div>
      <details className="canvas-accessible">
        <summary>{t('ws.canvas.checklist')}</summary>
        {d.stories.map((s) => (
          <fieldset key={s.id}>
            <legend>{s.title}</legend>
            {d.presets.map((p) => {
              const on = d.edges.some((e) => e.story === s.id && e.preset === p.id);
              return (
                <label key={p.id}>
                  <input
                    type="checkbox"
                    checked={on}
                    onChange={() => (on ? unlink(s.id, p.id) : link(s.id, p.id))}
                  />
                  {presetOf(p.presetId)?.title}
                </label>
              );
            })}
          </fieldset>
        ))}
      </details>
      <p className="help">
        {t('ws.canvas.summary', { stories: d.stories.length, edges: d.edges.length })}
      </p>
    </>
  );
}
