import { memo, useEffect, useRef, useState } from 'react';
import {
  ArrowUp,
  Check,
  Copy,
  Download,
  History,
  ImagePlus,
  MessageSquarePlus,
  Pencil,
  Settings2,
  Square,
  Trash2,
  X,
} from 'lucide-react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useNavigate } from './runtime';
import {
  assistAttachmentUrl,
  isAssistRunning,
  uploadAssistAttachment,
  useAssistAction,
  useAssistConversation,
  useAssistConversations,
  useAssistRequest,
  useAssistSettings,
  type AssistAttachment,
  type AssistMessage,
  type AssistSendPayload,
} from './api';
import { ApiError } from './runtime';
import { confirm } from './runtime';
import { Loading, Select, TextInput } from './ui';
import { toastError } from './runtime';
import { AssistSettings } from './AssistSettings';
import { useAssistText } from './strings';

type PendingSend = {
  id: string;
  key: string;
  payload: AssistSendPayload;
};
type ComposerDraft = {
  text: string;
  attachments: AssistAttachment[];
  pending?: PendingSend | null;
};
const draftKey = (id: string | null) => `mio.assist.draft.${id || 'new'}`;
function readDraft(id: string | null): ComposerDraft {
  try {
    const saved = JSON.parse(sessionStorage.getItem(draftKey(id)) || 'null');
    const text = typeof saved?.text === 'string' ? saved.text : '';
    const attachments: AssistAttachment[] = Array.isArray(saved?.attachments)
      ? saved.attachments
      : [];
    const pending = saved?.pending;
    return {
      text,
      attachments,
      pending:
        typeof pending?.id === 'string' && typeof pending?.key === 'string'
          ? {
              id: pending.id,
              key: pending.key,
              // Earlier drafts stored the original composer beside the request key.
              payload: {
                content: pending.payload?.content ?? text.trim(),
                attachment_ids: pending.payload?.attachment_ids ?? attachments.map((a) => a.id),
              },
            }
          : null,
    };
  } catch {
    return { text: '', attachments: [] };
  }
}
function saveDraft(id: string | null, value: ComposerDraft) {
  try {
    sessionStorage.setItem(draftKey(id), JSON.stringify(value));
  } catch {
    /* Storage may be full or disabled. */
  }
}

const Message = memo(function Message({ message }: { message: AssistMessage }) {
  const text = useAssistText();
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(message.content);
      setCopied(true);
    } catch (error) {
      toastError(error);
    }
  };
  if (message.role === 'tool' || message.role === 'system')
    return (
      <details className="assist-tool-result">
        <summary>{message.role === 'tool' ? text('toolResult') : text('title')}</summary>
        <pre>{message.content}</pre>
      </details>
    );
  return (
    <article className={`assist-message ${message.role}`}>
      {message.attachment_ids?.length ? (
        <div className="assist-message-images">
          {message.attachment_ids.map((id) => (
            <a key={id} href={assistAttachmentUrl(id)} target="_blank" rel="noreferrer">
              <img src={assistAttachmentUrl(id)} alt={text('attach')} loading="lazy" />
            </a>
          ))}
        </div>
      ) : null}
      {message.content ? (
        <div className="assist-markdown">
          <Markdown
            remarkPlugins={[remarkGfm]}
            components={{
              img: ({ alt }) => <span>{alt}</span>,
              a: ({ children, href }) => (
                <a href={href} target="_blank" rel="noreferrer noopener">
                  {children}
                </a>
              ),
            }}
          >
            {message.content}
          </Markdown>
        </div>
      ) : null}
      {message.tool_calls?.map((call) => (
        <details key={call.id} className="assist-tool-result">
          <summary>{call.function.name}</summary>
          <pre>{call.function.arguments}</pre>
        </details>
      ))}
      {message.content ? (
        <button
          className="btn ghost icon sm assist-copy"
          aria-label={copied ? text('copied') : text('copy')}
          onClick={() => void copy()}
        >
          {copied ? <Check size={14} /> : <Copy size={14} />}
        </button>
      ) : null}
    </article>
  );
});

