import { describe, expect, it } from 'vitest';
import { splitStoryText, storySegmentsToPanels } from './storyImport';

describe('splitStoryText', () => {
  it('splits paragraphs and recognizes Markdown and 第X幕 headings', () => {
    const frames = splitStoryText(
      '## 雨停以后\n街灯映在积水里。\n林夏：信会寄到吗？\n\n第2幕 清晨\n邮筒里多了一封信。',
      [{ id: 'char-linxia', name: '林夏' }],
    );
    expect(frames).toEqual([
      {
        title: '雨停以后',
        description: '街灯映在积水里。',
        dialogues: [
          { speaker_id: 'char-linxia', text: '信会寄到吗？', kind: 'speech', bridge: false },
        ],
      },
      { title: '清晨', description: '邮筒里多了一封信。', dialogues: [] },
    ]);
  });

  it('accepts CRLF, multiline paragraphs, dialogue labels and quoted speech', () => {
    const frames = splitStoryText(
      '夜色落下，窗边亮起一盏灯。\r\n她把信放在桌上。\r\n旁白：多年以后。\r\n> “我回来了。”\r\n\r\n一切重新开始。',
    );
    expect(frames).toHaveLength(2);
    expect(frames[0]).toMatchObject({
      title: '夜色落下，窗边亮起一盏灯。',
      description: '夜色落下，窗边亮起一盏灯。\n她把信放在桌上。',
      dialogues: [
        { text: '多年以后。', kind: 'narration', speaker_id: null },
        { text: '我回来了。', kind: 'speech', speaker_id: null },
      ],
    });
    expect(frames[1]).toMatchObject({ title: '一切重新开始。', description: '一切重新开始。' });
  });

  it('keeps an unknown name-prefix as visual description and ignores empty text', () => {
    expect(splitStoryText('未知角色：不是已知台词\n\n   ')).toEqual([
      {
        title: '未知角色：不是已知台词',
        description: '未知角色：不是已知台词',
        dialogues: [],
      },
    ]);
    expect(splitStoryText(' \n\n')).toEqual([]);
  });
});

describe('storySegmentsToPanels', () => {
  it('imports descriptions as appended prompts and preserves dialogue', () => {
    const panels = storySegmentsToPanels([
      {
        title: '清晨',
        description: '薄雾从河面升起。',
        dialogues: [{ speaker_id: 'char-a', text: '早上好。', kind: 'speech', bridge: false }],
      },
    ]);
    expect(panels).toEqual([
      {
        description: '清晨',
        dialogues: [{ speaker_id: 'char-a', text: '早上好。', kind: 'speech', bridge: false }],
        overrides: { raw_prompt: null, append_prompt: '薄雾从河面升起。' },
      },
    ]);
  });
});
