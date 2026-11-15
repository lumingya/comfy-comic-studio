import * as Popover from '@radix-ui/react-popover';
import { Check, ChevronDown, Search } from 'lucide-react';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import './searchable-select.css';

export type SearchableOption = { value: string; label: string; search?: string };
const LIMIT = 60;

/** Search large node/model catalogs without mounting thousands of options. */
export function SearchableSelect({
  label,
  value,
  options,
  onChange,
  disabled,
  placeholder,
}: {
  label: string;
  value: string;
  options: SearchableOption[];
  onChange: (value: string) => void;
  disabled?: boolean;
  placeholder?: string;
}) {
  const { t } = useTranslation();
  const id = useId();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const selected = options.find((option) => option.value === value);
  const searchable = useMemo(
    () =>
      options.map((option) => ({
        ...option,
        text: `${option.label} ${option.value} ${option.search ?? ''}`.toLowerCase(),
      })),
    [options],
  );
  const matches = useMemo(() => {
    const words = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
    return searchable.filter((option) => words.every((word) => option.text.includes(word)));
  }, [searchable, query]);
  const visible = matches.slice(0, LIMIT);
  const setOpened = (next: boolean) => {
    setOpen(next);
    if (next) {
      setQuery('');
      const selectedIndex = options.findIndex((option) => option.value === value);
      setActive(selectedIndex >= 0 && selectedIndex < LIMIT ? selectedIndex : 0);
    }
  };
  const choose = (target: string) => {
    onChange(target);
    setOpen(false);
  };
  useEffect(() => {
    listRef.current
      ?.querySelector<HTMLElement>(`[data-index="${active}"]`)
      ?.scrollIntoView?.({ block: 'nearest' });
  }, [active, open]);

  return (
    <Popover.Root open={open} onOpenChange={setOpened}>
      <Popover.Trigger asChild>
        <button
          type="button"
          className="searchable-select-trigger"
          role="combobox"
          aria-label={label}
          aria-expanded={open}
          aria-controls={`${id}-list`}
          disabled={disabled}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
              event.preventDefault();
              setOpened(true);
            }
          }}
        >
          <span>{selected?.label ?? (value || placeholder || t('config.selector.choose'))}</span>
          <ChevronDown size={15} aria-hidden />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          className="searchable-select-popover"
          sideOffset={5}
          align="start"
          collisionPadding={12}
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            searchRef.current?.focus();
          }}
        >
          <div className="searchable-select-search">
            <Search size={15} aria-hidden />
            <input
              ref={searchRef}
              role="combobox"
              aria-label={t('config.selector.search', { label })}
              aria-autocomplete="list"
              aria-expanded="true"
              aria-controls={`${id}-list`}
              aria-activedescendant={visible[active] ? `${id}-${active}` : undefined}
              autoComplete="off"
              placeholder={t('config.selector.placeholder')}
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setActive(0);
              }}
              onKeyDown={(event) => {
                if (event.nativeEvent.isComposing) return;
                if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                  event.preventDefault();
                  setActive((current) =>
                    Math.max(
                      0,
                      Math.min(visible.length - 1, current + (event.key === 'ArrowDown' ? 1 : -1)),
                    ),
                  );
                } else if (event.key === 'Enter') {
                  event.preventDefault();
                  if (visible[active]) choose(visible[active].value);
                } else if (event.key === 'Tab') {
                  setOpen(false);
                }
              }}
            />
          </div>
          <div
            id={`${id}-list`}
            role="listbox"
            aria-label={label}
            className="searchable-select-list"
            ref={listRef}
          >
            {visible.map((option, index) => (
              <div
                key={option.value}
                id={`${id}-${index}`}
                role="option"
                aria-selected={option.value === value}
                className={`searchable-select-option ${index === active ? 'active' : ''}`}
                data-index={index}
                onPointerMove={() => setActive(index)}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => choose(option.value)}
              >
                <span>{option.label}</span>
                {option.value === value ? <Check size={15} aria-hidden /> : null}
              </div>
            ))}
            {!matches.length ? (
              <p className="searchable-select-message">{t('config.selector.empty')}</p>
            ) : null}
          </div>
          {matches.length > LIMIT ? (
            <p className="searchable-select-message" role="status">
              {t('config.selector.limited', { count: LIMIT, total: matches.length })}
            </p>
          ) : null}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
