import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AssembleVars, AssemblyPreview, AssemblyVariable } from '../../api/workshop';
import { mockFetch, renderWithProviders } from '../../test/utils';
import { AssemblyReview } from './AssemblyReview';

function report(body: AssembleVars): AssemblyPreview {
  const variable = (key: string, field: string): AssemblyVariable =>
    Object.hasOwn(body.variables ?? {}, key)
      ? {
          key,
          field,
          value: body.variables![key],
          status: body.variables![key] ? 'resolved' : 'empty',
          source: 'request',
          chain: [key],
        }
      : { key, field, value: null, status: 'missing', source: 'missing', chain: [key] };
  return {
    title: body.title,
    storyboard_id: body.storyboard_id,
    profile_id: 'profile',
    preset_ids: [],
    panels: Array.from({ length: 60 }, (_, order) => {
      const n = order + 1;
      return {
        panel_id: `scene-${n}`,
        order,
        title: `Scene ${n}`,
        profile_id: 'profile',
        dialect: 'tags',
        positive: `Prompt ${n}`,
        negative: '',
        dialogues: [`Line ${n}`],
        variables:
          n === 2
            ? [variable('weather', 'overrides.raw_prompt')]
            : n === 60
              ? [variable('person', 'dialogues.0'), variable('place', 'dialogues.0')]
              : [],
      };
    }),
  };
}

function Review() {
  const [variables, setVariables] = useState<Record<string, string>>({});
  const body = { title: 'Work', storyboard_id: 'story', preset_ids: [], variables };
  return <AssemblyReview body={body} variables={variables} onVariables={setVariables} />;
}

function setup(
  response: (body: AssembleVars) => AssemblyPreview | Promise<AssemblyPreview> = report,
) {
  mockFetch({
    'POST /api/workshop/assemble/preview': (body: unknown) => response(body as AssembleVars),
  });
  renderWithProviders(<Review />);
}

afterEach(() => vi.unstubAllGlobals());

describe('focused assembly review', () => {
  it('renders one of sixty scenes and jumps to an exact variable within the shared dialogue field', async () => {
    setup();
    expect(await screen.findByText('共 60 幕 · 3 处变量待核对')).toHaveAttribute('role', 'status');
    const tabs = within(screen.getByRole('tablist', { name: '核对分幕' }));
    expect(tabs.getAllByRole('tab')).toHaveLength(60);
    expect(screen.getAllByRole('article')).toHaveLength(1);
    expect(screen.getByText('Prompt 2')).toBeVisible();
    expect(screen.queryByText('Prompt 60')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('checkbox', { name: '仅看有问题的分幕' }));
    expect(tabs.getAllByRole('tab')).toHaveLength(2);

    const jump = screen.getByRole('combobox', { name: '跳到变量问题…' });
    const place = within(jump).getByRole('option', { name: /第 60 幕.*place/ });
    await userEvent.selectOptions(jump, place);
    expect(tabs.getByRole('tab', { name: /Scene 60/, selected: true })).toBeVisible();
    expect(screen.getByRole('listitem', { name: '台词 1 · {place}' })).toHaveFocus();
    expect(screen.getByRole('listitem', { name: '台词 1 · {person}' })).not.toHaveFocus();
    expect(screen.getByText('Line 60')).toBeVisible();
    expect(screen.queryByText('Line 2')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '下一幕' })).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: '上一幕' }));
    expect(screen.getByText('Prompt 2')).toBeVisible();
    await userEvent.click(tabs.getByRole('tab', { name: /Scene 2/ }));
    await userEvent.keyboard('{ArrowRight}');
    expect(tabs.getByRole('tab', { name: /Scene 60/, selected: true })).toHaveFocus();
  });

  it('preserves a focused temporary editor through refresh and removes the issue when verified', async () => {
    let complete = false;
    setup((body) => {
      const result = report(body);
      if (body.variables?.weather && !complete) {
        // Keep the intermediate request open so the test can observe the updating state.
        return new Promise<AssemblyPreview>(() => {});
      }
      return result;
    });
    await screen.findByText('Prompt 2');
    await userEvent.click(screen.getByRole('checkbox', { name: '仅看有问题的分幕' }));
    const input = screen.getByRole('textbox', { name: '临时变量 weather' });
    await userEvent.click(input);
    fireEvent.change(input, { target: { value: 'rai' } });
    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent('正在核对实际替换结果'),
    );
    expect(input).toHaveFocus();
    expect(screen.queryByText('Prompt 2')).not.toBeInTheDocument();
    complete = true;
    fireEvent.change(input, { target: { value: 'rain' } });
    await screen.findByText('共 60 幕 · 2 处变量待核对');
    expect(input).toHaveFocus();
    expect(screen.getByRole('listitem', { name: '原始提示词 · {weather}' })).toHaveTextContent(
      '已替换',
    );
    expect(screen.queryByRole('button', { name: /第 2 幕.*weather/ })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '下一幕' }));
    expect(screen.getAllByRole('tab')).toHaveLength(1);
    expect(screen.getByText('Prompt 60')).toBeVisible();
  });
});
