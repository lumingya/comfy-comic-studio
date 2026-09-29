import { fireEvent, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { Preset } from '../../api/workshop';
import { renderWithProviders } from '../../test/utils';
import { presetFromFile } from './files';
import { BindingDialog } from './PresetBindings';
import { bindingProblem, blankBinding, normalizeBinding, sharedTargets } from './presetBindings';

const b = (changes: object) => ({ ...blankBinding(), node_id: '12', ...changes });
const preset = (id: string, bindings: Preset['bindings']): Preset => ({
  id,
  title: id,
  groups: [],
  entries: [{ id: 'v', key: 'lora', label: 'LoRA', value: 'nanami', hint: '', group_id: null }],
  bindings,
});

describe('preset node bindings (legacy workshop-binding-save)', () => {
  it('checks what the server checks', () => {
    expect(bindingProblem(b({ node_id: ' ' }), [])).toBe('target');
    expect(bindingProblem(b({ node_id: '1 2' }), [])).toBe('node');
    expect(bindingProblem(b({ path: 'loras/*/on' }), [])).toBe('wildcard');
    expect(bindingProblem(b({ source: 'variable', value: '{}' }), [])).toBe('variable');
    expect(bindingProblem(b({ type: 'number', value: 'abc' }), [])).toBe('number');
    expect(bindingProblem(b({ type: 'number', value: '{strength}' }), [])).toBeNull();
    expect(bindingProblem(b({ type: 'boolean', value: 'maybe' }), [])).toBe('boolean');
    expect(bindingProblem(b({ type: 'json', value: '{"a":' }), [])).toBe('json');
    expect(bindingProblem(b({ path: '/lora_name/' }), [b({})])).toBe('duplicate');
    expect(bindingProblem(b({ enabled: false }), [b({})])).toBeNull();
    expect(
      normalizeBinding(b({ source: 'variable', value: ' {lora} ', path: '/x/' })),
    ).toMatchObject({ value: 'lora', path: 'x' });
  });

  it('names the other presets that bind the same input', () => {
    const a = preset('七海', [b({})]);
    const other = preset('画风', [b({})]);
    const off = preset('关闭', [b({ enabled: false })]);
    expect([...sharedTargets(a, [a, other, off])]).toEqual([['12/lora_name', ['画风']]]);
  });

  it('imports legacy bindings, keeping one enabled binding per input', () => {
    const p = presetFromFile({
      title: '旧预设',
      entries: [{ key: 'lora', value: 'x' }],
      bindings: [
        { nodeId: '12', path: 'lora_name', source: 'variable', value: '{lora}', enabled: true },
        { nodeId: '12', path: 'lora_name', source: 'literal', value: 'y', enabled: true },
        { nodeId: '3', path: 'text', source: 'positive', enabled: true },
        { nodeId: '', path: 'x', source: 'literal' },
      ],
    });
    expect(p.bindings.map((x) => [x.source, x.value, x.type, x.enabled])).toEqual([
      ['variable', 'lora', 'auto', true],
      ['literal', 'y', 'auto', false],
    ]);
  });

  it('the dialog explains a problem and saves the normalised binding', () => {
    const onSave = vi.fn();
    renderWithProviders(
      <BindingDialog preset={preset('p', [])} index="new" onSave={onSave} onClose={vi.fn()} />,
    );
    fireEvent.click(screen.getByRole('button', { name: '保存绑定' }));
    expect(screen.getByRole('alert').textContent).toBe('节点 ID 与输入路径不能为空。');
    expect(onSave).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('节点 ID'), { target: { value: ' 12 ' } });
    fireEvent.change(screen.getByLabelText('值来源'), { target: { value: 'variable' } });
    fireEvent.change(screen.getByLabelText('变量标识符'), { target: { value: '{lora}' } });
    fireEvent.click(screen.getByRole('button', { name: '保存绑定' }));
    expect(onSave).toHaveBeenCalledWith([
      {
        node_id: '12',
        path: 'lora_name',
        source: 'variable',
        type: 'text',
        value: 'lora',
        enabled: true,
      },
    ]);
  });
});
