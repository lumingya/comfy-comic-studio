import { X } from 'lucide-react';
import { useId, useLayoutEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { ownCancel } from '../../components/topLayer';
import './board-zoom.css';

/**
 * Native top-layer isolation avoids Radix's body pointer-events / scroll-lock style changes.
 * On a 1,440-candidate board those inherited changes spent ~760 ms recalculating the page;
 * the browser can isolate this reader without restyling the complete board twice.
 * The shared .dialog styles still own its appearance; only native positioning is adapted.
 */
export function BoardZoomDialog(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  footer: ReactNode;
}) {
  const { t } = useTranslation();
  const ref = useRef<HTMLDialogElement>(null);
  const backdropDown = useRef(false);
  const titleId = useId();
  const descriptionId = useId();
  useLayoutEffect(() => {
    const dialog = ref.current;
    if (!props.open || !dialog) return;
    const returnFocus = document.activeElement;
    const rootStyle = document.documentElement.style;
    // Native modal isolation blocks background interaction, but does not lock viewport
    // scrolling. These non-inherited properties avoid restyling the board's descendants.
    const properties = ['overflow', 'overflow-x', 'overflow-y', 'scrollbar-gutter'] as const;
    const previous = properties.map((name) => ({
      name,
      value: rootStyle.getPropertyValue(name),
      priority: rootStyle.getPropertyPriority(name),
    }));
    rootStyle.setProperty('overflow', 'hidden');
    if (!rootStyle.getPropertyValue('scrollbar-gutter').includes('stable'))
      rootStyle.setProperty('scrollbar-gutter', 'stable');
    if (typeof dialog.showModal === 'function') dialog.showModal();
    else dialog.setAttribute('open', ''); // jsdom / older embedded hosts, as in the reader
    return () => {
      if (dialog.open) {
        if (typeof dialog.close === 'function') dialog.close();
        else dialog.removeAttribute('open');
      }
      for (const name of properties) rootStyle.removeProperty(name);
      for (const { name, value, priority } of previous)
        if (value) rootStyle.setProperty(name, value, priority);
      if (returnFocus instanceof HTMLElement && returnFocus.isConnected)
        returnFocus.focus({ preventScroll: true });
    };
  }, [props.open]);

  if (!props.open) return null;
  const outside = (event: { target: EventTarget | null; clientX: number; clientY: number }) => {
    const dialog = ref.current;
    if (!dialog || event.target !== dialog) return false;
    const rect = dialog.getBoundingClientRect();
    return (
      event.clientX < rect.left ||
      event.clientX > rect.right ||
      event.clientY < rect.top ||
      event.clientY > rect.bottom
    );
  };
  return createPortal(
    <dialog
      ref={ref}
      id="board-zoom"
      className="dialog lg board-zoom-dialog"
      aria-labelledby={titleId}
      aria-describedby={props.description ? descriptionId : undefined}
      onCancel={(event) => {
        if (!ownCancel(event)) return;
        event.preventDefault();
        props.onOpenChange(false);
      }}
      onClose={(event) => {
        if (event.target === event.currentTarget) props.onOpenChange(false);
      }}
      onPointerDown={(event) => {
        backdropDown.current = event.button === 0 && outside(event);
      }}
      onPointerCancel={() => {
        backdropDown.current = false;
      }}
      onClick={(event) => {
        const dismiss = backdropDown.current && outside(event);
        backdropDown.current = false;
        if (dismiss) props.onOpenChange(false);
      }}
    >
      <button
        type="button"
        className="btn ghost icon sm dialog-close"
        aria-label={t('common.close')}
        onClick={() => props.onOpenChange(false)}
      >
        <X size={16} />
      </button>
      <h2 id={titleId}>{props.title}</h2>
      {props.description ? (
        <p id={descriptionId} className="dialog-desc">
          {props.description}
        </p>
      ) : null}
      {props.children}
      <div className="dialog-foot">{props.footer}</div>
    </dialog>,
    document.body,
  );
}
