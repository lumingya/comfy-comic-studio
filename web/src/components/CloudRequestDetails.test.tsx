import { fireEvent, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { cloudRequest } from '../test/cloudRequest';
import { take } from '../test/fixtures';
import { renderWithProviders } from '../test/utils';
import { CloudRequestDetails, TakeParameterSummary } from './CloudRequestDetails';

describe('cloud request details', () => {
  it('keeps details collapsed and distinguishes intended seed and dimensions from a Chat request', () => {
    const candidate = {
      ...take('cloud', 'p0', 'candidate'),
      width: 1024,
      height: 1536,
      seed: null,
      cloud_request: cloudRequest,
    };
    renderWithProviders(
      <>
        <p>
          <TakeParameterSummary take={candidate} />
        </p>
        <CloudRequestDetails snapshot={cloudRequest} />
      </>,
    );
    expect(screen.getByText(/1024×1536.*未应用（渠道不支持）/)).toBeInTheDocument();
    const summary = screen.getByText('云端生成参数');
    expect(summary.closest('details')).not.toHaveAttribute('open');
    fireEvent.click(summary);
    const size = screen.getByRole('row', { name: /尺寸/ });
    expect(size).toHaveTextContent('896×1344');
    expect(size).toHaveTextContent('写入提示词，不保证精确遵循');
    const seed = screen.getByRole('row', { name: /种子/ });
    expect(within(seed).getAllByRole('cell')[0]).toHaveTextContent('42');
    expect(within(seed).getAllByRole('cell')[1]).toHaveTextContent('未应用（渠道不支持）');
    expect(screen.getByRole('row', { name: /参考图/ })).toHaveTextContent(
      '合成参考图（列出源素材）',
    );
    fireEvent.click(screen.getByText('参考素材'));
    expect(
      within(screen.getByRole('region', { name: '请求记录' })).getByRole('img'),
    ).toHaveAttribute('src', expect.stringContaining('/api/assets/ref_1'));
    fireEvent.click(screen.getByText('提示词详情'));
    expect(screen.getByText(cloudRequest.effective.prompt)).toBeInTheDocument();
  });

  it('shows native normalized parameters and only known generation options', () => {
    const snapshot = {
      ...cloudRequest,
      kind: 'novelai',
      requested: { ...cloudRequest.requested, seed: 4294967338, width: 905, height: 1300 },
      effective: {
        ...cloudRequest.effective,
        seed: 42,
        width: 896,
        height: 1280,
        reference_mode: 'vibe' as const,
        options: { sampler: 'k_euler', steps: 28, private_payload: 'do-not-display' },
      },
      parameter_modes: {
        seed: 'native' as const,
        size: 'native' as const,
        negative: 'native' as const,
      },
      adjustments: ['seed_modulo_32bit', 'height_aligned_64'],
    };
    renderWithProviders(<CloudRequestDetails snapshot={snapshot} />);
    fireEvent.click(screen.getByText('云端生成参数'));
    expect(screen.getByRole('row', { name: /尺寸/ })).toHaveTextContent('905×1300');
    expect(screen.getByRole('row', { name: /尺寸/ })).toHaveTextContent('896×1280');
    expect(screen.getByRole('row', { name: /种子/ })).toHaveTextContent('4294967338');
    expect(screen.getByText('种子已转换到服务支持的 32 位范围。')).toBeInTheDocument();
    expect(screen.getByText('k_euler')).toBeInTheDocument();
    expect(screen.queryByText('do-not-display')).toBeNull();
  });

  it('does not infer capabilities for extensions or candidates without a snapshot', () => {
    const snapshot = {
      ...cloudRequest,
      parameter_modes: {
        seed: 'unknown' as const,
        size: 'unknown' as const,
        negative: 'unknown' as const,
      },
      effective: { ...cloudRequest.effective, seed: 999, reference_mode: 'unknown' as const },
    };
    const view = renderWithProviders(<CloudRequestDetails snapshot={snapshot} />);
    fireEvent.click(screen.getByText('云端生成参数'));
    expect(screen.getByRole('row', { name: /种子/ })).toHaveTextContent(
      '是否应用未知（扩展未声明）',
    );
    expect(screen.queryByText('999')).toBeNull();
    view.unmount();
    renderWithProviders(<CloudRequestDetails snapshot={null} />);
    expect(screen.queryByText('云端生成参数')).toBeNull();
  });
});
