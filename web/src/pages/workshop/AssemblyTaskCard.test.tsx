import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { useContextMenu } from '../../components/ContextMenu';
import { useSelection } from '../../app/selection';
import type { DesktopContext } from '../../app/useDesktopSelection';
import { episode, series } from '../../test/fixtures';
import { mockFetch, renderWithProviders } from '../../test/utils';
import { AssemblyTaskCard } from './AssemblyTaskCard';
import type { AssemblyActions } from './assemblyActions';
import type { Task } from './assemblyTasks';
import { useAssemblyInteraction } from './assemblyInteraction';

const task: Task = {
  album: {
    ...series,
    status: 'draft',
    episode_count: 1,
    panel_count: episode.panels.length,
    adopted_count: 0,
    cover_auto: true,
    synopsis: '',
  },
  episode,
  jobs: [],
  recent: [],
  adopted: new Set(),
  state: 'standby',
  ready: true,
  position: 0,
  stopped: false,
};

afterEach(() => vi.unstubAllGlobals());

it('cancels task rename without saving and restores its trigger focus', () => {
  const calls = mockFetch({});
  renderWithProviders(
    <AssemblyTaskCard
      task={task}
      overrides={[]}
      globalConcurrency={1}
      starting={false}
      dragging={false}
      drop={null}
      removing={false}
      onGripDown={vi.fn()}
      onStart={vi.fn()}
      onPause={vi.fn()}
      onResume={vi.fn()}
      onStop={vi.fn()}
      onDequeue={vi.fn()}
      onRemove={vi.fn()}
    />,
  );
  const trigger = screen.getByRole('button', { name: `重命名「${series.title}」` });
  fireEvent.click(trigger);
  const editor = screen.getByRole('textbox', { name: '重命名任务' });
  expect(editor).toHaveFocus();
  fireEvent.change(editor, { target: { value: 'Unsaved title' } });
  fireEvent.keyDown(editor, { key: 'Escape' });
  expect(screen.queryByRole('textbox', { name: '重命名任务' })).toBeNull();
  expect(trigger).toHaveFocus();
  expect(screen.getByRole('heading', { name: series.title })).toBeVisible();
  expect(calls.some((call) => call.method === 'PATCH')).toBe(false);
});

it('suppresses native title selection and releases capture when a drag is canceled', () => {
  const reorder = vi.fn();
  const actions = { reorder, removeTasks: vi.fn() } as unknown as AssemblyActions;
  function Harness() {
    const selection = useSelection([series.id]);
    const menu = useContextMenu<DesktopContext>();
    const { drag, onGripDown } = useAssemblyInteraction(
      [task],
      [series.id],
      selection,
      menu,
      actions,
      '',
    );
    return (
      <div>
        <div className="production-card-title" onPointerDown={(event) => onGripDown(event, task)}>
          <h2>{series.title}</h2>
        </div>
        <output>{drag ? 'dragging' : 'idle'}</output>
      </div>
    );
  }
  render(<Harness />);
  const title = screen.getByRole('heading');
  const grip = title.parentElement!;
  const capture = vi.fn();
  const release = vi.fn();
  grip.setPointerCapture = capture;
  grip.hasPointerCapture = () => true;
  grip.releasePointerCapture = release;
  const press = new MouseEvent('pointerdown', { bubbles: true, cancelable: true, button: 0 });
  Object.defineProperty(press, 'pointerId', { value: 7 });
  fireEvent(title, press);
  expect(press.defaultPrevented).toBe(true);
  expect(capture).toHaveBeenCalledWith(7);
  fireEvent.keyDown(document, { key: 'Escape' });
  expect(release).toHaveBeenCalledWith(7);
  expect(screen.getByText('idle')).toBeVisible();
  expect(reorder).not.toHaveBeenCalled();
});
