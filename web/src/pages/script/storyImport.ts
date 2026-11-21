import type { Dialogue } from '../../api/types';

export interface StoryCharacter {
  id: string;
  name: string;
}

export interface StorySegment {
  title: string;
  description: string;
  dialogues: Dialogue[];
}

const chapterHeading =
  /^第\s*[零〇一二三四五六七八九十百千万\d]+\s*(?:幕|话|場|场|节)(?:\s*[:：.、—-]\s*|\s+)?(.*)$/u;

function heading(line: string): string | null {
  const markdown = line.match(/^#{1,6}\s+(.+?)\s*#*$/u);
  if (markdown) return markdown[1].trim();
  const chapter = line.match(chapterHeading);
  if (!chapter) return null;
  return chapter[1].trim() || line.trim();
}

function dialogue(line: string, characters: StoryCharacter[]): Dialogue | null {
  const content = line.replace(/^>\s?/, '').trim();
  const speakerLine = content.match(/^\*{0,2}([^:：]{1,32}?)\*{0,2}\s*[:：]\s*(.+)$/u);
  if (speakerLine) {
    const label = speakerLine[1].trim();
    const text = speakerLine[2].trim();
    if (!text) return null;
    const character = characters.find((item) => item.name === label);
    if (character)
      return { speaker_id: character.id, text, kind: 'speech', bridge: false } as Dialogue;
    const kind =
      label === '心声' || label === '内心' || label === '内心独白'
        ? 'thought'
        : label === '旁白' || label === '叙述'
          ? 'narration'
          : label === '拟声' || label === '音效'
            ? 'sfx'
            : label === '对白' || label === '台词'
              ? 'speech'
              : null;
    if (kind) return { speaker_id: null, text, kind, bridge: false } as Dialogue;
  }
  const quoted = content.match(/^[「“"](.+)[」”"]$/u);
  return quoted
    ? ({ speaker_id: null, text: quoted[1], kind: 'speech', bridge: false } as Dialogue)
    : null;
}

function titleFrom(title: string, description: string, dialogues: Dialogue[]): string {
  if (title) return title;
  const first = (description || dialogues[0]?.text || '').split(/\r?\n/u)[0];
  const oneLine = first.replace(/\s+/gu, ' ').trim();
  return oneLine.length > 42 ? `${oneLine.slice(0, 41)}…` : oneLine;
}

/** Split local story text on blank paragraphs and explicit Markdown / 第X幕 headings. */
export function splitStoryText(text: string, characters: StoryCharacter[] = []): StorySegment[] {
  const result: StorySegment[] = [];
  let currentTitle = '';
  let lines: string[] = [];

  const flush = () => {
    const content = lines.map((line) => line.trim()).filter(Boolean);
    if (!currentTitle && !content.length) return;
    const dialogues: Dialogue[] = [];
    const description: string[] = [];
    for (const line of content) {
      const parsed = dialogue(line, characters);
      if (parsed) dialogues.push(parsed);
      else description.push(line.replace(/^>\s?/, '').trim());
    }
    const body = description.join('\n').trim();
    result.push({
      title: titleFrom(currentTitle, body, dialogues),
      description: body,
      dialogues,
    });
    currentTitle = '';
    lines = [];
  };

  for (const raw of text.replace(/\r\n?/gu, '\n').split('\n')) {
    const line = raw.trim();
    if (!line) {
      if (lines.length) flush();
      continue;
    }
    const nextTitle = heading(line);
    if (nextTitle !== null) {
      flush();
      currentTitle = nextTitle;
    } else lines.push(line);
  }
  flush();
  return result;
}

/** Convert a preview into the small partial-panel shape accepted by the panel import API. */
export function storySegmentsToPanels(segments: StorySegment[]): Record<string, unknown>[] {
  return segments.map((segment) => ({
    description: segment.title,
    dialogues: segment.dialogues,
    overrides: { raw_prompt: null, append_prompt: segment.description },
  }));
}
