/** Legacy createFramesBatch / suggestStoryBasePrompt (assembly-workshop.js), shared by 批量新增分幕. */

/** Legacy cap on the frames of one storyboard. */
export const MAX_FRAMES = 512;
export const DEFAULT_NAME_PATTERN = '第 {n} 幕';

/**
 * The comma-separated segments every non-empty prompt starts with, e.g.
 * `"{character}, {outfit}, {style}, "`; '' when fewer than two prompts or nothing is shared.
 */
export function suggestBasePrompt(prompts: string[]): string {
  const list = prompts.map((p) => p.trim()).filter(Boolean);
  if (list.length < 2) return '';
  const split = (text: string) => text.split(/,\s*/);
  const first = split(list[0]);
  let common = first.length;
  for (const prompt of list.slice(1)) {
    const parts = split(prompt);
    let i = 0;
    while (i < common && i < parts.length && parts[i] === first[i]) i += 1;
    common = i;
    if (!common) return '';
  }
  // A prompt that is entirely shared (no trailing segment) still counts, minus an empty tail.
  const shared = first.slice(0, common).filter((part, i) => part || i < common - 1);
  return shared.length ? `${shared.join(', ')}, ` : '';
}

/** `count` new frames numbered after `start` existing ones; `{n}` in the pattern is 1-based. */
export function framesBatch({
  count,
  start,
  namePattern,
  basePrompt,
}: {
  count: number;
  start: number;
  namePattern: string;
  basePrompt: string;
}) {
  const total = Math.max(0, Math.min(Math.floor(count) || 0, MAX_FRAMES - start));
  const pattern = namePattern.trim() || DEFAULT_NAME_PATTERN;
  return Array.from({ length: total }, (_, offset) => ({
    description: pattern.replace(/\{n\}/g, String(start + offset + 1)),
    overrides: { raw_prompt: basePrompt },
  }));
}
