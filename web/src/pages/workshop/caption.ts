import type { Panel } from '../../api/types';
type Lines = Panel['dialogues'];
export const captionText = (lines: Lines) =>
  lines.find((line) => line.kind === 'narration')?.text ?? lines[0]?.text ?? '';
/** The field edits the line it displays; keep other speakers, kinds and bridge metadata intact. */
export function replaceCaption(lines: Lines, value: string): Lines {
  const narration = lines.findIndex((line) => line.kind === 'narration');
  const at = narration >= 0 ? narration : lines.length ? 0 : -1;
  if (at < 0)
    return value.trim()
      ? [{ text: value, kind: 'narration', bridge: false, speaker_id: null }]
      : [];
  return lines.flatMap((line, index) =>
    index !== at ? [line] : value.trim() ? [{ ...line, text: value }] : [],
  );
}
