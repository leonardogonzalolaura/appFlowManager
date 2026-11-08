import { useState } from 'react';
import { normalizeError } from '../../lib/api';
import { analyzeRequirementBranches } from '../../lib/branches';
import { formatDateTime } from '../../lib/format';
import { unassignRequirementRepository } from '../../lib/requirements';
import type {
  BranchOperationResult,
  RequirementDetail,
  RequirementPresence,
  RequirementRepositoryMapping,
  RepositoryBranchAnalysis,
} from '../../types';
import { Icon } from '../ui/Icon';
import { Spinner } from '../ui/Spinner';
import { StatusChip } from '../ui/StatusChip';
import { toast } from '../ui/Toast';
import { AssignRepositoryModal } from './AssignRepositoryModal';
import { BranchAnalysisModal } from './BranchAnalysisModal';
import { BranchCreateModal } from './BranchCreateModal';
import {
  branchStatusLabel,
  branchStatusTone,
  EnvPresenceChip,
} from './RequirementDetailShared';

interface RequirementRepositoriesTabProps {
  detail: RequirementDetail;
  presence: RequirementPresence | null;
  presenceLoading: boolean;
  presenceError: string | null;
  onRefreshPresence: () => void;
  onRefreshDetail: () => Promise<void>;
  onChanged: () => void;
}

