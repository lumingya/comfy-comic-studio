import { fireEvent, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { Panel, Series } from '../../api/types';
import { renderWithProviders } from '../../test/utils';
import { PanelList } from './PanelList';

function panel(id: string, order: number, extra: Partial<Panel> = {}): Panel {
  return {
    id,
    order,
    shot: 'medium',
    angle: 'eye',
    characters: [],
    location_id: null,
    props: [],
    time: '',
    lighting: '',
    description: `描述 ${id}`,
    tags: [],
    dialogues: [],
    width_mode: 'full',
    aspect_ratio: '3:4',
    gap_after: 40,
    transition_background: '',
    reference_mode: 'auto',
    references: [],
    locked: false,
    overrides: {
      raw_prompt: null,
      append_prompt: '',
      negative_prompt: '',
      seed: null,
      node_overrides: {},
      values: {},
    },
    ...extra,
  } as Panel;
}

const series = {
  bible: { characters: [{ id: 'char_a', name: '林夏' }], locations: [], styles: [], props: [] },
} as unknown as Series;

describe('PanelList', () => {
  it('numbers panels, shows cast and the first line of dialogue', () => {
    renderWithProviders(
      <PanelList
        series={series}
        selected="p2"
        onSelect={() => undefined}
        onReorder={() => undefined}
        panels={[
          panel('p1', 0),
          panel('p2', 1, {
            characters: [
              {
                character_id: 'char_a',
                outfit: '',
                expression: '',
                action: '',
                tags: [],
                position: 'unspecified',
              },
            ],
            dialogues: [{ speaker_id: 'char_a', text: '好久不见', kind: 'speech', bridge: false }],
          }),
        ]}
      />,
    );
    const rows = screen.getAllByRole('listitem');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent('01');
    expect(rows[0]).toHaveTextContent('描述 p1');
    expect(rows[1]).toHaveTextContent('林夏');
    expect(rows[1]).toHaveTextContent('「好久不见」');
    expect(rows[1]).toHaveClass('active');
  });

  it('selects a panel on click', () => {
    const onSelect = vi.fn();
    renderWithProviders(
      <PanelList
        series={series}
        selected={null}
        onSelect={onSelect}
        onReorder={() => undefined}
        panels={[panel('p1', 0), panel('p2', 1)]}
      />,
    );
    fireEvent.click(screen.getByText('描述 p2'));
    expect(onSelect).toHaveBeenCalledWith('p2', {
      ctrlKey: false,
      metaKey: false,
      shiftKey: false,
    });
  });

  it('reports modifier keys, marks the multi-selection and forwards right-clicks', () => {
    const onSelect = vi.fn();
    const onContextMenu = vi.fn();
    renderWithProviders(
      <PanelList
        series={series}
        selected="p1"
        checked={new Set(['p1', 'p2'])}
        onSelect={onSelect}
        onContextMenu={onContextMenu}
        onReorder={() => undefined}
        panels={[panel('p1', 0), panel('p2', 1, { shot: '' })]}
      />,
    );
    fireEvent.click(screen.getByText('描述 p2'), { ctrlKey: true });
    expect(onSelect).toHaveBeenCalledWith('p2', { ctrlKey: true, metaKey: false, shiftKey: false });
    fireEvent.contextMenu(screen.getByText('描述 p1'));
    expect(onContextMenu).toHaveBeenCalledWith('p1', expect.anything());
    expect(document.querySelectorAll('.panel-row.checked')).toHaveLength(2);
    // An unspecified shot shows no framing chip instead of a missing-key label.
    expect(screen.queryByText('script.shots.')).toBeNull();
  });
});
