import * as Dialog from '@radix-ui/react-dialog';
import { useId, type ReactNode, type SelectHTMLAttributes } from 'react';
import { X } from 'lucide-react';
import { useAssistText } from './strings';

export function Field({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
    </label>
  );
}
export function TextInput({
  value,
  onChange,
  ...rest
}: {
  value: string;
  onChange: (value: string) => void;
  [key: string]: unknown;
}) {
  return (
    <input
      {...rest}
      className="input"
      value={value}
      onChange={(event) => onChange(event.target.value)}
    />
  );
}
export function SecretInput({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  const text = useAssistText();
  return (
    <div className="secret-input">
      <input
        className="input"
        type="password"
        autoComplete="new-password"
        value={value === '••••••' ? '' : value}
        placeholder={value === '••••••' ? text('savedKey') : ''}
        onChange={(event) => onChange(event.target.value)}
      />
      {value ? (
        <button className="btn ghost sm" type="button" onClick={() => onChange('')}>
          {text('clearKey')}
        </button>
      ) : null}
    </div>
  );
}
export function Select<T extends string>({
  value,
  onChange,
  options,
  ...rest
}: { value: T; onChange: (value: T) => void; options: { value: T; label: string }[] } & Omit<
  SelectHTMLAttributes<HTMLSelectElement>,
  'value' | 'onChange'
>) {
  return (
    <span className="select-wrap">
      <select
        {...rest}
        className="select"
        value={value}
        onChange={(event) => onChange(event.target.value as T)}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </span>
  );
}
export function Switch({
  label,
  checked,
  onChange,
}: {
  label: ReactNode;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  const id = useId();
  return (
    <label className="row" htmlFor={id}>
      <input
        id={id}
        role="switch"
        className="switch-control"
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span>{label}</span>
    </label>
  );
}
export function Loading() {
  const text = useAssistText();
  return (
    <div className="muted" role="status">
      {text('running')}
    </div>
  );
}
export function Modal({
  open,
  onOpenChange,
  title,
  children,
  footer,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  size?: string;
}) {
  const text = useAssistText();
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="overlay" />
        <Dialog.Content className="dialog">
          <div className="dialog-head">
            <Dialog.Title>{title}</Dialog.Title>
            <Dialog.Close className="btn ghost icon" aria-label={text('close')}>
              <X size={17} />
            </Dialog.Close>
          </div>
          <Dialog.Description className="sr-only" />
          <div className="dialog-body">{children}</div>
          <div className="dialog-foot">{footer}</div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