export function RequirementRepositoriesTab({
  detail,
  presence,
  presenceLoading,
  presenceError,
  onRefreshPresence,
  onRefreshDetail,
  onChanged,
}: RequirementRepositoriesTabProps) {
  const [assignOpen, setAssignOpen] = useState(false);
  const [unassigning, setUnassigning] = useState<string | null>(null);
  const [branchMapping, setBranchMapping] =
    useState<RequirementRepositoryMapping | null>(null);
  const [analyses, setAnalyses] = useState<RepositoryBranchAnalysis[] | null>(
    null,
  );
  const [analyzingRepo, setAnalyzingRepo] = useState<string | null>(null);

  async function unassign(repositoryId: string, name: string) {
    setUnassigning(repositoryId);
    try {
      await unassignRequirementRepository(detail.id, repositoryId);
      await onRefreshDetail();
      onChanged();
      toast.success('Repositorio desasignado', { description: name });
    } catch (caught) {
      const apiError = normalizeError(caught);
      toast.error('No se pudo desasignar', { description: apiError.message });
    } finally {
      setUnassigning(null);
    }
  }

  async function analyzeBranch(repository: RequirementRepositoryMapping) {
    setAnalyzingRepo(repository.repositoryId);
    try {
      const result = await analyzeRequirementBranches({
        requirementId: detail.id,
        repositoryId: repository.repositoryId,
      });
      setAnalyses(result);
      onRefreshDetail();
      onChanged();
    } catch (caught) {
      const apiError = normalizeError(caught);
      toast.error('No se pudo analizar la rama', {
        description: apiError.message,
      });
    } finally {
      setAnalyzingRepo(null);
    }
  }

  function handleBranchCreated(
    repository: RequirementRepositoryMapping,
    result: BranchOperationResult,
  ) {
    setBranchMapping(null);
    toast.success('Rama preparada', { description: result.message });
    void onRefreshDetail();
    onChanged();
    void analyzeBranch(repository);
  }

  return (
    <>
      <section className="req-detail-section">
        <div className="req-tab-toolbar">
          <p className="req-presence-legend">
            <Icon name="info" size={12} />
            <span>
              La comparación se hace contra las ramas remotas{' '}
              <code>origin/*</code>, no contra tu copia local. Al pulsar{' '}
              <strong>Ambientes</strong> se actualizan las referencias remotas y
              se recalcula el estado.
            </span>
          </p>
          <div className="req-section-actions">
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              title="Actualiza origin/* desde el remoto y recalcula el estado de cada ambiente"
              onClick={onRefreshPresence}
              disabled={presenceLoading}
            >
              {presenceLoading ? (
                <Spinner size="sm" />
              ) : (
                <Icon name="refresh" size={13} />
              )}
              Ambientes
            </button>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => setAssignOpen(true)}
            >
              <Icon name="plus" size={13} />
              Asignar repositorio
            </button>
          </div>
        </div>

        {presenceError ? (
          <p className="req-presence-note">
            <Icon name="alert" size={12} /> {presenceError}
          </p>
        ) : null}

        {detail.repositories.length === 0 ? (
          <p className="req-empty-line">
            Este requerimiento todavía no está mapeado a ningún repositorio.
          </p>
        ) : (
          <div className="req-repo-list">
            {detail.repositories.map((repository) => {
              const repoPresence = presence?.repositories.find(
                (item) => item.repositoryId === repository.repositoryId,
              );
              return (
                <div key={repository.id} className="req-repo-block">
                  <div className="req-repo-item">
                    <span className="req-repo-icon">
                      <Icon name="branch" size={14} />
                    </span>
                    <span className="req-repo-copy">
                      <strong>{repository.name}</strong>
                      <small title={repository.localPath}>
                        {repository.localPath}
                      </small>
                      <small className="req-branch-meta">
                        base {repository.baseBranch}
                        {repository.lastAnalyzedAt
                          ? ` · analizada ${formatDateTime(repository.lastAnalyzedAt)}`
                          : ''}
                      </small>
                    </span>
                    <code className="branch-name">{repository.branchName}</code>
                    <StatusChip tone={branchStatusTone(repository.branchStatus)}>
                      {branchStatusLabel(repository.branchStatus)}
                    </StatusChip>
                    <div className="req-repo-actions">
                      {repository.branchStatus === 'planned' ||
                      repository.branchStatus === 'missing' ? (
                        <button
                          type="button"
                          className="btn btn-secondary btn-sm"
                          onClick={() => setBranchMapping(repository)}
                        >
                          <Icon name="branch" size={13} />
                          Crear rama
                        </button>
                      ) : (
                        <button
                          type="button"
                          className="btn btn-icon btn-ghost btn-xs"
                          aria-label={`Gestionar rama de ${repository.name}`}
                          title="Conservar o recrear rama"
                          onClick={() => setBranchMapping(repository)}
                        >
                          <Icon name="branch" size={13} />
                        </button>
                      )}
                      <button
                        type="button"
                        className="btn btn-icon btn-ghost btn-xs"
                        aria-label={`Analizar rama de ${repository.name}`}
                        title="Analizar commits y archivos"
                        onClick={() => void analyzeBranch(repository)}
                        disabled={analyzingRepo === repository.repositoryId}
                      >
                        {analyzingRepo === repository.repositoryId ? (
                          <Spinner size="sm" />
                        ) : (
                          <Icon name="terminal" size={13} />
                        )}
                      </button>
                      <button
                        type="button"
                        className="btn btn-icon btn-ghost btn-xs req-repo-remove"
                        aria-label={`Desasignar ${repository.name}`}
                        title="Desasignar"
                        onClick={() =>
                          void unassign(repository.repositoryId, repository.name)
                        }
                        disabled={unassigning === repository.repositoryId}
                      >
                        {unassigning === repository.repositoryId ? (
                          <Spinner size="sm" />
                        ) : (
                          <Icon name="x" size={13} />
                        )}
                      </button>
                    </div>
                  </div>
                  {repoPresence && repoPresence.environments.length > 0 ? (
                    <div className="req-env-matrix">
                      {repoPresence.environments.map((env) => (
                        <EnvPresenceChip key={env.environment} env={env} />
                      ))}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}
      </section>

      {assignOpen ? (
        <AssignRepositoryModal
          requirement={detail}
          onClose={() => setAssignOpen(false)}
          onAssigned={() => {
            setAssignOpen(false);
            void onRefreshDetail();
            onChanged();
            toast.success('Repositorio asignado');
          }}
        />
      ) : null}

      {branchMapping ? (
        <BranchCreateModal
          requirement={detail}
          mapping={branchMapping}
          onClose={() => setBranchMapping(null)}
          onCreated={(result) => handleBranchCreated(branchMapping, result)}
        />
      ) : null}

      {analyses ? (
        <BranchAnalysisModal
          analyses={analyses}
          onClose={() => setAnalyses(null)}
        />
      ) : null}
    </>
  );
}
