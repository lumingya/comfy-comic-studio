import { FileText, MessageSquareText, Sparkles } from 'lucide-react';
import { useEffect, useMemo, useState, type RefObject } from 'react';
import { useTranslation } from 'react-i18next';
import type { Character } from '../../api/types';
import { Modal, TextArea } from '../../components/ui';
import './story-import.css';
import { splitStoryText, storySegmentsToPanels } from './storyImport';

const MAX_PANELS = 512;
const PREVIEW_LIMIT = 24;

export function StoryImportDialog(props: {
  open: boolean;
  busy: boolean;
  characters: Character[];
  returnFocusRef?: RefObject<HTMLElement | null>;
  onOpenChange: (open: boolean) => void;
  onImport: (panels: Record<string, unknown>[]) => void;
}) {
  const { t } = useTranslation();
  const [text, setText] = useState('');
  useEffect(() => {
    if (!props.open) setText('');
  }, [props.open]);
  const characters = useMemo(
    () => props.characters.map((character) => ({ id: character.id!, name: character.name })),
    [props.characters],
  );
  const segments = useMemo(() => splitStoryText(text, characters), [text, characters]);
  const overflow = Math.max(0, segments.length - PREVIEW_LIMIT);
  const tooMany = segments.length > MAX_PANELS;
  return (
    <Modal
      open={props.open}
      onOpenChange={props.onOpenChange}
      onCloseAutoFocus={(event) => {
        const trigger = props.returnFocusRef?.current;
        if (!trigger?.isConnected) return;
        event.preventDefault();
        trigger.focus({ preventScroll: true });
      }}
      title={t('ws.story.textImport.title')}
      description={t('ws.story.textImport.hint')}
      size="lg"
      footer={
        <>
          <button className="btn ghost" onClick={() => props.onOpenChange(false)}>
            {t('common.cancel')}
          </button>
          <button
            className="btn primary"
            disabled={!segments.length || tooMany || props.busy}
            onClick={() => props.onImport(storySegmentsToPanels(segments))}
          >
            <FileText size={14} /> {t('ws.story.textImport.confirm', { count: segments.length })}
          </button>
        </>
      }
    >
      <div className="story-import">
        <TextArea
          className="story-import-input"
          rows={7}
          value={text}
          onChange={setText}
          placeholder={t('ws.story.textImport.placeholder')}
          aria-label={t('ws.story.textImport.title')}
        />
        <div className="story-import-preview-head">
          <strong>{t('ws.story.textImport.count', { count: segments.length })}</strong>
          {tooMany ? (
            <span className="story-import-limit" role="alert">
              {t('ws.story.textImport.limit', { max: MAX_PANELS })}
            </span>
          ) : null}
        </div>
        {segments.length ? (
          <ol className="story-import-preview">
            {segments.slice(0, PREVIEW_LIMIT).map((segment, index) => (
              <li key={`${index}-${segment.title}`}>
                <span className="story-import-number">{String(index + 1).padStart(2, '0')}</span>
                <div className="story-import-copy">
                  <strong>
                    {segment.title || t('ws.story.textImport.frame', { n: index + 1 })}
                  </strong>
                  {segment.description ? (
                    <p>
                      <Sparkles size={12} aria-hidden="true" /> {segment.description}
                    </p>
                  ) : null}
                  {segment.dialogues.length ? (
                    <p>
                      <MessageSquareText size={12} aria-hidden="true" />{' '}
                      {segment.dialogues
                        .map((line) => {
                          const speaker = characters.find((item) => item.id === line.speaker_id);
                          return `${speaker?.name ?? t('script.narrator')}：${line.text}`;
                        })
                        .join(' / ')}
                    </p>
                  ) : null}
                </div>
              </li>
            ))}
          </ol>
        ) : (
          <p className="story-import-empty">{t('ws.story.textImport.empty')}</p>
        )}
        {overflow ? (
          <p className="story-import-more">{t('ws.story.textImport.more', { count: overflow })}</p>
        ) : null}
      </div>
    </Modal>
  );
}
