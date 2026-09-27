import { describe, expect, it } from 'vitest';
import { insertVariable, scanVariables } from './PromptField';

describe('scanVariables', () => {
  it('classifies each {name} once, in order, like the server grammar', () => {
    const known = { character: 'short black hair', weapon: '' };
    expect(scanVariables('{character}, {weapon}, {天气}, {character}, {{escaped}}', known)).toEqual(
      [
        { name: 'character', state: 'ok' },
        { name: 'weapon', state: 'empty' },
        { name: '天气', state: 'missing' },
      ],
    );
  });

  it('ignores braces that cannot be names', () => {
    expect(scanVariables('{ spaced} {} {{x}}', {})).toEqual([]);
  });
});

describe('insertVariable', () => {
  it('appends with a comma separator when the prompt needs one', () => {
    expect(insertVariable(null, '1girl', 'style')).toEqual({ text: '1girl, {style}', caret: 14 });
    expect(insertVariable(null, '1girl, ', 'style').text).toBe('1girl, {style}');
    expect(insertVariable(null, '', 'style').text).toBe('{style}');
  });
});
