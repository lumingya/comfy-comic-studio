import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { WorkflowConfig, WorkflowDocument } from '../../api/types';
import { configSummary, configWorkflow, configurationRoutes } from '../../test/configuration';
import { mockFetch, renderWithProviders } from '../../test/utils';
import { workflowLoras } from '../../test/workflowLoras';
import { WorkflowEditor } from './WorkflowEditor';

afterEach(() => vi.unstubAllGlobals());

function document(): WorkflowDocument {
  const doc = structuredClone(configWorkflow);
  doc.config.slot_overrides = {
    model: 'custom.safetensors',
    loras: [{ key: 'extra', name: 'extra.safetensors', strength: 0.8, clip: 0.2 }],
    groups: [
      {
        key: 'group',
        note: 'preserve metadata',
        loras: [
          { key: 'shade', name: 'shade.safetensors', enabled: false, strength: 0.9, clip: 0.3 },
        ],
      },
      {
        key: 'other',
        loras: [{ key: 'other-lora', name: 'other.safetensors', enabled: false }],
      },
    ],
    unpin: ['old.safetensors'],
  };
  doc.lora_controls = structuredClone(workflowLoras);
  Object.assign(doc.lora_controls.groups[0].loras[1], {
    enabled: false,
    strength: 0.9,
    clip: 0.3,
  });
  return doc;
}

function mount(initial = document()) {
  let current = initial;
  const calls = mockFetch(
    configurationRoutes({
      'GET /api/workflows/wf_demo': () => current,
      'GET /api/workflows': [configSummary],
      'PATCH /api/workflows/wf_demo': (body: unknown) => {
        const patch = body as { name: string; notes: string; config: WorkflowConfig };
        const groups = (patch.config.slot_overrides?.groups ?? []) as {
          key: string;
          loras: Record<string, unknown>[];
        }[];
        current = {
          ...current,
          ...patch,
          lora_controls: {
            ...initial.lora_controls!,
            groups: initial.lora_controls!.groups.map((group) => ({
              ...group,
              loras: group.loras.map((source) => ({
                ...source,
                ...groups
                  .find(({ key }) => key === group.key)
                  ?.loras.find(({ key }) => key === source.key),
              })),
            })),
          },
        };
        return current;
      },
    }),
  );
  renderWithProviders(<WorkflowEditor id="wf_demo" onDirty={vi.fn()} />);
  return { calls, saved: () => current };
}

async function controls() {
  fireEvent.click(await screen.findByText('工作流默认 LoRA'));
  return screen.findByRole('region', { name: '工作流默认 LoRA' });
}
const toggle = (region: HTMLElement, name = 'ink') =>
  within(region).getByRole('checkbox', { name: `启用 ${name}.safetensors` });

describe('workflow default LoRAs', () => {
  it('saves keyed defaults without changing the graph, other slots or the original controls', async () => {
    const doc = document();
    const original = structuredClone(doc);
    const { calls, saved } = mount(doc);
    const region = await controls();
    const strength = within(region).getByRole('spinbutton', {
      name: 'ink.safetensors 模型强度',
    });
    const clip = within(region).getByRole('spinbutton', { name: 'ink.safetensors CLIP 强度' });
    fireEvent.change(strength, { target: { value: '1.15' } });
    fireEvent.change(clip, { target: { value: '0.35' } });
    fireEvent.click(toggle(region));
    expect(toggle(region)).not.toBeChecked();
    expect(strength).toHaveValue(1.15);
    expect(clip).toHaveValue(0.35);
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    await waitFor(() => expect(screen.queryByRole('button', { name: '保存' })).toBeNull());
    const writes = calls.filter(({ method }) => method === 'PATCH');
    expect(writes).toHaveLength(1);
    expect(writes[0].body).toEqual({
      name: original.name,
      notes: original.notes,
      config: {
        ...original.config,
        slot_overrides: {
          ...original.config.slot_overrides,
          groups: [
            {
              key: 'group',
              note: 'preserve metadata',
              loras: [
                {
                  key: 'shade',
                  name: 'shade.safetensors',
                  enabled: false,
                  strength: 0.9,
                  clip: 0.3,
                },
                { key: 'ink', name: 'ink.safetensors', strength: 1.15, clip: 0.35, enabled: false },
              ],
            },
            {
              key: 'other',
              loras: [{ key: 'other-lora', name: 'other.safetensors', enabled: false }],
            },
          ],
        },
      },
    });
    expect(saved().graph).toEqual(original.graph);
    expect(doc).toEqual(original);

    // Cancel must use the new saved response, including its effective control values.
    fireEvent.click(toggle(region));
    fireEvent.change(strength, { target: { value: '0.5' } });
    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    expect(toggle(region)).not.toBeChecked();
    expect(strength).toHaveValue(1.15);
    expect(clip).toHaveValue(0.35);
    expect(calls.filter(({ method }) => method === 'PATCH')).toHaveLength(1);
  });

  it('restores saved group defaults while retaining unrelated draft changes', async () => {
    const original = document();
    const { calls } = mount(original);
    const region = await controls();
    fireEvent.change(screen.getByLabelText('名称'), { target: { value: 'New name' } });
    fireEvent.click(toggle(region));
    fireEvent.click(toggle(region, 'shade'));
    fireEvent.change(
      within(region).getByRole('spinbutton', { name: 'shade.safetensors CLIP 强度' }),
      { target: { value: '0.7' } },
    );
    fireEvent.click(within(region).getByRole('button', { name: '恢复已保存的默认值' }));
    expect(toggle(region)).toBeChecked();
    expect(toggle(region, 'shade')).not.toBeChecked();
    expect(
      within(region).getByRole('spinbutton', { name: 'shade.safetensors CLIP 强度' }),
    ).toHaveValue(0.3);
    expect(screen.getByLabelText('名称')).toHaveValue('New name');
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    await waitFor(() =>
      expect(calls.find(({ method }) => method === 'PATCH')?.body).toEqual({
        name: 'New name',
        notes: original.notes,
        config: original.config,
      }),
    );
  });

  it('returns to a clean form when a new default override is toggled back', async () => {
    const doc = document();
    delete doc.config.slot_overrides;
    const { calls } = mount(doc);
    const region = await controls();
    fireEvent.click(toggle(region));
    expect(screen.getByRole('button', { name: '保存' })).toBeEnabled();
    fireEvent.click(toggle(region));
    expect(screen.queryByRole('button', { name: '保存' })).toBeNull();
    expect(calls.some(({ method }) => method === 'PATCH')).toBe(false);
  });
});
