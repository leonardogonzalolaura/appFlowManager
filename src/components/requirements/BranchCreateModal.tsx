import { useEffect, useState } from 'react';
import { normalizeError } from '../../lib/api';
import {
  checkRequirementBranch,
  createRequirementBranch,
} from '../../lib/branches';
import { formatDateTime, shortSha } from '../../lib/format';
import type {
  ApiError,
  BranchCheck,
  BranchOperationResult,
  RequirementDetail,
  RequirementRepositoryMapping,
} from '../../types';
import { Callout } from '../ui/Callout';
import { Icon } from '../ui/Icon';
import { Modal } from '../ui/Modal';
import { Spinner } from '../ui/Spinner';
import { StatusChip } from '../ui/StatusChip';

interface BranchCreateModalProps {
  requirement: RequirementDetail;
  mapping: RequirementRepositoryMapping;
  onClose: () => void;
  onCreated: (result: BranchOperationResult) => void;
}

export function BranchCreateModal({
  requirement,
  mapping,
  onClose,
  onCreated,
}: BranchCreateModalProps) {
  const [check, setCheck] = useState<BranchCheck | null>(null);
  const [strategy, setStrategy] = useState<'preserve' | 'recreate'>('preserve');
  const [push, setPush] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  useEffect(() => {
    let active = true;
    checkRequirementBranch({
      requirementId: requirement.id,
      repositoryId: mapping.repositoryId,
    })
      .then((loaded) => {
        if (!active) return;
        setCheck(loaded);
        if (loaded.localExists) setStrategy('preserve');
      })
      .catch((caught) => {
        if (active) setError(normalizeError(caught));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [requirement.id, mapping.repositoryId]);

  async function retryCheck() {
    setLoading(true);
    setError(null);
    try {
      const loaded = await checkRequirementBranch({
        requirementId: requirement.id,
        repositoryId: mapping.repositoryId,
      });
      setCheck(loaded);
      if (loaded.localExists) setStrategy('preserve');
    } catch (caught) {
      setError(normalizeError(caught));
    } finally {
      setLoading(false);
    }
  }

  async function submit() {
    if (!check) return;
    setBusy(true);
    setError(null);
    try {
      const result = await createRequirementBranch({
        requirementId: requirement.id,
        repositoryId: mapping.repositoryId,
        strategy,
        push,
      });
      onCreated(result);
    } catch (caught) {
      setError(normalizeError(caught));
    } finally {
      setBusy(false);
    }
  }

  const canRecreate = Boolean(check?.localExists && !check?.remoteExists);
  const buttonLabel = check?.localExists
    ? strategy === 'recreate'
      ? 'Recrear desde la base'
      : 'Conservar rama existente'
    : check?.remoteExists
      ? 'Crear copia local'
      : 'Crear rama';

  return (
    <Modal
      title={`Rama ${mapping.branchName}`}
      description={`${mapping.name} · base ${mapping.baseBranch}`}
      size="md"
      icon={<Icon name="branch" size={20} />}
      onClose={busy ? () => undefined : onClose}
      closeOnBackdrop={!busy}
      footer={
        <>
          <button type="button" className="btn btn-secondary" onClick={onClose} disabled={busy}>
            Cancelar
          </button>
          <button
            type="button"
            className={`btn ${strategy === 'recreate' ? 'btn-danger' : 'btn-primary'}`}
            onClick={() => void submit()}
            disabled={
              busy ||
              loading ||
              !check ||
              Boolean(check.fetchError) ||
              (strategy === 'recreate' && !canRecreate)
            }
          >
            {busy ? <Spinner size="sm" /> : <Icon name="branch" size={14} />}
            {busy ? 'Preparando…' : buttonLabel}
          </button>
        </>
      }
    >
      {loading ? (
        <div className="env-manager-loading">
          <Spinner size="md" label="Revisando la rama local y el remoto…" />
        </div>
      ) : error && !check ? (
        <Callout tone="danger" title="No se pudo revisar la rama">
          {error.message}
        </Callout>
      ) : check ? (
        <>
          <div className="branch-facts">
            <div className="branch-fact">
              <span>Rama local</span>
              <strong>
                {check.localExists ? (
                  <StatusChip tone="success">Existe</StatusChip>
                ) : (
                  <StatusChip tone="neutral">No existe</StatusChip>
                )}
              </strong>
            </div>
            <div className="branch-fact">
              <span>Rama remota</span>
              <strong>
                {check.remoteExists ? (
                  <StatusChip tone="warning">Existe en origin</StatusChip>
                ) : (
                  <StatusChip tone="neutral">No existe</StatusChip>
                )}
              </strong>
            </div>
            <div className="branch-fact">
              <span>Base</span>
              <code title={check.baseRef}>{check.baseBranch}</code>
            </div>
            <div className="branch-fact">
              <span>SHA base</span>
              <code title={check.baseSha ?? ''}>{shortSha(check.baseSha)}</code>
            </div>
          </div>

          {check.fetchError ? (
            <Callout
              tone="danger"
              title="No se pudo actualizar la base desde origin"
              action={
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => void retryCheck()}
                  disabled={loading}
                >
                  {loading ? <Spinner size="sm" /> : <Icon name="refresh" size={13} />}
                  Reintentar
                </button>
              }
            >
              {check.fetchError} No se creará la rama hasta confirmar el estado del
              remoto.
            </Callout>
          ) : check.fetched ? (
            <Callout tone="success" title="Base actualizada desde origin">
              <code>{check.baseBranch}</code> se actualizó en <code>origin</code> antes de
              crear la rama. SHA: <code>{shortSha(check.baseSha)}</code>.
            </Callout>
          ) : (
            <Callout tone="info" title="Repositorio sin remoto">
              Se usará la base local <code>{check.baseBranch}</code>. No hay un remoto que
              actualizar.
            </Callout>
          )}

          {check.warning ? (
            <Callout
              tone={check.localExists ? 'warning' : 'info'}
              title={check.localExists ? 'La rama ya existe en tu copia local' : 'La rama ya existe en el remoto'}
            >
              {check.warning}
            </Callout>
          ) : (
            <Callout tone="info" title="La rama todavía no existe">
              Se creará desde <code>{check.baseBranch}</code>. No se modificará la rama base.
            </Callout>
          )}

          {check.localExists ? (
            <div className="branch-strategy">
              <label
                className={`branch-option ${strategy === 'preserve' ? 'is-selected' : ''}`}
              >
                <input
                  type="radio"
                  name="branch-strategy"
                  checked={strategy === 'preserve'}
                  onChange={() => setStrategy('preserve')}
                  disabled={busy}
                />
                <span>
                  <strong>Conservar la rama existente</strong>
                  <small>
                    Se usa tal como está, con sus {check.ahead} commit(s) fuera de la base.
                    No se descarta nada.
                  </small>
                </span>
              </label>

              <label
                className={`branch-option branch-option-danger ${strategy === 'recreate' ? 'is-selected' : ''} ${canRecreate ? '' : 'is-disabled'}`.trim()}
              >
                <input
                  type="radio"
                  name="branch-strategy"
                  checked={strategy === 'recreate'}
                  onChange={() => setStrategy('recreate')}
                  disabled={busy || !canRecreate}
                />
                <span>
                  <strong>Recrear desde cero</strong>
                  <small>
                    {check.remoteExists
                      ? 'Bloqueado: la rama existe en origin y no se sobrescribirá.'
                      : `Elimina la rama local y la crea de nuevo desde ${check.baseBranch}. Los commits locales se descartan.`}
                  </small>
                </span>
              </label>
            </div>
          ) : null}

          {check.localExists && check.commits.length > 0 ? (
            <div className="branch-commits-preview">
              <div className="branch-section-head">
                <h3>Commits que se conservarían</h3>
                <span className="req-section-meta">
                  {check.ahead} adelante · {check.behind} atrás
                </span>
              </div>
              {check.commits.slice(0, 6).map((commit) => (
                <div key={commit.sha} className="branch-commit-row">
                  <code>{shortSha(commit.sha)}</code>
                  <span>{commit.summary}</span>
                  <span>{commit.author ?? '—'}</span>
                  {commit.isForeign ? <StatusChip tone="warning">Ajeno</StatusChip> : null}
                </div>
              ))}
            </div>
          ) : null}

          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={push}
              onChange={(event) => setPush(event.target.checked)}
              disabled={busy || check.remoteExists}
            />
            <span>
              Empujar la rama a origin
              <small>
                {check.remoteExists
                  ? 'La rama remota ya existe; no se empujará para no sobrescribirla.'
                  : 'Se crea en origin con git push -u. No se usa force.'}
              </small>
            </span>
          </label>

          {check.localExists && strategy === 'recreate' ? (
            <Callout tone="danger" title="Esta acción descarta la rama local">
              Se eliminará <code>{mapping.branchName}</code> y se creará otra vez desde{' '}
              <code>{check.baseBranch}</code>. Si esos commits no están en otra rama, se
              pierden.
            </Callout>
          ) : null}

          {error ? (
            <Callout tone="danger" title="No se pudo preparar la rama">
              {error.message}
            </Callout>
          ) : null}

          <p className="branch-hint">
            Última revisión: {formatDateTime(new Date().toISOString())}. La rama base nunca
            se modifica.
          </p>
        </>
      ) : null}
    </Modal>
  );
}
