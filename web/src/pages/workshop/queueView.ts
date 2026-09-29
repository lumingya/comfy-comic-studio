/** Pure helpers of the 装配队列 page (legacy productionPaging / productionQueueControls / productionHeadline). */

export const PAGE_SIZE = 6;

/** Card order: the server's order first, then albums it does not list yet, oldest first (new ones at the end). */
export function orderByQueue<T>(
  items: T[],
  order: string[] | undefined,
  id: (item: T) => string,
  created: (item: T) => string,
): T[] {
  const rank = new Map((order ?? []).map((x, i) => [x, i]));
  return [...items].sort((a, b) => {
    const ra = rank.get(id(a));
    const rb = rank.get(id(b));
    if (ra !== undefined && rb !== undefined) return ra - rb;
    if (ra !== undefined) return -1;
    if (rb !== undefined) return 1;
    return created(a).localeCompare(created(b));
  });
}

/** Move `id` before or after `target`; returns the new order, or null when nothing changes. */
export function moveId(
  order: string[],
  id: string,
  target: string,
  after: boolean,
): string[] | null {
  const from = order.indexOf(id);
  if (from < 0 || id === target) return null;
  const next = order.filter((x) => x !== id);
  let to = next.indexOf(target);
  if (to < 0) return null;
  if (after) to += 1;
  next.splice(to, 0, id);
  return next.join('\n') === order.join('\n') ? null : next;
}

/** Up / down / first / last (legacy 调整顺序). */
export function shiftId(
  order: string[],
  id: string,
  to: 'up' | 'down' | 'first' | 'last',
): string[] | null {
  const i = order.indexOf(id);
  if (i < 0) return null;
  const j = to === 'up' ? i - 1 : to === 'down' ? i + 1 : to === 'first' ? 0 : order.length - 1;
  if (j < 0 || j >= order.length || j === i) return null;
  const next = order.filter((x) => x !== id);
  next.splice(j, 0, id);
  return next;
}

export interface Paging {
  index: number;
  pages: number;
  start: number;
  end: number;
}

/** `page` null = the newest (last) page, as the legacy queue opened. */
export function paging(total: number, page: number | null, size = PAGE_SIZE): Paging {
  const pages = Math.max(1, Math.ceil(total / size));
  const index = Math.min(pages - 1, Math.max(0, page ?? pages - 1));
  return { index, pages, start: index * size, end: Math.min(total, (index + 1) * size) };
}

/** Page buttons with gaps (null) once there are more than seven pages. */
export function pageNumbers(index: number, pages: number): (number | null)[] {
  if (pages <= 7) return Array.from({ length: pages }, (_, i) => i);
  const wanted = new Set([0, pages - 1, index - 1, index, index + 1]);
  if (index < 3) [1, 2, 3].forEach((i) => wanted.add(i));
  if (index > pages - 4) [pages - 4, pages - 3, pages - 2].forEach((i) => wanted.add(i));
  const list = [...wanted].filter((i) => i >= 0 && i < pages).sort((a, b) => a - b);
  return list.flatMap((i, k) => (k && i - list[k - 1] > 1 ? [null, i] : [i]));
}

export interface QueueCounts {
  /** Albums with an active job (paused ones included). */
  running: number;
  /** Albums waiting in the sequential lane. */
  queued: number;
  /** Albums whose job is paused. */
  heldBooks: number;
  /** The lane is held. */
  lanePaused: boolean;
}

export type HeadlineTitle = 'idle' | 'held' | 'many' | 'one' | 'standby';

/** Legacy productionHeadline: 等待你的安排 / 队列已暂停 / 正在同时生成 n 本 / 正在生成一本 / 队列待命. */
export function headlineTitle(c: QueueCounts): HeadlineTitle {
  const pending = c.running + c.queued > 0;
  const held = c.heldBooks > 0 || (c.queued > 0 && c.lanePaused);
  const active = c.running - c.heldBooks;
  if (!pending) return 'idle';
  if (held && !active) return 'held';
  if (active > 1) return 'many';
  if (active) return 'one';
  return 'standby';
}

export interface OverridePart {
  kind: 'model' | 'lora' | 'noLora' | 'unpin';
  key?: string;
  name: string;
  strength?: number;
  title: string;
}

/** File stem of a model / LoRA path (legacy WorkflowSlots.loraStem). */
export function stem(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? name;
  return base.replace(/\.(safetensors|ckpt|pt|pth|bin|gguf)$/i, '');
}

/** Legacy productionOverridesSummary: the model and LoRA choices the task's image service applies. */
export function overridesSummary(o: Record<string, unknown> | null | undefined): OverridePart[] {
  if (!o || typeof o !== 'object') return [];
  const parts: OverridePart[] = [];
  const models: [string, unknown][] =
    typeof o.model === 'string'
      ? [['', o.model]]
      : o.model && typeof o.model === 'object'
        ? Object.entries(o.model as Record<string, unknown>)
        : [];
  for (const [key, name] of models)
    if (typeof name === 'string' && name)
      parts.push({
        kind: 'model',
        key: key || undefined,
        name: stem(name),
        title: key ? `${key} → ${name}` : name,
      });
  const loras = Array.isArray(o.loras)
    ? (o.loras as { name?: unknown; strength?: unknown }[]).filter(
        (l) => l && typeof l.name === 'string' && l.name,
      )
    : null;
  if (loras) {
    if (!loras.length) parts.push({ kind: 'noLora', name: '', title: '' });
    for (const l of loras)
      parts.push({
        kind: 'lora',
        name: stem(l.name as string),
        strength: typeof l.strength === 'number' ? l.strength : 1,
        title: l.name as string,
      });
  }
  if (Array.isArray(o.unpin)) {
    const added = new Set((loras ?? []).map((l) => stem(l.name as string).toLowerCase()));
    const only = (o.unpin as unknown[]).filter(
      (n): n is string => typeof n === 'string' && !added.has(stem(n).toLowerCase()),
    );
    if (only.length)
      parts.push({ kind: 'unpin', name: only.map(stem).join('、'), title: only.join('\n') });
  }
  return parts;
}
