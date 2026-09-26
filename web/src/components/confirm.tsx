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

/** Mounted once in the shell. */
export function ConfirmHost() {
  const { t } = useTranslation();
  const pending = useConfirmStore((s) => s.pending);
  return (
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
  );
}
