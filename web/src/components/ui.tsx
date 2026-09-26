import * as Dialog from '@radix-ui/react-dialog';
import * as Menu from '@radix-ui/react-dropdown-menu';
import * as RSwitch from '@radix-ui/react-switch';
import { MoreHorizontal, X } from 'lucide-react';
import {
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent,
  type ReactNode,
  type SelectHTMLAttributes,
} from 'react';
import { useTranslation } from 'react-i18next';

export function Field(props: { label: ReactNode; hint?: ReactNode; children: ReactNode }) {
  return (
    <label className="field">
      <span>{props.label}</span>
      {props.children}
      {props.hint ? <small>{props.hint}</small> : null}
    </label>
  );
}

interface TextProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  mono?: boolean;
  type?: string;
  autoFocus?: boolean;
  onEnter?: () => void;
  'aria-label'?: string;
}

export function TextInput({ value, onChange, mono, className, onEnter, ...rest }: TextProps) {
  return (
    <input
      {...rest}
      className={`input ${mono ? 'code' : ''} ${className ?? ''}`}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && onEnter && !e.nativeEvent.isComposing) onEnter();
      }}
    />
  );
}

export function NumberInput(props: {
  value: number | null | undefined;
  onChange: (value: number | null) => void;
  min?: number;
  max?: number;
  step?: number;
  placeholder?: string;
}) {
  return (
    <input
      className="input"
      type="number"
      min={props.min}
      max={props.max}
      step={props.step}
      placeholder={props.placeholder}
      value={props.value ?? ''}
      onChange={(e) => props.onChange(e.target.value === '' ? null : Number(e.target.value))}
    />
  );
}

export function TextArea(props: TextProps & { rows?: number }) {
  const { value, onChange, mono, className, rows, onEnter: _onEnter, ...rest } = props;
  return (
    <textarea
      {...rest}
      rows={rows}
      className={`textarea ${mono ? 'code' : ''} ${className ?? ''}`}
      value={value}
      onChange={(e: ChangeEvent<HTMLTextAreaElement>) => onChange(e.target.value)}
    />
  );
}

export function Select<T extends string>(
  props: {
    value: T;
    onChange: (value: T) => void;
    options: { value: T; label: string }[];
  } & Omit<SelectHTMLAttributes<HTMLSelectElement>, 'value' | 'onChange'>,
) {
  // Layout props (className / style) size the wrapper, which also draws the chevron.
  const { value, onChange, options, className, style, ...rest } = props;
  return (
    <span className={`select-wrap ${className ?? ''}`} style={style}>
      <select
        {...rest}
        className="select"
        value={value}
        onChange={(e) => onChange(e.target.value as T)}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </span>
  );
}

/** Comma / Enter separated tags; paste "a, b, c" to add several at once. */
export function TagInput(props: {
  value: string[];
  onChange: (value: string[]) => void;
  placeholder?: string;
}) {
  const [draft, setDraft] = useState('');
  const add = (text: string) => {
    const parts = text
      .split(/[,，\n]/)
      .map((s) => s.trim())
      .filter(Boolean)
      .filter((s) => !props.value.includes(s));
    if (parts.length) props.onChange([...props.value, ...parts]);
    setDraft('');
  };
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.nativeEvent.isComposing) return;
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      add(draft);
    } else if (e.key === 'Backspace' && !draft && props.value.length) {
      props.onChange(props.value.slice(0, -1));
    }
  };
  return (
    <div className="tag-input">
      {props.value.map((tag) => (
        <span className="chip" key={tag}>
          {tag}
          <button
            type="button"
            aria-label={`remove ${tag}`}
            onClick={() => props.onChange(props.value.filter((t) => t !== tag))}
          >
            <X size={11} />
          </button>
        </span>
      ))}
      <input
        value={draft}
        placeholder={props.value.length ? '' : props.placeholder}
        onChange={(e) =>
          e.target.value.includes(',') ? add(e.target.value) : setDraft(e.target.value)
        }
        onKeyDown={onKey}
        onBlur={() => draft && add(draft)}
      />
    </div>
  );
}

