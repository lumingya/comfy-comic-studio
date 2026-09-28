import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { create } from 'zustand';
import { Modal } from './ui';

export interface ConfirmOptions {
  title: string;
  description?: string;
  confirmLabel?: string;
  /** Red confirm button for irreversible actions. */
  danger?: boolean;
}

interface Pending extends ConfirmOptions {
  resolve: (ok: boolean) => void;
}

const useConfirmStore = create<{ pending: Pending | null }>(() => ({ pending: null }));

/** Ask before an irreversible action: `if (await confirm({...})) doIt()`. */
export function confirm(options: ConfirmOptions): Promise<boolean> {
  useConfirmStore.getState().pending?.resolve(false);
  return new Promise((resolve) => useConfirmStore.setState({ pending: { ...options, resolve } }));
}

function settle(ok: boolean) {
  const { pending } = useConfirmStore.getState();
  useConfirmStore.setState({ pending: null });
  pending?.resolve(ok);
}

export interface PromptOptions {
  title: string;
  /** Label of the single text field, e.g. 资产名称. */
  label: string;
  value?: string;
  placeholder?: string;
  confirmLabel?: string;
  /** Blank input cannot be confirmed (legacy textModal: 名称不能为空). */
  required?: boolean;
}

interface PendingPrompt extends PromptOptions {
  resolve: (value: string | null) => void;
}

const usePromptStore = create<{ pending: PendingPrompt | null }>(() => ({ pending: null }));

/** Ask for one line of text (the legacy `textModal`); resolves `null` when dismissed. */
export function promptText(options: PromptOptions): Promise<string | null> {
  usePromptStore.getState().pending?.resolve(null);
  return new Promise((resolve) => usePromptStore.setState({ pending: { ...options, resolve } }));
}

function settlePrompt(value: string | null) {
  const { pending } = usePromptStore.getState();
  usePromptStore.setState({ pending: null });
  pending?.resolve(value);
}

function PromptHost() {
  const { t } = useTranslation();
  const pending = usePromptStore((s) => s.pending);
  const [text, setText] = useState('');
  useEffect(() => {
    if (pending) setText(pending.value ?? '');
  }, [pending]);
  const blocked = !!pending?.required && !text.trim();
  const submit = () => {
    if (blocked) return;
    settlePrompt(text.trim());
  };
  return (
    <Modal
      open={!!pending}
      onOpenChange={(open) => !open && settlePrompt(null)}
      title={pending?.title ?? ''}
      footer={
        <>
          <button type="button" className="btn ghost" onClick={() => settlePrompt(null)}>
            {t('common.cancel')}
          </button>
          <button type="submit" form="prompt-text-form" className="btn primary" disabled={blocked}>
            {pending?.confirmLabel ?? t('common.confirm')}
          </button>
        </>
      }
    >
      <form
        id="prompt-text-form"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <label className="field">
          <span className="label">{pending?.label}</span>
          <input
            autoFocus
            value={text}
            placeholder={pending?.placeholder}
            onChange={(e) => setText(e.target.value)}
            onFocus={(e) => e.currentTarget.select()}
          />
        </label>
      </form>
    </Modal>
  );
}

/** Mounted once in the shell. */
export function ConfirmHost() {
  const { t } = useTranslation();
  const pending = useConfirmStore((s) => s.pending);
  return (
    <>
      <Modal
        open={!!pending}
        onOpenChange={(open) => !open && settle(false)}
        title={pending?.title ?? ''}
        description={pending?.description}
        footer={
          <>
            {/* Enter must not destroy anything: destructive dialogs start on Cancel. */}
            <button className="btn ghost" autoFocus={pending?.danger} onClick={() => settle(false)}>
              {t('common.cancel')}
            </button>
            <button
              className={`btn ${pending?.danger ? 'danger solid' : 'primary'}`}
              autoFocus={!pending?.danger}
              onClick={() => settle(true)}
            >
              {pending?.confirmLabel ?? t('common.confirm')}
            </button>
          </>
        }
      >
        {null}
      </Modal>
      <PromptHost />
    </>
  );
}
