import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EcosystemBento } from './EcosystemBento';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('EcosystemBento', () => {
  it('keeps the six optional workspaces closed until the visitor opens one', () => {
    render(<EcosystemBento locale="zh-CN" />);
    const catalogue = screen.getByRole('list', { name: '专业扩展目录' });
    const toggles = within(catalogue).getAllByRole('button');

    expect(toggles).toHaveLength(6);
    toggles.forEach((toggle) => expect(toggle).toHaveAttribute('aria-expanded', 'false'));
    expect(screen.getByText('默认关闭 · 审阅后启用')).toBeVisible();

    fireEvent.click(toggles[0]);
    expect(toggles[0]).toHaveAttribute('aria-expanded', 'true');
    const detail = screen.getByRole('region', { name: /单格精修/ });
    expect(within(detail).getByText('扩展工作区 → 单格精修')).toBeVisible();
    expect(within(detail).getByRole('link', { name: '使用说明与源码' })).toHaveAttribute(
      'href',
      'https://github.com/lumingya/comfy-comic-studio/blob/main/extensions/panel-retouch/README.md',
    );

    fireEvent.click(toggles[5]);
    expect(toggles[0]).toHaveAttribute('aria-expanded', 'false');
    expect(toggles[5]).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('region', { name: /动态漫工作台/ })).toHaveTextContent(
      '当前交付的是 HTML 播放器，不是原生 MP4 视频。',
    );
    fireEvent.click(toggles[5]);
    expect(toggles[5]).toHaveAttribute('aria-expanded', 'false');
  });

  it('supports native keyboard activation and keeps focus on the directory control', async () => {
    const user = userEvent.setup();
    render(<EcosystemBento locale="en" />);
    const toggle = screen.getByRole('button', { name: /Script Assistant/ });
    toggle.focus();

    await user.keyboard('{Enter}');
    expect(toggle).toHaveFocus();
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    const panelId = toggle.getAttribute('aria-controls');
    expect(screen.getByRole('region', { name: /Script Assistant/ })).toHaveAttribute('id', panelId);
    expect(screen.getByRole('region', { name: /Script Assistant/ })).toHaveTextContent(
      'Apply only selected edits',
    );

    await user.keyboard(' ');
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(toggle).toHaveFocus();
  });

  it('changes the illustrative AstrBot conversation without making a network request', () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    render(<EcosystemBento locale="zh-CN" />);
    const commandPicker = screen.getByRole('group', { name: '查看 AstrBot 指令示例' });

    expect(within(commandPicker).getByRole('button', { name: '/mio 作品' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    fireEvent.click(within(commandPicker).getByRole('button', { name: '/mio 画' }));
    expect(within(commandPicker).getByRole('button', { name: '/mio 画' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getByText('/mio 画 雨后的街角，一家刚开门的书店')).toBeVisible();
    expect(screen.getByText(/通过已配置的服务，写剧本、出图并返回漫画/)).toBeVisible();

    fireEvent.click(within(commandPicker).getByRole('button', { name: '/mio 任务' }));
    expect(screen.getByText(/查看正在进行的创作任务/)).toBeVisible();
    fireEvent.click(within(commandPicker).getByRole('button', { name: '/mio 帮助' }));
    expect(screen.getByText(/查看指令用法与创作入口/)).toBeVisible();
    expect(screen.getByText('静态对话示例，不会发送消息或运行任务。')).toBeVisible();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('states local and cloud boundaries and uses an unmistakable placeholder token', () => {
    const { container, rerender } = render(<EcosystemBento locale="zh-CN" />);
    expect(container.querySelector('#ecosystem')).toHaveAttribute('lang', 'zh-CN');
    expect(screen.getByText(/选择云端时，提示词与所选参考图会发送给相应服务/)).toBeVisible();
    expect(screen.getByText(/Mio 以 MIT 许可免费开放/)).toBeVisible();
    expect(container.querySelector('pre code')).toHaveTextContent(
      'Authorization: Bearer <YOUR_READ_TOKEN>',
    );
    expect(screen.getByText('请求写法示例 · 不连接本机服务')).toBeVisible();

    rerender(<EcosystemBento locale="en" />);
    expect(container.querySelector('#ecosystem')).toHaveAttribute('lang', 'en');
    expect(screen.getByRole('heading', { name: 'Your work. In your hands.' })).toBeVisible();
    expect(
      screen.getByText(/prompts and selected reference images are sent to that service/),
    ).toBeVisible();
    expect(
      screen.getByText('Static conversation example. No messages are sent or tasks run.'),
    ).toBeVisible();
    expect(
      screen.getByRole('link', { name: 'Read the API & Python client guide' }),
    ).toHaveAttribute(
      'href',
      'https://github.com/lumingya/comfy-comic-studio/blob/main/clients/README.md',
    );
    expect(screen.getByRole('link', { name: 'Explore the AstrBot plugin' })).toHaveAttribute(
      'href',
      'https://github.com/lumingya/comfy-comic-studio/tree/main/clients/astrbot_mio',
    );
  });
});
