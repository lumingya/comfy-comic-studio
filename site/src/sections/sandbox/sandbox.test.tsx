import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { artworks } from '../../shared/artwork';
import { LiveSandbox } from './LiveSandbox';

const getPanel = (index: number) => within(document.getElementById(`sandbox-panel-${index}`)!);
const pageCount = () => document.querySelector('.sandbox-page-count');

function setReaderWidth(wide = false) {
  vi.spyOn(window, 'matchMedia').mockImplementation((query: string) => ({
    matches: wide && query === '(min-width: 700px)',
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
}

beforeEach(() => setReaderWidth());

describe('LiveSandbox album preview', () => {
  it('presents five template selections and states the static demo boundaries', () => {
    render(<LiveSandbox locale="zh-CN" />);
    expect(screen.getByRole('group', { name: '画册模板' }).querySelectorAll('button')).toHaveLength(
      5,
    );
    expect(screen.getByText('从七个内置模板里，精选五种在这里试阅。')).toBeVisible();
    expect(screen.getByText(/不连接生成服务，也不产生费用/)).toBeVisible();
    expect(screen.getByText(/云端调用可能计费/)).toBeVisible();
    expect(screen.getByText(/静态风格演示；这里不提供导出/)).toBeVisible();
  });

  it('changes the actual template class and paper palette', () => {
    render(<LiveSandbox locale="zh-CN" />);
    const reader = screen.getByTestId('sandbox-reader');
    for (const [name, id] of [
      ['Nocturne', 'nocturne'],
      ['Folio', 'folio'],
      ['Zine', 'zine'],
      ['Contact Sheet', 'contact'],
      ['Monograph', 'monograph'],
    ]) {
      const button = screen.getByRole('button', { name: new RegExp(name) });
      fireEvent.click(button);
      expect(button).toHaveAttribute('aria-pressed', 'true');
      expect(reader).toHaveClass(`sandbox-template--${id}`);
    }
    fireEvent.click(screen.getByRole('button', { name: '鼠尾草' }));
    expect(reader).toHaveAttribute('data-theme', 'sage');
    fireEvent.click(screen.getByRole('button', { name: '陶土' }));
    expect(reader).toHaveAttribute('data-theme', 'rose');
    expect(screen.getByRole('button', { name: '暖纸' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('turns single pages on narrow screens and stops at both ends', () => {
    render(<LiveSandbox locale="zh-CN" />);
    expect(screen.getByTestId('sandbox-reader')).toHaveAttribute('data-view', 'single');
    expect(pageCount()).toHaveTextContent('01 / 04');
    const previous = screen.getByRole('button', { name: '上一页' });
    const next = screen.getByRole('button', { name: '下一页' });
    expect(previous).toBeDisabled();
    for (let index = 0; index < 3; index++) fireEvent.click(next);
    expect(pageCount()).toHaveTextContent('04 / 04');
    expect(next).toBeDisabled();
    fireEvent.click(next);
    expect(pageCount()).toHaveTextContent('04 / 04');
    fireEvent.click(previous);
    expect(pageCount()).toHaveTextContent('03 / 04');
  });

  it('turns spreads on wide screens and can switch to a single-page view', () => {
    setReaderWidth(true);
    render(<LiveSandbox locale="en" />);
    expect(pageCount()).toHaveTextContent('01–02 / 04');
    expect(screen.getByTestId('sandbox-reader').querySelectorAll('figure')).toHaveLength(2);
    fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
    expect(pageCount()).toHaveTextContent('03–04 / 04');
    expect(screen.getByRole('button', { name: 'Next page' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Single' }));
    expect(screen.getByTestId('sandbox-reader')).toHaveAttribute('data-view', 'single');
    expect(pageCount()).toHaveTextContent('03 / 04');
    fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
    expect(pageCount()).toHaveTextContent('04 / 04');
    fireEvent.click(screen.getByRole('button', { name: 'Spread' }));
    expect(pageCount()).toHaveTextContent('03–04 / 04');
  });

  it('scopes arrow-key navigation to the focused reader', () => {
    render(<LiveSandbox locale="en" />);
    fireEvent.keyDown(document, { key: 'ArrowRight' });
    expect(pageCount()).toHaveTextContent('01 / 04');
    const reader = screen.getByRole('group', { name: /Album preview/ });
    reader.focus();
    fireEvent.keyDown(reader, { key: 'ArrowRight' });
    expect(pageCount()).toHaveTextContent('02 / 04');
    fireEvent.keyDown(reader, { key: 'ArrowLeft' });
    expect(pageCount()).toHaveTextContent('01 / 04');
    fireEvent.keyDown(reader, { key: 'ArrowLeft' });
    expect(pageCount()).toHaveTextContent('01 / 04');
  });

  it('opens the inline contents and jumps to a chosen page', () => {
    render(<LiveSandbox locale="en" />);
    const contents = screen.getByRole('button', { name: 'Contents' });
    fireEvent.click(contents);
    expect(contents).toHaveAttribute('aria-expanded', 'true');
    const directory = screen.getByRole('group', { name: 'Contents' });
    fireEvent.click(
      within(directory).getByRole('button', { name: new RegExp(artworks[3].title.en) }),
    );
    expect(pageCount()).toHaveTextContent('04 / 04');
    expect(
      within(directory).getByRole('button', { name: new RegExp(artworks[3].title.en) }),
    ).toHaveAttribute('aria-current', 'page');
    fireEvent.click(contents);
    expect(screen.queryByRole('group', { name: 'Contents' })).not.toBeInTheDocument();
  });
});

describe('LiveSandbox prompt assembly', () => {
  function openPrompt() {
    render(<LiveSandbox locale="en" />);
    fireEvent.click(screen.getByRole('button', { name: /Assemble a preset/ }));
    return getPanel(1);
  }

  it('resolves selected presets and exposes each value source', () => {
    const panel = openPrompt();
    fireEvent.change(panel.getByLabelText(/Character/), { target: { value: '1' } });
    fireEvent.change(panel.getByLabelText(/Outfit/), { target: { value: '2' } });
    fireEvent.change(panel.getByLabelText(/^Mood \{/), { target: { value: '1' } });
    fireEvent.click(panel.getByRole('button', { name: 'The bookshop' }));
    const output = panel.getByLabelText('Resolved prompt');
    expect(output).toHaveTextContent('a silver-haired bookseller with round glasses');
    expect(output).toHaveTextContent('a soft ivory knitted sweater');
    expect(output).toHaveTextContent('relieved, with a small gentle smile');
    expect(output).toHaveTextContent('a sunlit second-hand bookshop in the afternoon');
    expect(output.querySelectorAll('mark')).toHaveLength(4);
    expect(panel.getByTestId('sandbox-source-character')).toHaveTextContent('Character preset');
    expect(panel.getByTestId('sandbox-source-scene')).toHaveTextContent('Setting selection');
  });

  it('gives panel overrides priority and restores the preset when cleared', () => {
    const panel = openPrompt();
    const input = panel.getByRole('textbox', { name: 'Mood override for this panel' });
    fireEvent.change(input, { target: { value: '  quietly determined  ' } });
    expect(panel.getByLabelText('Resolved prompt')).toHaveTextContent('quietly determined');
    expect(panel.getByTestId('sandbox-source-mood')).toHaveTextContent('Panel override');
    fireEvent.change(panel.getByLabelText(/^Mood \{/), { target: { value: '2' } });
    expect(panel.getByLabelText('Resolved prompt')).toHaveTextContent('quietly determined');
    fireEvent.change(input, { target: { value: '   ' } });
    expect(panel.getByTestId('sandbox-source-mood')).toHaveTextContent('Mood preset');
    expect(panel.getByLabelText('Resolved prompt')).toHaveTextContent(
      'thoughtful, holding an unopened letter',
    );
  });

  it('allows template editing, flags unknown variables, and treats HTML as text', () => {
    const panel = openPrompt();
    fireEvent.change(panel.getByLabelText('Input template'), {
      target: { value: '<b>{character}</b> at {unknown}' },
    });
    const output = panel.getByLabelText('Resolved prompt');
    expect(output).toHaveTextContent(
      '<b>a young letter carrier with short dark hair</b> at {unknown}',
    );
    expect(output.querySelector('b')).toBeNull();
    expect(panel.getByText(/An unmatched variable remains/)).toBeVisible();
    fireEvent.click(panel.getByRole('button', { name: /Reset sample/ }));
    expect(output).toHaveTextContent('A quiet comic panel of');
    expect(panel.queryByText(/An unmatched variable remains/)).not.toBeInTheDocument();
  });

  it('keeps the selected preset when visiting another demo', () => {
    const panel = openPrompt();
    fireEvent.change(panel.getByLabelText(/Character/), { target: { value: '2' } });
    fireEvent.click(screen.getByRole('button', { name: /Read the work/ }));
    fireEvent.click(screen.getByRole('button', { name: /Assemble a preset/ }));
    expect(panel.getByLabelText('Resolved prompt')).toHaveTextContent(
      'a travelling artist with a loose braid',
    );
  });
});

describe('LiveSandbox comparison and locale', () => {
  it('uses the same image on both sides and supports the full native range', () => {
    render(<LiveSandbox locale="en" />);
    fireEvent.click(screen.getByRole('button', { name: /Compare candidates/ }));
    const panel = getPanel(2);
    const image = panel.getByTestId('sandbox-comparison-image');
    const images = image.querySelectorAll('img');
    expect(images).toHaveLength(2);
    expect(images[0].getAttribute('src')).toBe(images[1].getAttribute('src'));
    expect(images[1]).toHaveAttribute('aria-hidden', 'true');
    const range = panel.getByRole('slider', { name: 'Comparison divider position' });
    expect(range).toHaveAttribute('min', '0');
    expect(range).toHaveAttribute('max', '100');
    expect(range.parentElement).toBe(image);
    fireEvent.change(range, { target: { value: '0' } });
    expect(image).toHaveStyle({ '--sandbox-divider': '0%' });
    expect(panel.getByText('0%')).toBeVisible();
    fireEvent.change(range, { target: { value: '100' } });
    expect(image).toHaveStyle({ '--sandbox-divider': '100%' });
    expect(panel.getByText('100%')).toBeVisible();
    expect(panel.getByText('One image · CSS illustration, not a real redraw')).toBeVisible();
    const strip = panel.getByRole('region', { name: 'Vertical comic preview' });
    expect(within(strip).getAllByRole('img')).toHaveLength(4);
    expect(strip).toHaveAttribute('tabindex', '0');
  });

  it('localizes every demo and uses native pressed buttons for selection', () => {
    const { container, rerender } = render(<LiveSandbox locale="zh-CN" />);
    fireEvent.click(screen.getByRole('button', { name: /比较候选/ }));
    expect(screen.getByRole('slider', { name: '比较分界位置' })).toBeVisible();
    rerender(<LiveSandbox locale="en" />);
    expect(container.textContent).not.toMatch(/[\u3400-\u9fff]/);
    expect(screen.getByRole('button', { name: /Compare candidates/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getByRole('button', { name: /Read the work/ })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    expect(screen.getByRole('slider', { name: 'Comparison divider position' })).toBeVisible();
  });
});
