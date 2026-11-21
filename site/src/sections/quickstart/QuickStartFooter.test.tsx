import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { QuickStartFooter } from './QuickStartFooter';

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function mockClipboard(writeText: (text: string) => Promise<void>) {
  vi.stubGlobal('navigator', {
    ...navigator,
    clipboard: { writeText },
  });
}

describe('QuickStartFooter', () => {
  it('starts with the Windows release guide and the actual requirements', () => {
    render(<QuickStartFooter locale="zh-CN" />);

    expect(screen.getByRole('button', { name: 'Windows 发布包' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    const guide = screen.getByRole('list', { name: '安装步骤 · Windows 发布包' });
    expect(within(guide).getAllByRole('listitem')).toHaveLength(3);
    expect(within(guide).getByText('.\\start.bat')).toBeInTheDocument();
    expect(
      screen.getByText(/首次启动需联网安装依赖；发布包已带界面，无需 Node.js/),
    ).toHaveTextContent('Python 3.11+');
    expect(screen.getByRole('link', { name: /^下载 Mio/ })).toHaveAttribute(
      'href',
      'https://github.com/lumingya/comfy-comic-studio/releases',
    );
    expect(screen.getByRole('link', { name: /打开本机工作室/ })).toHaveAttribute(
      'href',
      'http://127.0.0.1:8788',
    );
  });

  it('switches between all three guides and keeps ComfyUI setup distinct', () => {
    render(<QuickStartFooter locale="zh-CN" />);

    fireEvent.click(screen.getByRole('button', { name: 'macOS / Linux 发布包' }));
    expect(screen.getByRole('button', { name: 'Windows 发布包' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    expect(screen.getByRole('button', { name: 'macOS / Linux 发布包' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getByText('./start.sh')).toBeInTheDocument();
    expect(screen.queryByText('.\\start.bat')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '已有 ComfyUI' }));
    const guide = screen.getByRole('list', { name: '安装步骤 · 已有 ComfyUI' });
    expect(within(guide).getAllByRole('listitem')).toHaveLength(3);
    expect(within(guide).getByText(/仍需下载并解压 Mio 发布包/)).toBeInTheDocument();
    expect(within(guide).getByText(/http:\/\/127.0.0.1:8188/)).toHaveTextContent(
      '先确认模型、自定义节点和工作流已在 ComfyUI 中正常运行',
    );
    expect(within(guide).getByText('.\\start.bat')).toBeInTheDocument();
    expect(within(guide).getByText('./start.sh')).toBeInTheDocument();
  });

  it('copies a command and resets only after a successful clipboard write', async () => {
    vi.useFakeTimers();
    const writeText = vi.fn().mockResolvedValue(undefined);
    mockClipboard(writeText);
    render(<QuickStartFooter locale="zh-CN" />);
    const button = screen.getByRole('button', { name: '复制命令：Windows' });

    await act(async () => {
      fireEvent.click(button);
    });

    expect(writeText).toHaveBeenCalledWith('.\\start.bat');
    expect(button).toHaveTextContent('已复制');
    expect(screen.getByText('命令已复制。')).toBeInTheDocument();

    act(() => vi.advanceTimersByTime(3000));
    expect(button).toHaveTextContent('复制');
    expect(screen.queryByText('命令已复制。')).not.toBeInTheDocument();
  });

  it('reports a rejected clipboard write honestly and offers manual copying', async () => {
    mockClipboard(vi.fn().mockRejectedValue(new Error('Permission denied')));
    render(<QuickStartFooter locale="en" />);
    const button = screen.getByRole('button', { name: 'Copy command: Windows' });

    fireEvent.click(button);

    await waitFor(() => expect(button).toHaveTextContent('Copy failed'));
    expect(
      screen.getByText('Clipboard access failed. Select the command above and copy it manually.'),
    ).toBeInTheDocument();
    expect(screen.queryByText('Command copied.')).not.toBeInTheDocument();
    expect(screen.getByText('.\\start.bat')).toBeInTheDocument();
  });

  it('provides the same manual fallback when the Clipboard API is unavailable', async () => {
    vi.stubGlobal('navigator', { clipboard: undefined });
    render(<QuickStartFooter locale="zh-CN" />);

    fireEvent.click(screen.getByRole('button', { name: '复制命令：Windows' }));

    expect(
      await screen.findByText('未能访问剪贴板。请选中上方命令，手动复制。'),
    ).toBeInTheDocument();
    expect(screen.queryByText('命令已复制。')).not.toBeInTheDocument();
  });

  it('clears the feedback timer and ignores clipboard completion after unmount', async () => {
    vi.useFakeTimers();
    mockClipboard(vi.fn().mockResolvedValue(undefined));
    const { unmount } = render(<QuickStartFooter locale="en" />);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Copy command: Windows' }));
    });
    expect(vi.getTimerCount()).toBe(1);
    unmount();
    expect(vi.getTimerCount()).toBe(0);

    let finishCopy: (() => void) | undefined;
    mockClipboard(
      () =>
        new Promise<void>((resolve) => {
          finishCopy = resolve;
        }),
    );
    const later = render(<QuickStartFooter locale="en" />);
    fireEvent.click(screen.getByRole('button', { name: 'Copy command: Windows' }));
    expect(screen.getByRole('button', { name: 'Copy command: Windows' })).toBeDisabled();
    later.unmount();
    await act(async () => finishCopy?.());
    expect(vi.getTimerCount()).toBe(0);
  });

  it('uses native expandable FAQs and separates sharing from editable backups', () => {
    render(<QuickStartFooter locale="zh-CN" />);
    const faq = screen.getByRole('region', { name: '先回答几个， 你可能在想的问题。' });
    const questions = within(faq).getAllByText(/在线试玩，会真的生成图片吗？/);
    const details = questions[0].closest('details');
    expect(details).not.toHaveAttribute('open');

    fireEvent.click(questions[0]);
    expect(details).toHaveAttribute('open');
    expect(within(faq).getByText(/官网试玩使用预置的示例素材/)).toBeVisible();
    expect(within(faq).getByText(/另存源文件或创作套装/)).toBeInTheDocument();
    expect(faq.querySelectorAll('details')).toHaveLength(5);
  });

  it('localizes the full guide, source setup, and footer navigation', () => {
    render(<QuickStartFooter locale="en" />);
    fireEvent.click(screen.getByRole('button', { name: 'I have ComfyUI' }));
    expect(screen.getByRole('list', { name: 'Installation steps · I have ComfyUI' })).toBeVisible();
    expect(
      screen.getByText(/First make sure your models, custom nodes, and workflow/),
    ).toBeVisible();

    fireEvent.click(screen.getByText('Prefer to run from source?'));
    expect(screen.getByText(/You will also need Node.js 20\+/)).toBeVisible();
    expect(screen.getByText(/npm ci --prefix web/)).toBeVisible();
    const footer = screen.getByRole('contentinfo');
    expect(within(footer).getByRole('navigation', { name: 'Project and help' })).toBeVisible();
    expect(within(footer).getByRole('link', { name: 'MIT License' })).toHaveAttribute(
      'href',
      'https://github.com/lumingya/comfy-comic-studio/blob/main/LICENSE',
    );
  });
});
