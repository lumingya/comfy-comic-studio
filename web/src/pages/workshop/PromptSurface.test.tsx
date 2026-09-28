import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import {
  PromptSurface,
  applyCompletion,
  completionCandidates,
  completionQueryAt,
  hasUnclosedBrace,
  rankCompletions,
  variableReport,
  variableUsage,
  type KnownVariables,
  type PromptSources,
} from './PromptSurface';

const known: KnownVariables = new Map([
  ['character', true],
  ['outfit', false],
  ['style', true],
]);
const sources: PromptSources = new Map([
  ['character', [{ title: '七海', value: 'nanami, short hair' }]],
  ['outfit', [{ title: '七海', value: '' }]],
  [
    'style',
    [
      { title: '七海', value: 'anime' },
      { title: '画风', value: 'watercolor' },
    ],
  ],
]);

describe('variable report', () => {
  it('splits unique names by state and detects unclosed braces', () => {
    const r = variableReport('{character}, {outfit}, {天气}, {character}, {{escaped}}', known);
    expect(r.names).toEqual(['character', 'outfit', '天气']);
    expect(r.defined).toEqual(['character']);
    expect(r.empty).toEqual(['outfit']);
    expect(r.unknown).toEqual(['天气']);
    expect(hasUnclosedBrace('{char')).toBe(true);
    expect(hasUnclosedBrace('{{knees up}}')).toBe(false);
    expect(variableUsage(['{a} {b}', '{a}']).get('a')).toBe(2);
  });
});

describe('completion', () => {
  it('finds the open token at the caret, never inside {{ groups or escapes', () => {
    expect(completionQueryAt('1girl, {cha', 11)).toEqual({
      start: 7,
      end: 11,
      query: 'cha',
      closed: false,
    });
    expect(completionQueryAt('{', 1)).toEqual({ start: 0, end: 1, query: '', closed: false });
    expect(completionQueryAt('{cha}', 4)?.closed).toBe(true);
    expect(completionQueryAt('{{cha', 5)).toBeNull();
    expect(completionQueryAt('\\{cha', 5)).toBeNull();
    expect(completionQueryAt('{cha', 2)).toBeNull(); // caret inside the name
    expect(completionQueryAt('plain', 5)).toBeNull();
  });

  it('ranks prefix matches first and lists names used but undefined', () => {
    const used = variableUsage(['{character} {天气}']);
    const items = completionCandidates(known, sources, used);
    expect(items.map((i) => i.key).sort()).toEqual(['character', 'outfit', 'style', '天气']);
    expect(items.find((i) => i.key === '天气')).toMatchObject({ state: 'unknown', used: 1 });
    expect(items.find((i) => i.key === 'style')?.sources).toHaveLength(2);
    expect(rankCompletions(items, 'c').map((i) => i.key)).toEqual(['character']);
    expect(rankCompletions(items, '').map((i) => i.key)).toEqual([
      'character',
      'style',
      'outfit',
      '天气',
    ]);
    expect(rankCompletions(items, 'zzz')).toEqual([]);
  });

  it('replaces the token and reuses an existing closing brace', () => {
    expect(
      applyCompletion('a {cha b', { start: 2, end: 6, query: 'cha', closed: false }, 'character'),
    ).toEqual({ text: 'a {character} b', caret: 13 });
    expect(
      applyCompletion('{cha}', { start: 0, end: 4, query: 'cha', closed: true }, 'character'),
    ).toEqual({ text: '{character}', caret: 11 });
  });
});

function Harness() {
  const [value, setValue] = useState('');
  return <PromptSurface id="p" value={value} onChange={setValue} known={known} sources={sources} />;
}

describe('<PromptSurface>', () => {
  it('keeps the summary foot as a sibling of the surface and marks every state', () => {
    render(
      <PromptSurface
        id="p"
        value="{character}, {outfit}, {天气"
        onChange={() => {}}
        known={known}
      />,
    );
    const area = document.getElementById('p')!;
    const surface = area.closest('.prompt-surface')!;
    expect(surface.querySelector('.prompt-editor-foot')).toBeNull();
    expect(surface.nextElementSibling).toHaveClass('prompt-editor-foot');
    expect(screen.getByText('识别到 2 个变量 · 1 个值为空（outfit）')).toBeInTheDocument();
    expect(screen.getByText('变量花括号尚未闭合；提示词权重写法可忽略。')).toBeVisible();
    expect(
      [...surface.querySelectorAll('mark')].map((m) => (m as HTMLElement).dataset.state),
    ).toEqual(['defined', 'empty']);
  });

  it('opens the listbox on "{", moves with arrows and completes with Enter', () => {
    render(<Harness />);
    const area = document.getElementById('p') as HTMLTextAreaElement;
    fireEvent.change(area, { target: { value: '1girl, {' } });
    const list = screen.getByRole('listbox', { name: '变量补全' });
    const options = () => [...list.querySelectorAll('[role=option]')].map((o) => o.textContent);
    expect(options()[0]).toContain('{character}');
    expect(options()[0]).toContain('七海');
    expect(area).toHaveAttribute('aria-expanded', 'true');
    fireEvent.keyDown(area, { key: 'ArrowDown' });
    expect(list.querySelector('[role=option].active')?.textContent).toContain('{style}');
    expect(list.querySelector('[role=option].active')?.textContent).toContain('2 个预设');
    fireEvent.keyDown(area, { key: 'Enter' });
    expect(area).toHaveValue('1girl, {style}');
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('filters by prefix and closes on Escape without touching the text', () => {
    render(<Harness />);
    const area = document.getElementById('p') as HTMLTextAreaElement;
    fireEvent.change(area, { target: { value: '{ou' } });
    const list = screen.getByRole('listbox');
    expect([...list.querySelectorAll('[role=option]')]).toHaveLength(1);
    expect(list.querySelector('[role=option]')).toHaveClass('state-empty');
    fireEvent.keyDown(area, { key: 'Escape' });
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(area).toHaveValue('{ou');
    fireEvent.change(area, { target: { value: '{zzz' } });
    expect(screen.queryByRole('listbox')).toBeNull();
  });
});
