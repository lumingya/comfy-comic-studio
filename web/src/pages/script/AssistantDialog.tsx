import { Sparkles } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useApplyProposal, usePropose } from '../../api/production';
import type { DiffOp, Proposal } from '../../api/types';
import { toast, toastError } from '../../components/toast';
import { Modal, TextArea } from '../../components/ui';

function show(value: unknown): string {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'string') return value;
  return JSON.stringify(value);
}

export function OpCard(props: { op: DiffOp; checked: boolean; onToggle: () => void }) {
  const { t } = useTranslation();
  const { op } = props;
  const changes = Object.entries(op.changes ?? {});
  return (
    <li className={`diff-op ${op.blocked ? 'blocked' : ''}`}>
      <label className="row" style={{ alignItems: 'flex-start' }}>
        <input
          type="checkbox"
          checked={props.checked}
          disabled={!!op.blocked}
          onChange={props.onToggle}
          aria-label={op.summary}
        />
        <span className="grow">
          <span className="row small">
            <span className={`chip op-${op.op.split('_')[0]}`}>{op.op}</span>
            <strong>{op.summary}</strong>
          </span>
          {op.blocked ? (
            <span className="small danger">{t('assistant.blocked', { reason: op.blocked })}</span>
          ) : null}
          {changes.length ? (
            <table className="diff-table">
              <tbody>
                {changes.map(([field, [before, after]]) => (
                  <tr key={field}>
                    <th>{field}</th>
                    <td className="before">{show(before)}</td>
                    <td className="after">{show(after)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : null}
          {!changes.length && op.after ? (
            <pre className="prompt-box">{JSON.stringify(op.after, null, 1)}</pre>
          ) : null}
        </span>
      </label>
    </li>
  );
}

/** Instruction → proposal → per-op review → apply the accepted subset (base_revision guarded). */
export function AssistantDialog(props: {
  episodeId: string;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const { t } = useTranslation();
  const propose = usePropose(props.episodeId);
  const apply = useApplyProposal(props.episodeId);
  const [instruction, setInstruction] = useState('');
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [accepted, setAccepted] = useState<Set<string>>(new Set());

  const ask = () =>
    propose.mutate(instruction, {
      onSuccess: (p) => {
        setProposal(p);
        setAccepted(new Set(p.ops.filter((o) => !o.blocked).map((o) => o.id)));
      },
      onError: toastError,
    });

  const commit = () =>
    proposal &&
    apply.mutate(
      { proposal, accepted: [...accepted] },
      {
        onSuccess: (r) => {
          toast(t('assistant.applied', { count: r.applied.length }));
          setProposal(null);
          setInstruction('');
          props.onOpenChange(false);
        },
        onError: toastError,
      },
    );

  const toggle = (id: string) => {
    const next = new Set(accepted);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setAccepted(next);
  };

  return (
    <Modal
      open={props.open}
      onOpenChange={props.onOpenChange}
      size="lg"
      title={t('assistant.heading')}
      description={t('assistant.hint')}
      footer={
        proposal?.ops.length ? (
          <>
            <button className="btn ghost" onClick={() => setProposal(null)}>
              {t('common.cancel')}
            </button>
            <button
              className="btn primary"
              disabled={!accepted.size || apply.isPending}
              onClick={commit}
            >
              {t('assistant.applyN', { count: accepted.size })}
            </button>
          </>
        ) : undefined
      }
    >
      <div className="row" style={{ alignItems: 'flex-end' }}>
        <div className="grow">
          <TextArea
            rows={2}
            value={instruction}
            onChange={setInstruction}
            placeholder={t('assistant.placeholder')}
          />
        </div>
        <button
          className="btn primary"
          disabled={!instruction.trim() || propose.isPending}
          onClick={ask}
        >
          {propose.isPending ? <span className="spinner" /> : <Sparkles size={15} />}
          {propose.isPending ? t('assistant.proposing') : t('assistant.propose')}
        </button>
      </div>
      {proposal && !proposal.ops.length ? (
        <div className="notice" style={{ marginTop: 16 }}>
          {t('assistant.noChanges')}
        </div>
      ) : null}
      {proposal?.ops.length ? (
        <ul className="diff-list">
          {proposal.ops.map((op) => (
            <OpCard
              key={op.id}
              op={op}
              checked={accepted.has(op.id)}
              onToggle={() => toggle(op.id)}
            />
          ))}
        </ul>
      ) : null}
    </Modal>
  );
}
