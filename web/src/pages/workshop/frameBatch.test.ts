import { describe, expect, it } from 'vitest';
import { framesBatch, suggestBasePrompt } from './frameBatch';

describe('suggestBasePrompt (legacy suggestStoryBasePrompt)', () => {
  it('returns the shared leading segments', () => {
    expect(
      suggestBasePrompt([
        '{character}, {outfit}, {style}, a quiet town',
        '{character}, {outfit}, {style}, holding a letter',
        '  ',
      ]),
    ).toBe('{character}, {outfit}, {style}, ');
  });
  it('needs two prompts that share a first segment', () => {
    expect(suggestBasePrompt(['{character}, x'])).toBe('');
    expect(suggestBasePrompt(['a, b', 'c, b'])).toBe('');
  });
  it('drops the empty tail of a prompt that ends with a comma', () => {
    expect(suggestBasePrompt(['{a}, {b}, ', '{a}, {b}, rain'])).toBe('{a}, {b}, ');
  });
});

describe('framesBatch (legacy createFramesBatch)', () => {
  it('numbers after the existing frames and prefills the template', () => {
    expect(
      framesBatch({ count: 2, start: 3, namePattern: '镜头 {n}', basePrompt: '{a}, ' }),
    ).toEqual([
      { description: '镜头 4', overrides: { raw_prompt: '{a}, ' } },
      { description: '镜头 5', overrides: { raw_prompt: '{a}, ' } },
    ]);
  });
  it('falls back to the default pattern and stops at 512 frames', () => {
    const out = framesBatch({ count: 10, start: 508, namePattern: ' ', basePrompt: '' });
    expect(out.map((f) => f.description)).toEqual([
      '第 509 幕',
      '第 510 幕',
      '第 511 幕',
      '第 512 幕',
    ]);
  });
});