export function Modal(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  size?: 'md' | 'lg';
  children: ReactNode;
  footer?: ReactNode;
}) {
  const { t } = useTranslation();
  return (
    <Dialog.Root open={props.open} onOpenChange={props.onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="overlay" />
        <Dialog.Content className={`dialog ${props.size === 'lg' ? 'lg' : ''}`}>
          <Dialog.Close asChild>
            <button className="btn ghost icon sm dialog-close" aria-label={t('common.close')}>
              <X size={16} />
            </button>
          </Dialog.Close>
          <Dialog.Title>{props.title}</Dialog.Title>
          {props.description ? (
            <Dialog.Description className="dialog-desc">{props.description}</Dialog.Description>
          ) : (
            <Dialog.Description className="sr-only" />
          )}
          {props.children}
          {props.footer ? <div className="dialog-foot">{props.footer}</div> : null}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export function Switch(props: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: ReactNode;
}) {
  return (
    <label className="row small soft" style={{ cursor: 'pointer' }}>
      <RSwitch.Root className="switch" checked={props.checked} onCheckedChange={props.onChange}>
        <RSwitch.Thumb className="switch-thumb" />
      </RSwitch.Root>
      {props.label}
    </label>
  );
}

export interface MenuAction {
  label: ReactNode;
  icon?: ReactNode;
  onSelect: () => void;
  danger?: boolean;
  disabled?: boolean;
}

export function ActionMenu(props: { actions: MenuAction[]; label?: string }) {
  const { t } = useTranslation();
  return (
    <Menu.Root>
      <Menu.Trigger asChild>
        <button className="btn ghost icon sm" aria-label={props.label ?? t('common.more')}>
          <MoreHorizontal size={16} />
        </button>
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Content className="menu" align="end" sideOffset={4}>
          {props.actions.map((a, i) => (
            <Menu.Item
              key={i}
              className={`menu-item ${a.danger ? 'danger' : ''}`}
              disabled={a.disabled}
              onSelect={a.onSelect}
            >
              {a.icon}
              {a.label}
            </Menu.Item>
          ))}
        </Menu.Content>
      </Menu.Portal>
    </Menu.Root>
  );
}

/** Empty state: optional icon and title, a line of guidance, and the next action. */
export function Empty(props: {
  children?: ReactNode;
  action?: ReactNode;
  icon?: ReactNode;
  title?: ReactNode;
  compact?: boolean;
}) {
  return (
    <div className={`empty ${props.compact ? 'compact' : ''}`}>
      {props.icon ? <div className="empty-icon">{props.icon}</div> : null}
      {props.title ? <div className="empty-title">{props.title}</div> : null}
      {props.children ? <div className="empty-body">{props.children}</div> : null}
      {props.action ? <div className="empty-action">{props.action}</div> : null}
    </div>
  );
}

export function Loading({ label }: { label?: ReactNode }) {
  const { t } = useTranslation();
  return (
    <div className="loading" role="status">
      <span className="spinner" />
      {label ?? t('common.loading')}
    </div>
  );
}

export function Progress({ value, className }: { value: number; className?: string }) {
  return (
    <div className={`progress ${className ?? ''}`}>
      <i style={{ width: `${Math.round(Math.max(0, Math.min(1, value)) * 100)}%` }} />
    </div>
  );
}

/** Hidden file input behind a button. */
export function FilePick(props: {
  accept?: string;
  onFile: (file: File) => void;
  children: ReactNode;
  className?: string;
  disabled?: boolean;
}) {
  return (
    <label className={props.className ?? 'btn'} aria-disabled={props.disabled}>
      {props.children}
      <input
        type="file"
        hidden
        accept={props.accept}
        disabled={props.disabled}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) props.onFile(file);
          e.target.value = '';
        }}
      />
    </label>
  );
}

/**
 * A title edited in place: saves trimmed text on blur / Enter, Escape reverts, and an emptied
 * field snaps back to the saved value instead of saving nothing.
 */
export function InlineTitle(props: {
  value: string;
  onSave: (value: string) => void;
  label: string;
  className?: string;
  placeholder?: string;
  /** Optional fields (a subtitle) may be cleared. */
  allowEmpty?: boolean;
}) {
  const [draft, setDraft] = useState(props.value);
  const cancel = useRef(false);
  useEffect(() => setDraft(props.value), [props.value]);
  const commit = () => {
    const next = draft.trim();
    if (cancel.current || (!next && !props.allowEmpty)) {
      cancel.current = false;
      setDraft(props.value);
      return;
    }
    if (next !== props.value) props.onSave(next);
    setDraft(next);
  };
  return (
    <input
      className={props.className ?? 'input title'}
      value={draft}
      aria-label={props.label}
      title={props.label}
      placeholder={props.placeholder}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur();
        if (e.key === 'Escape') {
          cancel.current = true;
          e.currentTarget.blur();
        }
      }}
    />
  );
}
