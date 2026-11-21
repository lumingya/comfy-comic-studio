import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { WorkflowShowcase } from './WorkflowShowcase';

describe('WorkflowShowcase', () => {
  it('highlights the selected topic and lets graph nodes explain their route', async () => {
    const user = userEvent.setup();
    const { container } = render(<WorkflowShowcase locale="zh-CN" />);
    expect(screen.getByRole('button', { name: '提示词映射' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(container.querySelector('[data-node="mapping"]')).toHaveClass('is-active');
    expect(screen.getByText('[mio:prompt]')).toBeVisible();

    await user.click(screen.getByRole('button', { name: '独立 LoRA' }));
    expect(screen.getByRole('button', { name: '独立 LoRA' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(container.querySelector('[data-node="lora"]')).toHaveClass('is-active');
    expect(container.querySelector('[data-node="mapping"]')).not.toHaveClass('is-active');
    expect(screen.getByText('每颗 LoRA，各有分寸。')).toBeVisible();

    await user.click(screen.getByRole('button', { name: '查看 出图来源' }));
    expect(screen.getByRole('button', { name: '出图来源' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  it('applies the LoRA weight, bypasses a disabled slot, and restores its value', async () => {
    const user = userEvent.setup();
    const { container } = render(<WorkflowShowcase locale="zh-CN" />);
    const slider = screen.getByRole('slider', { name: 'LoRA 权重' });
    const enabled = screen.getByRole('checkbox', { name: '启用角色 LoRA' });

    fireEvent.change(slider, { target: { value: '1.15' } });
    expect(screen.getByText('有效权重 1.15')).toBeVisible();
    expect(screen.getByRole('status', { name: '当前路径' })).toHaveTextContent(
      '已接入角色 LoRA · 1.15',
    );

    await user.click(enabled);
    expect(slider).toBeDisabled();
    expect(screen.getByText('已绕过 · 不应用')).toBeVisible();
    expect(screen.getByRole('status', { name: '当前路径' })).toHaveTextContent('已绕过角色 LoRA');
    expect(container.querySelector('[data-node="lora"]')).toHaveClass('is-bypassed');

    await user.click(enabled);
    expect(slider).toBeEnabled();
    expect(slider).toHaveValue('1.15');
    expect(screen.getByText('有效权重 1.15')).toBeVisible();
  });

  it('switches to a separate cloud route without implying local LoRA passthrough', async () => {
    const user = userEvent.setup();
    render(<WorkflowShowcase locale="zh-CN" />);
    await user.click(screen.getByRole('button', { name: '云端渠道' }));

    expect(screen.getByRole('button', { name: '云端渠道' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getByText('转换为渠道参数')).toBeVisible();
    expect(screen.getByRole('status', { name: '当前路径' })).toHaveTextContent(
      '分镜 → 渠道参数 → 云端 API → 候选画面',
    );
    expect(screen.getByRole('status', { name: '当前路径' })).toHaveTextContent(
      '本地 LoRA 不传给云端',
    );
    expect(screen.getByRole('checkbox')).toBeDisabled();
    expect(screen.queryByText('[mio:prompt]')).not.toBeInTheDocument();
    expect(
      screen.getByText('云端是另一条出图渠道，不会自动把任意 ComfyUI 工作流搬到云上。'),
    ).toBeVisible();

    await user.click(screen.getByRole('button', { name: '本机 ComfyUI' }));
    expect(screen.getByRole('checkbox')).toBeEnabled();
    expect(screen.getByText('[mio:prompt]')).toBeVisible();
  });

  it('renders controls, feedback, and compatibility boundaries in English', async () => {
    const user = userEvent.setup();
    render(<WorkflowShowcase locale="en" />);
    expect(screen.getByRole('heading', { name: /Your workflow/ })).toBeVisible();
    expect(screen.getByRole('slider', { name: 'LoRA weight' })).toBeEnabled();
    expect(
      screen.getByText(
        /Special submission protocols or browser-script dependencies need an adapter/,
      ),
    ).toBeVisible();

    await user.click(screen.getByRole('button', { name: 'Cloud channel' }));
    expect(screen.getByRole('status', { name: 'Current route' })).toHaveTextContent('Cloud API');
    expect(screen.getByText(/Cloud is a separate image channel/)).toBeVisible();
  });
});