export function AssistChat({
  floating = false,
  onClose,
}: {
  floating?: boolean;
  onClose?: () => void;
}) {
  const text = useAssistText();
  const navigate = useNavigate();
  const settings = useAssistSettings();
  const conversations = useAssistConversations();
  const [selected, select] = useState<string | null>(() =>
    localStorage.getItem('mio.assist.conversation'),
  );
  const conversation = useAssistConversation(selected);
  const action = useAssistAction();
  const configAction = useAssistAction();
  const request = useAssistRequest();
  const [showSettings, setShowSettings] = useState(false);
  const [history, setHistory] = useState(false);
  const [search, setSearch] = useState('');
  const [renaming, setRenaming] = useState<string | null>(null);
  const [rename, setRename] = useState('');
  const [draft, setDraft] = useState(() => readDraft(selected).text);
  const [attachments, setAttachments] = useState<AssistAttachment[]>(
    () => readDraft(selected).attachments,
  );
  const [uploading, setUploading] = useState(false);
  const [unknown, setUnknown] = useState(!!readDraft(selected).pending);
  const [notReceived, setNotReceived] = useState(false);
  const [recovering, setRecovering] = useState(false);
  const [sendError, setSendError] = useState('');
  const input = useRef<HTMLTextAreaElement>(null);
  const upload = useRef<HTMLInputElement>(null);
  const log = useRef<HTMLDivElement>(null);
  const follow = useRef(true);
  const sending = useRef(false);
  const pendingSend = useRef<PendingSend | null>(readDraft(selected).pending || null);
  const current = conversation.data;
  const running = isAssistRunning(current);
  const active = settings.data?.channels.find((c) => c.id === settings.data?.active_channel_id);
  const choose = (id: string | null) => {
    if (sending.current || uploading || recovering) return;
    const restored = readDraft(id);
    select(id);
    setDraft(restored.text);
    setAttachments(restored.attachments);
    setUnknown(!!restored.pending);
    setNotReceived(false);
    pendingSend.current = restored.pending || null;
    setSendError('');
    setHistory(false);
    follow.current = true;
    if (id) localStorage.setItem('mio.assist.conversation', id);
    else localStorage.removeItem('mio.assist.conversation');
  };
  useEffect(() => {
    saveDraft(selected, { text: draft, attachments, pending: pendingSend.current });
  }, [selected, draft, attachments, unknown, action.isPending]);
  useEffect(() => {
    if (conversation.error instanceof ApiError && conversation.error.status === 404) {
      select(null);
      localStorage.removeItem('mio.assist.conversation');
    }
  }, [conversation.error]);
  useEffect(() => {
    if (follow.current && log.current) log.current.scrollTop = log.current.scrollHeight;
  }, [current?.messages.length, current?.run.status, selected]);
  const delivered = (pending: PendingSend) => {
    if (pendingSend.current !== pending) return;
    pendingSend.current = null;
    saveDraft(pending.id, { text: '', attachments: [], pending: null });
    setDraft('');
    setAttachments([]);
    setUnknown(false);
    setNotReceived(false);
    setSendError('');
    follow.current = true;
  };
  const submitPending = async (pending: PendingSend) => {
    await action.mutateAsync({
      path: `/conversations/${encodeURIComponent(pending.id)}/messages`,
      body: { ...pending.payload, idempotency_key: pending.key },
    });
    delivered(pending);
    input.current?.focus();
  };
  const recover = async (retry = false) => {
    const pending = pendingSend.current;
    if (!pending || sending.current || recovering) return;
    sending.current = true;
    setRecovering(true);
    setSendError('');
    try {
      const receipt = await request.mutateAsync({ id: pending.id, key: pending.key });
      if (receipt.found) {
        if (receipt.conversation?.id !== pending.id) throw new Error(text('requestUnknown'));
        delivered(pending);
      } else {
        setNotReceived(true);
        if (retry) {
          setNotReceived(false);
          await submitPending(pending);
        }
      }
    } catch (error) {
      setNotReceived(false);
      setSendError((error as Error).message);
    } finally {
      sending.current = false;
      setRecovering(false);
    }
  };
  const send = async () => {
    if (
      sending.current ||
      running ||
      unknown ||
      uploading ||
      !active?.model ||
      (!draft.trim() && !attachments.length)
    )
      return;
    sending.current = true;
    setSendError('');
    const payload = { content: draft.trim(), attachment_ids: attachments.map((a) => a.id) };
    try {
      let id = selected;
      if (!id) {
        const created = await action.mutateAsync({ path: '/conversations', body: {} });
        id = created.id;
        select(id);
        localStorage.setItem('mio.assist.conversation', id);
        sessionStorage.removeItem(draftKey(null));
      }
      const key = crypto.randomUUID();
      const pending = { id, key, payload };
      pendingSend.current = pending;
      saveDraft(id, { text: draft, attachments, pending: pendingSend.current });
      await submitPending(pending);
    } catch (error) {
      if (pendingSend.current && (!(error instanceof ApiError) || error.status >= 500)) {
        setUnknown(true);
      } else pendingSend.current = null;
      setSendError((error as Error).message);
    } finally {
      sending.current = false;
    }
  };
  const addFiles = async (files: File[]) => {
    if (uploading || running || sending.current || unknown) return;
    if (
      files.length + attachments.length > 4 ||
      files.some(
        (f) =>
          !['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(f.type) ||
          f.size > 8 * 1024 * 1024,
      )
    ) {
      setSendError(text('imageLimit'));
      return;
    }
    setUploading(true);
    setSendError('');
    try {
      for (const file of files) {
        const result = await uploadAssistAttachment(file);
        setAttachments((previous) => [...previous, result]);
      }
    } catch (error) {
      setSendError((error as Error).message);
    } finally {
      setUploading(false);
    }
  };
  const exportChat = () => {
    if (!current) return;
    const blob = new Blob([JSON.stringify(current, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${current.title.replace(/[\\/:*?"<>|]/g, '_') || 'conversation'}.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return (
    <section
      className={`assist-chat ${floating ? 'is-floating' : 'is-page'}`}
      aria-label={text('title')}
    >
      <header className="assist-header" data-assist-drag>
        <button
          className="btn ghost icon"
          aria-label={text('history')}
          aria-expanded={history}
          onClick={() => setHistory(!history)}
        >
          <History size={18} />
        </button>
        <strong className="assist-title">{current?.title || text('title')}</strong>
        <button
          className="btn ghost icon"
          aria-label={text('newChat')}
          disabled={uploading || action.isPending || recovering}
          onClick={() => choose(null)}
        >
          <MessageSquarePlus size={18} />
        </button>
        {current ? (
          <button
            className="btn ghost icon assist-export"
            aria-label={text('export')}
            onClick={exportChat}
          >
            <Download size={17} />
          </button>
        ) : null}
        <button
          className="btn ghost icon"
          aria-label={text('settings')}
          onClick={() => setShowSettings(true)}
        >
          <Settings2 size={18} />
        </button>
        {onClose ? (
          <button className="btn ghost icon" aria-label={text('close')} onClick={onClose}>
            <X size={18} />
          </button>
        ) : null}
      </header>
      <div className={`assist-workspace ${history ? 'history-open' : ''}`}>
        {history ? (
          <aside className="assist-history" aria-label={text('history')}>
            <TextInput
              value={search}
              onChange={setSearch}
              placeholder={text('search')}
              aria-label={text('search')}
            />
            <div className="assist-history-list">
              {(conversations.data?.items || [])
                .filter((c) => c.title.toLowerCase().includes(search.toLowerCase()))
                .map((c) => (
                  <div
                    className={`assist-history-item ${c.id === selected ? 'active' : ''}`}
                    key={c.id}
                  >
                    {renaming === c.id ? (
                      <form
                        onSubmit={(e) => {
                          e.preventDefault();
                          if (rename.trim())
                            action.mutate(
                              {
                                path: `/conversations/${c.id}`,
                                method: 'PATCH',
                                body: { title: rename.trim() },
                              },
                              { onSuccess: () => setRenaming(null), onError: toastError },
                            );
                        }}
                      >
                        <TextInput
                          autoFocus
                          value={rename}
                          onChange={setRename}
                          maxLength={120}
                          aria-label={text('rename')}
                        />
                        <button
                          className="btn ghost icon sm"
                          type="submit"
                          aria-label={text('save')}
                        >
                          <Check size={14} />
                        </button>
                      </form>
                    ) : (
                      <button
                        className="btn ghost assist-history-title"
                        onClick={() => choose(c.id)}
                      >
                        {c.title || text('untitled')}
                      </button>
                    )}
                    <div className="assist-history-actions">
                      <button
                        className="btn ghost icon sm"
                        aria-label={text('rename')}
                        onClick={() => {
                          setRenaming(c.id);
                          setRename(c.title);
                        }}
                      >
                        <Pencil size={13} />
                      </button>
                      <button
                        className="btn ghost icon sm"
                        aria-label={text('remove')}
                        onClick={async () => {
                          if (
                            !(await confirm({
                              title: text('deleteChat'),
                              description: text('deleteHint'),
                              confirmLabel: text('remove'),
                              danger: true,
                            }))
                          )
                            return;
                          action.mutate(
                            { path: `/conversations/${c.id}`, method: 'DELETE' },
                            {
                              onSuccess: () => {
                                if (selected === c.id) choose(null);
                              },
                              onError: toastError,
                            },
                          );
                        }}
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </div>
                ))}
            </div>
            {!conversations.isPending && !conversations.data?.items.length ? (
              <p className="muted">{text('noneHistory')}</p>
            ) : null}
            {conversations.isError ? (
              <button className="btn" onClick={() => void conversations.refetch()}>
                {text('retryRead')}
              </button>
            ) : null}
          </aside>
        ) : null}
        <div className="assist-main">
          <div
            className="assist-log"
            ref={log}
            role="log"
            aria-label={text('history')}
            aria-live="polite"
            onScroll={() => {
              const node = log.current;
              if (node)
                follow.current = node.scrollHeight - node.scrollTop - node.clientHeight < 100;
            }}
          >
            {selected && conversation.isPending ? (
              <Loading />
            ) : !current?.messages.length ? (
              <div className="assist-empty">
                <h2>{text('empty')}</h2>
                {!active?.model ? (
                  <button className="btn" onClick={() => setShowSettings(true)}>
                    <PlusMark />
                    {text('addChannel')}
                  </button>
                ) : null}
              </div>
            ) : (
              current.messages.map((message) => <Message key={message.id} message={message} />)
            )}
            {conversation.isError ? (
              <p className="notice error" role="alert">
                {conversation.error.message}
                <button className="btn" onClick={() => void conversation.refetch()}>
                  {text('retryRead')}
                </button>
              </p>
            ) : null}
            {current?.run.status === 'waiting_approval'
              ? current.run.pending_calls
                  ?.filter((call) => call.status === 'pending')
                  .map((call) => (
                    <div className="assist-approval" key={call.id}>
                      <strong>{text('toolRequest')}</strong>
                      <p>{call.summary || call.name}</p>
                      <details>
                        <summary>{text('toolDetails')}</summary>
                        <pre>{JSON.stringify(call.arguments, null, 2)}</pre>
                      </details>
                      <div className="row">
                        <button
                          className="btn"
                          disabled={action.isPending}
                          onClick={() =>
                            action.mutate(
                              {
                                path: `/conversations/${selected}/approval`,
                                body: { call_id: call.id, approved: false },
                              },
                              { onError: toastError },
                            )
                          }
                        >
                          {text('reject')}
                        </button>
                        <button
                          className="btn primary"
                          disabled={action.isPending}
                          onClick={() =>
                            action.mutate(
                              {
                                path: `/conversations/${selected}/approval`,
                                body: { call_id: call.id, approved: true },
                              },
                              { onError: toastError },
                            )
                          }
                        >
                          {text('allow')}
                        </button>
                      </div>
                    </div>
                  ))
              : null}
            {current?.run.status === 'running' ? (
              <p className="assist-working" role="status">
                {text('running')}
              </p>
            ) : null}
            {current?.run.status === 'interrupted' ? (
              <p className="notice warn" role="status">
                {text('interrupted')}
              </p>
            ) : null}
            {current?.run.status === 'stopped' ? (
              <p className="muted" role="status">
                {text('stopped')}
              </p>
            ) : null}
            {current?.run.error ? (
              <p className="notice error" role="alert">
                {current.run.error}
              </p>
            ) : null}
          </div>
          <div className="assist-compose-wrap">
            {unknown ? (
              <div className="notice warn" role="alert">
                {notReceived ? text('requestNotReceived') : text('requestUnknown')}
                <button
                  className="btn sm"
                  disabled={recovering}
                  onClick={async () => {
                    await recover();
                  }}
                >
                  {recovering ? text('running') : text('checkRequest')}
                </button>
                {notReceived ? (
                  <button
                    className="btn sm"
                    disabled={recovering}
                    onClick={() => void recover(true)}
                  >
                    {text('retrySameRequest')}
                  </button>
                ) : null}
                {sendError ? <p>{sendError}</p> : null}
              </div>
            ) : sendError ? (
              <p className="notice error" role="alert">
                {sendError}
              </p>
            ) : null}
            <form
              className="assist-composer"
              onSubmit={(event) => {
                event.preventDefault();
                void send();
              }}
              onPaste={(event) => {
                const files = [...event.clipboardData.files].filter((file) =>
                  file.type.startsWith('image/'),
                );
                if (files.length) {
                  event.preventDefault();
                  void addFiles(files);
                }
              }}
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => {
                event.preventDefault();
                void addFiles([...event.dataTransfer.files]);
              }}
            >
              {attachments.length ? (
                <div className="assist-attachments">
                  {attachments.map((file) => (
                    <div key={file.id}>
                      <img src={file.url || assistAttachmentUrl(file.id)} alt={file.name} />
                      <button
                        type="button"
                        className="btn ghost icon sm"
                        aria-label={text('removeAttachment')}
                        disabled={unknown || action.isPending}
                        onClick={() => setAttachments(attachments.filter((a) => a.id !== file.id))}
                      >
                        <X size={14} />
                      </button>
                    </div>
                  ))}
                </div>
              ) : null}
              <textarea
                ref={input}
                rows={3}
                aria-label={text('placeholder')}
                placeholder={text('placeholder')}
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                readOnly={unknown || action.isPending}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                    event.preventDefault();
                    void send();
                  }
                }}
              />
              <div className="assist-composer-actions">
                <input
                  ref={upload}
                  hidden
                  type="file"
                  multiple
                  accept="image/png,image/jpeg,image/webp,image/gif"
                  onChange={(event) => {
                    void addFiles([...(event.target.files || [])]);
                    event.target.value = '';
                  }}
                />
                <button
                  className="btn ghost icon"
                  type="button"
                  aria-label={text('attach')}
                  disabled={running || uploading || unknown}
                  onClick={() => upload.current?.click()}
                >
                  <ImagePlus size={18} />
                </button>
                {settings.data?.channels.length ? (
                  <Select
                    aria-label={text('chooseChannel')}
                    value={settings.data.active_channel_id}
                    disabled={running || configAction.isPending}
                    options={settings.data.channels.map((c) => ({
                      value: c.id,
                      label: `${c.name} · ${c.model}`,
                    }))}
                    onChange={(id) => {
                      const { storage_path: _path, ...body } = settings.data!;
                      configAction.mutate(
                        {
                          path: '/settings',
                          method: 'PUT',
                          body: { ...body, active_channel_id: id },
                        },
                        { onError: toastError },
                      );
                    }}
                  />
                ) : (
                  <button
                    className="btn ghost sm"
                    type="button"
                    onClick={() => setShowSettings(true)}
                  >
                    {text('chooseChannel')}
                  </button>
                )}
                <span className="spacer" />
                {running ? (
                  <button
                    className="btn icon"
                    type="button"
                    aria-label={text('stop')}
                    onClick={() =>
                      action.mutate(
                        { path: `/conversations/${selected}/stop`, body: {} },
                        { onError: toastError },
                      )
                    }
                  >
                    <Square size={17} />
                  </button>
                ) : (
                  <button
                    className="btn primary icon"
                    type="submit"
                    aria-label={text('send')}
                    disabled={
                      action.isPending ||
                      unknown ||
                      recovering ||
                      uploading ||
                      !active?.model ||
                      (!draft.trim() && !attachments.length)
                    }
                  >
                    <ArrowUp size={19} />
                  </button>
                )}
              </div>
            </form>
            <small className="assist-compose-hint">
              {uploading ? text('running') : text('draftHint')}
            </small>
          </div>
        </div>
      </div>
      {showSettings && settings.data ? (
        <AssistSettings
          settings={settings.data}
          onClose={() => setShowSettings(false)}
          onModeChange={(mode) => {
            if (mode === 'page') navigate('/extensions/ai-assist');
            else if (!floating) navigate('/');
          }}
        />
      ) : null}
      {showSettings && settings.isError ? (
        <p role="alert">
          {settings.error.message}
          <button className="btn" onClick={() => void settings.refetch()}>
            {text('retryRead')}
          </button>
        </p>
      ) : null}
    </section>
  );
}

function PlusMark() {
  return <MessageSquarePlus size={16} />;
}
