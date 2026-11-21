import * as Popover from '@radix-ui/react-popover';
import { ArrowUpRight, CircleHelp } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { conceptDocs } from '../i18n/concepts';
import './concept-hint.css';

type Concept = keyof typeof conceptDocs;

/** Inline so the tutorial link follows its trigger in Tab order and stays inside native dialogs. */
export function ConceptHint({ concept }: { concept: Concept }) {
  const { t, i18n } = useTranslation();
  const id = useId();
  const label = t(`concepts.${concept}.label`);
  const language = i18n.resolvedLanguage === 'en' ? 'en' : 'guide';
  const href = `/manual/docs/${language}/${conceptDocs[concept]}`;
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const card = useRef<HTMLSpanElement>(null);
  const pinned = useRef(false);
  const leave = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => () => clearTimeout(leave.current), []);

  function dismiss() {
    clearTimeout(leave.current);
    pinned.current = false;
    setOpen(false);
  }

  return (
    <Popover.Root open={open} onOpenChange={(next) => !next && dismiss()}>
      <Popover.Anchor asChild>
        <button
          type="button"
          className="concept-hint-trigger"
          ref={trigger}
          aria-label={label}
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-controls={open ? id : undefined}
          onPointerEnter={(event) => {
            if (event.pointerType !== 'mouse') return;
            clearTimeout(leave.current);
            setOpen(true);
          }}
          onPointerLeave={(event) => {
            if (event.pointerType === 'mouse') scheduleDismiss();
          }}
          onFocus={(event) => {
            if (event.currentTarget.matches(':focus-visible')) setOpen(true);
          }}
          onClick={() => {
            if (pinned.current) {
              dismiss();
            } else {
              pinned.current = true;
              setOpen(true);
            }
          }}
        >
          <CircleHelp size={15} aria-hidden />
        </button>
      </Popover.Anchor>
      <Popover.Content
        asChild
        align="end"
        sideOffset={4}
        collisionPadding={12}
        onOpenAutoFocus={(event) => event.preventDefault()}
        onCloseAutoFocus={(event) => event.preventDefault()}
        onInteractOutside={(event) => {
          if (event.target instanceof Node && trigger.current?.contains(event.target))
            event.preventDefault();
        }}
        onEscapeKeyDown={(event) => {
          if (event.isComposing) {
            event.preventDefault();
            return;
          }
          if (card.current?.contains(document.activeElement)) trigger.current?.focus();
        }}
      >
        <span
          className="concept-hint-card"
          id={id}
          aria-label={label}
          ref={card}
          onPointerEnter={() => clearTimeout(leave.current)}
          onPointerLeave={(event) => {
            if (event.pointerType === 'mouse') scheduleDismiss();
          }}
        >
          <span>{t(`concepts.${concept}.description`)}</span>
          <a
            href={href}
            target="_blank"
            rel="noreferrer"
            onKeyDown={(event) => {
              // Let Tab leave this nonmodal card instead of looping in Radix's focus scope.
              if (event.key === 'Tab') event.stopPropagation();
            }}
          >
            {t('concepts.tutorial')} <ArrowUpRight size={14} aria-hidden />
          </a>
        </span>
      </Popover.Content>
    </Popover.Root>
  );

  function scheduleDismiss() {
    clearTimeout(leave.current);
    leave.current = setTimeout(() => {
      if (
        !pinned.current &&
        !trigger.current?.matches(':focus-visible') &&
        !card.current?.contains(document.activeElement)
      )
        dismiss();
    }, 180);
  }
}
