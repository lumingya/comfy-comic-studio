import { Eraser, Square, Undo2, Lasso } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { assetUrl } from '../../api/client';
import { useEditTake, type EditKind } from '../../api/production';
import type { Take } from '../../api/types';
import { toast, toastError } from '../../components/toast';
import { Field, Modal, NumberInput, Select, TextArea } from '../../components/ui';
import { MaskCanvas } from './MaskCanvas';
import { toMaskParams, type MaskShape } from './mask';

const RATIOS = ['3:4', '2:3', '9:16', '1:1', '4:3', '16:9'];
const ANCHORS = ['center', 'top', 'bottom', 'left', 'right'] as const;

/** Single-take edits: masked inpaint, outpaint to a ratio, or an instruction edit. */
export function EditDialog(props: { episodeId: string; take: Take | null; onClose: () => void }) {
  const { t } = useTranslation();
  const edit = useEditTake(props.episodeId);
  const [kind, setKind] = useState<EditKind>('inpaint');
  const [tool, setTool] = useState<'box' | 'lasso'>('box');
  const [shapes, setShapes] = useState<MaskShape[]>([]);
  const [prompt, setPrompt] = useState('');
  const [denoise, setDenoise] = useState<number | null>(0.75);
  const [feather, setFeather] = useState<number | null>(12);
  const [ratio, setRatio] = useState('3:4');
  const [anchor, setAnchor] = useState<(typeof ANCHORS)[number]>('center');
  const [instruction, setInstruction] = useState('');
  const take = props.take;
  if (!take) return null;

  const params = (): Record<string, unknown> | null => {
    if (kind === 'inpaint') {
      if (!shapes.length) return null;
      return {
        ...toMaskParams(shapes),
        feather: feather ?? 12,
        ...(prompt.trim() ? { prompt } : {}),
        ...(denoise !== null ? { denoise } : {}),
      };
    }
    if (kind === 'outpaint')
      return { aspect_ratio: ratio, anchor, ...(prompt.trim() ? { prompt } : {}) };
    return instruction.trim() ? { instruction } : null;
  };
  const ready = params();

  const submit = () =>
    ready &&
    edit.mutate(
      { take_id: take.id, kind, params: ready },
      {
        onSuccess: () => {
          toast(t('board.editQueued'));
          setShapes([]);
          props.onClose();
        },
        onError: toastError,
      },
    );

  return (
    <Modal
      open
      onOpenChange={(o) => !o && props.onClose()}
      size="lg"
      title={t('board.edit')}
      footer={
        <>
          <button className="btn ghost" onClick={props.onClose}>
            {t('common.cancel')}
          </button>
          <button className="btn primary" disabled={!ready || edit.isPending} onClick={submit}>
            {t('board.runEdit')}
          </button>
        </>
      }
    >
      <div className="segmented" role="tablist">
        {(['inpaint', 'outpaint', 'edit'] as const).map((k) => (
          <button
            key={k}
            role="tab"
            aria-selected={kind === k}
            className={kind === k ? 'active' : ''}
            onClick={() => setKind(k)}
          >
            {t(`board.kinds.${k}`)}
          </button>
        ))}
      </div>
      <div className="edit-layout">
        <div className="edit-stage">
          {kind === 'inpaint' ? (
            <>
              <MaskCanvas
                src={assetUrl(take.asset_id)}
                tool={tool}
                shapes={shapes}
                onChange={setShapes}
                maxWidth={560}
                maxHeight={520}
              />
              <div className="row" style={{ marginTop: 8 }}>
                <button
                  className={`btn sm ${tool === 'box' ? 'primary' : ''}`}
                  onClick={() => setTool('box')}
                >
                  <Square size={13} /> {t('board.box')}
                </button>
                <button
                  className={`btn sm ${tool === 'lasso' ? 'primary' : ''}`}
                  onClick={() => setTool('lasso')}
                >
                  <Lasso size={13} /> {t('board.lasso')}
                </button>
                <span className="grow" />
                <button
                  className="btn ghost sm"
                  disabled={!shapes.length}
                  onClick={() => setShapes(shapes.slice(0, -1))}
                >
                  <Undo2 size={13} />
                </button>
                <button
                  className="btn ghost sm"
                  disabled={!shapes.length}
                  onClick={() => setShapes([])}
                >
                  <Eraser size={13} />
                </button>
              </div>
            </>
          ) : (
            <img className="edit-preview" src={assetUrl(take.asset_id, 720)} alt="" />
          )}
        </div>
        <div className="col" style={{ gap: 14 }}>
          {kind === 'edit' ? (
            <Field label={t('board.instruction')} hint={t('board.instructionHint')}>
              <TextArea rows={4} value={instruction} onChange={setInstruction} />
            </Field>
          ) : (
            <Field label={t('board.editPrompt')} hint={t('board.editPromptHint')}>
              <TextArea mono rows={4} value={prompt} onChange={setPrompt} />
            </Field>
          )}
          {kind === 'inpaint' ? (
            <div className="grid-2">
              <Field label={t('board.denoise')}>
                <NumberInput value={denoise} min={0.05} max={1} step={0.05} onChange={setDenoise} />
              </Field>
              <Field label={t('board.feather')}>
                <NumberInput value={feather} min={0} max={128} onChange={setFeather} />
              </Field>
            </div>
          ) : null}
          {kind === 'outpaint' ? (
            <div className="grid-2">
              <Field label={t('script.ratio')}>
                <Select
                  value={ratio}
                  onChange={setRatio}
                  options={RATIOS.map((r) => ({ value: r, label: r }))}
                />
              </Field>
              <Field label={t('board.anchor')}>
                <Select
                  value={anchor}
                  onChange={setAnchor}
                  options={ANCHORS.map((a) => ({ value: a, label: t(`board.anchors.${a}`) }))}
                />
              </Field>
            </div>
          ) : null}
          {kind === 'inpaint' && !shapes.length ? (
            <p className="small muted">{t('board.maskHint')}</p>
          ) : null}
        </div>
      </div>
    </Modal>
  );
}
