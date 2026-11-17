import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AssistConversation, AssistSettings } from './api';
import { mockFetch, renderWithProviders } from './test/utils';
import { AssistChat } from './AssistChat';

const settings: AssistSettings = {
  mode: 'floating',
  active_channel_id: 'cloud',
  channels: [
    {
      id: 'cloud',
      name: '我的渠道',
      provider: 'openai',
      base_url: 'http://localhost:5104/v1',
      api_key: '••••••',
      model: 'text-model',
    },
  ],
  permissions: {
    scopes: ['read'],
    allow_operations: [],
    deny_operations: [],
    confirm_mutations: true,
  },
};
const makeChat = (patch: Partial<AssistConversation> = {}): AssistConversation => ({
  id: 'chat_1',
  title: '雨后借阅室',
  created_at: '2026-11-17T01:00:00Z',
  updated_at: '2026-11-17T01:00:00Z',
  messages: [
    { id: 'm1', role: 'user', content: '帮我写一个分镜' },
    { id: 'm2', role: 'assistant', content: '我们从雨后的书店开始。' },
  ],
  run: { id: 'run1', status: 'completed' },
  ...patch,
});
const baseRoutes = (conversation = makeChat()) => ({
  'GET /api/ext/ai-assist/settings': settings,
  'GET /api/ext/ai-assist/conversations': { items: [conversation] },
  'GET /api/ext/ai-assist/conversations/chat_1': conversation,
});
const compose = () =>
  screen.getByRole('textbox', { name: '描述你的想法，或让 AI 帮你操作工作室…' });

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('AI assistant conversations', () => {
  it('restores the selected conversation and loads persistent history', async () => {
    localStorage.setItem('mio.assist.conversation', 'chat_1');
    const calls = mockFetch(baseRoutes());
    renderWithProviders(<AssistChat />);
    const log = await screen.findByRole('log');
    expect(await within(log).findByText('我们从雨后的书店开始。')).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: '对话记录' }));
    expect(screen.getByRole('button', { name: '雨后借阅室' })).toBeVisible();
    expect(calls.filter((c) => c.method === 'POST')).toHaveLength(0);
  });

  it('creates one conversation and sends only once with a UUID during repeated Enter', async () => {
    let finish!: (value: AssistConversation) => void;
    const response = new Promise<AssistConversation>((resolve) => {
      finish = resolve;
    });
    const calls = mockFetch({
      ...baseRoutes(makeChat({ messages: [] })),
      'POST /api/ext/ai-assist/conversations': makeChat({ messages: [] }),
      'POST /api/ext/ai-assist/conversations/chat_1/messages': () => response,
    });
    renderWithProviders(<AssistChat />);
    await screen.findByRole('option', { name: '我的渠道 · text-model' });
    fireEvent.change(compose(), { target: { value: '  一本雨后的画册  ' } });
    fireEvent.keyDown(compose(), { key: 'Enter' });
    fireEvent.keyDown(compose(), { key: 'Enter' });
    await waitFor(() => expect(calls.filter((c) => c.url.endsWith('/messages'))).toHaveLength(1));
    const sent = calls.find((c) => c.url.endsWith('/messages'))!.body as Record<string, unknown>;
    expect(sent).toMatchObject({ content: '一本雨后的画册', attachment_ids: [] });
    expect(sent.idempotency_key).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    expect(
      calls.filter((c) => c.method === 'POST' && c.url.endsWith('/conversations')),
    ).toHaveLength(1);
    await act(async () => {
      finish(makeChat());
      await response;
    });
    await waitFor(() => expect(compose()).toHaveValue(''));
    expect(localStorage.getItem('mio.assist.conversation')).toBe('chat_1');
  });

  it('does not send on Shift+Enter or an unfinished IME composition', async () => {
    const calls = mockFetch(baseRoutes());
    renderWithProviders(<AssistChat />);
    await screen.findByRole('option', { name: '我的渠道 · text-model' });
    fireEvent.change(compose(), { target: { value: '你好' } });
    fireEvent.keyDown(compose(), { key: 'Enter', shiftKey: true });
    fireEvent.keyDown(compose(), { key: 'Enter', isComposing: true });
    expect(calls.filter((c) => c.method === 'POST')).toHaveLength(0);
  });

  it('stops the current run without sending a new message', async () => {
    localStorage.setItem('mio.assist.conversation', 'chat_1');
    let current = makeChat({ run: { id: 'run1', status: 'running' } });
    const calls = mockFetch({
      ...baseRoutes(current),
      'GET /api/ext/ai-assist/conversations/chat_1': () => current,
      'POST /api/ext/ai-assist/conversations/chat_1/stop': () => {
        current = makeChat({ run: { id: 'run1', status: 'stopped' } });
        return current;
      },
    });
    renderWithProviders(<AssistChat />);
    await userEvent.click(await screen.findByRole('button', { name: '停止' }));
    expect(await screen.findByText('已停止')).toBeVisible();
    expect(calls.filter((c) => c.method === 'POST').map((c) => c.url)).toEqual([
      '/api/ext/ai-assist/conversations/chat_1/stop',
    ]);
  });

  it.each([
    { label: '拒绝', approved: false },
    { label: '允许这次操作', approved: true },
  ])('submits only the visible pending call when choosing $label', async ({ label, approved }) => {
    localStorage.setItem('mio.assist.conversation', 'chat_1');
    let current = makeChat({
      run: {
        id: 'run1',
        status: 'waiting_approval',
        pending_calls: [
          {
            id: 'call1',
            status: 'pending',
            name: 'mio_call',
            summary: '新建分镜',
            arguments: { operation_id: 'create_storyboard', body: { name: '雨后' } },
          },
        ],
      },
    });
    const calls = mockFetch({
      ...baseRoutes(current),
      'GET /api/ext/ai-assist/conversations/chat_1': () => current,
      'POST /api/ext/ai-assist/conversations/chat_1/approval': () => {
        current = makeChat();
        return current;
      },
    });
    renderWithProviders(<AssistChat />);
    expect(await screen.findByText('等待你确认')).toBeVisible();
    await userEvent.click(screen.getByText('具体操作'));
    expect(screen.getByText(/create_storyboard/)).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: label }));
    await waitFor(() => expect(calls.some((c) => c.url.endsWith('/approval'))).toBe(true));
    expect(calls.find((c) => c.url.endsWith('/approval'))!.body).toEqual({
      call_id: 'call1',
      approved,
    });
    await waitFor(() => expect(screen.queryByText('等待你确认')).not.toBeInTheDocument());
  });

  it('renders markdown without fetching remote images or rendering raw HTML', async () => {
    localStorage.setItem('mio.assist.conversation', 'chat_1');
    mockFetch(
      baseRoutes(
        makeChat({
          messages: [
            {
              id: 'm2',
              role: 'assistant',
              content:
                '**画册**\n\n![remote preview](https://third-party.example/tracker.png)\n\n<img src="https://third-party.example/raw.png" />',
            },
          ],
        }),
      ),
    );
    renderWithProviders(<AssistChat />);
    expect(await screen.findByText('画册')).toBeVisible();
    expect(screen.getByText('remote preview')).toBeVisible();
    expect(document.querySelectorAll('img')).toHaveLength(0);
  });

  it('blocks repeated sends while a request outcome remains unknown', async () => {
    localStorage.setItem('mio.assist.conversation', 'chat_1');
    const calls = mockFetch({
      ...baseRoutes(),
      'POST /api/ext/ai-assist/conversations/chat_1/messages': () => {
        throw new TypeError('Connection closed');
      },
    });
    renderWithProviders(<AssistChat />);
    await screen.findByText('我们从雨后的书店开始。');
    fireEvent.change(compose(), { target: { value: '生成下一幕' } });
    await userEvent.click(screen.getByRole('button', { name: '发送' }));
    expect(await screen.findByText(/发送结果尚未确认/)).toBeVisible();
    expect(screen.getByRole('button', { name: '发送' })).toBeDisabled();
    fireEvent.keyDown(compose(), { key: 'Enter' });
    expect(calls.filter((c) => c.url.endsWith('/messages'))).toHaveLength(1);
  });

  it('starts a new local draft without deleting the previous conversation', async () => {
    localStorage.setItem('mio.assist.conversation', 'chat_1');
    const calls = mockFetch(baseRoutes());
    renderWithProviders(<AssistChat />);
    await screen.findByText('我们从雨后的书店开始。');
    await userEvent.click(screen.getByRole('button', { name: '新对话' }));
    expect(screen.getByText('今天想创作什么？')).toBeVisible();
    expect(localStorage.getItem('mio.assist.conversation')).toBeNull();
    expect(calls.filter((c) => c.method !== 'GET')).toHaveLength(0);
  });

  it('checks an unreceived request before explicitly retrying the same key and payload', async () => {
    localStorage.setItem('mio.assist.conversation', 'chat_1');
    let attempts = 0;
    const calls = mockFetch({
      ...baseRoutes(),
      'GET /api/ext/ai-assist/conversations/chat_1/requests/*': {
        found: false,
        status: 'not_found',
        conversation: makeChat(),
      },
      'POST /api/ext/ai-assist/conversations/chat_1/messages': (body: unknown) => {
        attempts++;
        if (attempts === 1) throw new TypeError('Connection closed');
        return makeChat({
          run: {
            id: 'run2',
            status: 'running',
            request_key: (body as { idempotency_key: string }).idempotency_key,
          },
        });
      },
    });
    renderWithProviders(<AssistChat />);
    await screen.findByText('我们从雨后的书店开始。');
    fireEvent.change(compose(), { target: { value: '生成下一幕' } });
    await userEvent.click(screen.getByRole('button', { name: '发送' }));
    await screen.findByText(/发送结果尚未确认/);
    expect(screen.queryByRole('button', { name: '按原内容重试' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '查询原请求' }));
    expect(await screen.findByText('服务端未收到这条消息。')).toBeVisible();
    expect(screen.getByRole('button', { name: '发送' })).toBeDisabled();
    expect(compose()).toHaveValue('生成下一幕');
    expect(calls.filter((c) => c.url.endsWith('/messages'))).toHaveLength(1);
    await userEvent.click(screen.getByRole('button', { name: '按原内容重试' }));
    await waitFor(() => expect(screen.queryByText(/服务端未收到/)).not.toBeInTheDocument());
    expect(compose()).toHaveValue('');
    const sent = calls.filter((c) => c.url.endsWith('/messages'));
    expect(sent).toHaveLength(2);
    expect(sent[1].body).toEqual(sent[0].body);
    const receiptCalls = calls.filter((c) => c.url.includes('/requests/'));
    expect(receiptCalls).toHaveLength(2);
    expect(receiptCalls[0].url).toBe(receiptCalls[1].url);
    expect(calls.indexOf(receiptCalls[1])).toBeLessThan(calls.indexOf(sent[1]));
  });

  it('recovers a lost response from the request receipt without resending a historical request', async () => {
    localStorage.setItem('mio.assist.conversation', 'chat_1');
    const recovered = makeChat({
      title: '收到的原会话',
      messages: [{ id: 'answer', role: 'assistant', content: '这条消息早已收到。' }],
      // A newer request owns the current run. The historical receipt remains authoritative.
      run: { id: 'new-run', status: 'completed', request_key: 'newer-request' },
    });
    const calls = mockFetch({
      ...baseRoutes(),
      'GET /api/ext/ai-assist/conversations/chat_1/requests/*': {
        found: true,
        status: 'accepted',
        conversation: recovered,
      },
      'POST /api/ext/ai-assist/conversations/chat_1/messages': () => {
        throw new TypeError('Connection closed after acceptance');
      },
    });
    renderWithProviders(<AssistChat />);
    await screen.findByText('我们从雨后的书店开始。');
    fireEvent.change(compose(), { target: { value: '先前的消息' } });
    await userEvent.click(screen.getByRole('button', { name: '发送' }));
    await screen.findByText(/发送结果尚未确认/);
    await userEvent.click(screen.getByRole('button', { name: '查询原请求' }));
    expect(await screen.findByText('这条消息早已收到。')).toBeVisible();
    expect(screen.getByText('收到的原会话')).toBeVisible();
    expect(compose()).toHaveValue('');
    expect(screen.queryByRole('button', { name: '查询原请求' })).not.toBeInTheDocument();
    expect(calls.filter((c) => c.url.endsWith('/messages'))).toHaveLength(1);
    expect(JSON.parse(sessionStorage.getItem('mio.assist.draft.chat_1')!).pending).toBeNull();
  });

  it('rechecks before retrying and does not resend a request accepted after the first check', async () => {
    localStorage.setItem('mio.assist.conversation', 'chat_1');
    sessionStorage.setItem(
      'mio.assist.draft.chat_1',
      JSON.stringify({
        text: '待恢复的消息',
        attachments: [],
        pending: { id: 'chat_1', key: 'saved-key' },
      }),
    );
    let checks = 0;
    const calls = mockFetch({
      ...baseRoutes(),
      'GET /api/ext/ai-assist/conversations/chat_1/requests/saved-key': () => ({
        found: ++checks > 1,
        status: checks > 1 ? 'accepted' : 'not_found',
        conversation: makeChat(),
      }),
    });
    renderWithProviders(<AssistChat />);
    await userEvent.click(screen.getByRole('button', { name: '查询原请求' }));
    await userEvent.click(await screen.findByRole('button', { name: '按原内容重试' }));
    await waitFor(() => expect(compose()).toHaveValue(''));
    expect(checks).toBe(2);
    expect(calls.filter((c) => c.method === 'POST')).toHaveLength(0);
  });

  it('persists the original content and attachment IDs across a reload', async () => {
    localStorage.setItem('mio.assist.conversation', 'chat_1');
    sessionStorage.setItem(
      'mio.assist.draft.chat_1',
      JSON.stringify({
        text: '  原始消息  ',
        attachments: [{ id: 'img-original', name: '参考图.png', mime_type: 'image/png', url: '' }],
      }),
    );
    let attempts = 0;
    const calls = mockFetch({
      ...baseRoutes(),
      'GET /api/ext/ai-assist/conversations/chat_1/requests/*': {
        found: false,
        status: 'not_found',
        conversation: makeChat(),
      },
      'POST /api/ext/ai-assist/conversations/chat_1/messages': () => {
        if (++attempts === 1) throw new TypeError('Disconnected');
        return makeChat();
      },
    });
    const first = renderWithProviders(<AssistChat />);
    await screen.findByText('我们从雨后的书店开始。');
    await userEvent.click(screen.getByRole('button', { name: '发送' }));
    await screen.findByText(/发送结果尚未确认/);
    const saved = JSON.parse(sessionStorage.getItem('mio.assist.draft.chat_1')!);
    expect(saved.pending.payload).toEqual({
      content: '原始消息',
      attachment_ids: ['img-original'],
    });
    first.unmount();
    // Composer content may differ in an older tab; replay must still use the immutable payload.
    sessionStorage.setItem(
      'mio.assist.draft.chat_1',
      JSON.stringify({ ...saved, text: '另一个草稿', attachments: [] }),
    );
    renderWithProviders(<AssistChat />);
    expect(compose()).toHaveValue('另一个草稿');
    expect(compose()).toHaveAttribute('readonly');
    expect(calls.filter((c) => c.url.endsWith('/messages'))).toHaveLength(1);
    await userEvent.click(screen.getByRole('button', { name: '查询原请求' }));
    await userEvent.click(await screen.findByRole('button', { name: '按原内容重试' }));
    await waitFor(() => expect(compose()).toHaveValue(''));
    const sent = calls.filter((c) => c.url.endsWith('/messages'));
    expect(sent).toHaveLength(2);
    expect(sent[1].body).toEqual(sent[0].body);
  });

  it('restores old drafts that only stored a request key', async () => {
    localStorage.setItem('mio.assist.conversation', 'chat_1');
    sessionStorage.setItem(
      'mio.assist.draft.chat_1',
      JSON.stringify({
        text: '  旧版草稿  ',
        attachments: [{ id: 'img-old', name: '旧图.png', mime_type: 'image/png', url: '' }],
        pending: { id: 'chat_1', key: 'legacy-key' },
      }),
    );
    const calls = mockFetch({
      ...baseRoutes(),
      'GET /api/ext/ai-assist/conversations/chat_1/requests/legacy-key': {
        found: false,
        status: 'not_found',
        conversation: makeChat(),
      },
      'POST /api/ext/ai-assist/conversations/chat_1/messages': makeChat(),
    });
    renderWithProviders(<AssistChat />);
    await userEvent.click(screen.getByRole('button', { name: '查询原请求' }));
    await userEvent.click(await screen.findByRole('button', { name: '按原内容重试' }));
    await waitFor(() => expect(compose()).toHaveValue(''));
    expect(calls.find((c) => c.url.endsWith('/messages'))!.body).toEqual({
      content: '旧版草稿',
      attachment_ids: ['img-old'],
      idempotency_key: 'legacy-key',
    });
  });

  it('keeps a failed new-conversation creation as an editable local draft', async () => {
    let attempts = 0;
    const calls = mockFetch({
      ...baseRoutes(),
      'POST /api/ext/ai-assist/conversations': () => {
        if (++attempts === 1) throw new TypeError('Cannot reach server');
        return makeChat({ messages: [] });
      },
      'POST /api/ext/ai-assist/conversations/chat_1/messages': makeChat(),
    });
    renderWithProviders(<AssistChat />);
    await screen.findByRole('option', { name: '我的渠道 · text-model' });
    fireEvent.change(compose(), { target: { value: '未发送的新会话' } });
    await userEvent.click(screen.getByRole('button', { name: '发送' }));
    expect(await screen.findByText('Cannot reach server')).toBeVisible();
    expect(screen.queryByRole('button', { name: '查询原请求' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '发送' })).toBeEnabled();
    expect(compose()).not.toHaveAttribute('readonly');
    expect(compose()).toHaveValue('未发送的新会话');
    expect(localStorage.getItem('mio.assist.conversation')).toBeNull();
    expect(JSON.parse(sessionStorage.getItem('mio.assist.draft.new')!).pending).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: '发送' }));
    await waitFor(() => expect(compose()).toHaveValue(''));
    expect(calls.filter((c) => c.url.endsWith('/messages'))).toHaveLength(1);
    expect(calls.filter((c) => c.url.includes('/requests/'))).toHaveLength(0);
  });

  it('does not present completed tool calls as pending approvals', async () => {
    localStorage.setItem('mio.assist.conversation', 'chat_1');
    mockFetch(
      baseRoutes(
        makeChat({
          run: {
            id: 'run1',
            status: 'completed',
            pending_calls: [
              { id: 'old-call', name: 'mio_call', arguments: {}, status: 'completed' },
            ],
          },
        }),
      ),
    );
    renderWithProviders(<AssistChat />);
    await screen.findByText('我们从雨后的书店开始。');
    expect(screen.queryByRole('button', { name: '允许这次操作' })).not.toBeInTheDocument();
    expect(screen.queryByText('等待你确认')).not.toBeInTheDocument();
  });
});
