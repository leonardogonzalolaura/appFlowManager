import { formatDateTime, shortSha } from '../../lib/format';
import type { RepositoryBranchAnalysis } from '../../types';
import { Callout } from '../ui/Callout';
import { Icon } from '../ui/Icon';
import { Modal } from '../ui/Modal';
import { StatusChip } from '../ui/StatusChip';

interface BranchAnalysisModalProps {
  analyses: RepositoryBranchAnalysis[];
  onClose: () => void;
}

export function BranchAnalysisModal({ analyses, onClose }: BranchAnalysisModalProps) {
  return (
    <Modal
      title="Análisis de ramas"
      description="Commits y archivos que aportaría el requerimiento respecto a la rama base."
      size="lg"
      icon={<Icon name="terminal" size={20} />}
      onClose={onClose}
      footer={
        <button type="button" className="btn btn-primary" onClick={onClose}>
          Cerrar
        </button>
      }
    >
      {analyses.length === 0 ? (
        <Callout tone="info" title="Sin repositorios para analizar">
          Asigna primero un repositorio y crea la rama del requerimiento.
        </Callout>
      ) : (
        <div className="branch-analysis-list">
          {analyses.map((analysis) => (
            <section key={analysis.repositoryId} className="branch-analysis">
              <header className="branch-analysis-head">
                <div>
                  <h3>{analysis.repositoryName}</h3>
                  <p>
                    <code>{analysis.branchName}</code> contra <code>{analysis.baseBranch}</code>
                  </p>
                </div>
                <StatusChip
                  tone={
                    analysis.status === 'ok'
                      ? 'success'
                      : analysis.status === 'no_commits'
                        ? 'warning'
                        : 'danger'
                  }
                >
                  {analysis.status === 'ok'
                    ? 'Con cambios'
                    : analysis.status === 'no_commits'
                      ? 'Sin commits'
                      : 'Rama ausente'}
                </StatusChip>
              </header>

              {analysis.status === 'no_commits' ? (
                <Callout tone="warning" title="La rama no tiene commits">
                  No hay diferencias respecto a {analysis.baseBranch}. Un despliegue a este
                  ambiente debe quedar bloqueado hasta que existan cambios.
                </Callout>
              ) : analysis.status === 'branch_missing' ? (
                <Callout tone="danger" title="La rama local no existe">
                  {analysis.message}
                </Callout>
              ) : (
                <Callout tone="success" title={`${analysis.ahead} commit(s) listos`}>
                  {analysis.message}
                </Callout>
              )}

              <div className="branch-analysis-stats">
                <div>
                  <span>Base</span>
                  <code title={analysis.baseSha ?? ''}>{shortSha(analysis.baseSha)}</code>
                </div>
                <div>
                  <span>Rama</span>
                  <code title={analysis.branchSha ?? ''}>{shortSha(analysis.branchSha)}</code>
                </div>
                <div>
                  <span>Adelante</span>
                  <strong>{analysis.ahead}</strong>
                </div>
                <div>
                  <span>Atrás</span>
                  <strong>{analysis.behind}</strong>
                </div>
                <div>
                  <span>Archivos</span>
                  <strong>{analysis.files.length}</strong>
                </div>
                <div>
                  <span>Líneas</span>
                  <strong className="branch-diff-stat">
                    +{analysis.totalAdditions} / −{analysis.totalDeletions}
                  </strong>
                </div>
              </div>

              {analysis.foreignCommits > 0 ? (
                <Callout tone="warning" title={`${analysis.foreignCommits} commit(s) ajenos`}>
                  El mensaje de esos commits no menciona el Task ID. Revísalos antes de
                  incluirlos en el squash.
                </Callout>
              ) : null}

              {analysis.commits.length > 0 ? (
                <div className="branch-analysis-section">
                  <div className="branch-section-head">
                    <h4>Commits</h4>
                    <span className="req-section-meta">{analysis.commits.length}</span>
                  </div>
                  <div className="branch-commit-list">
                    {analysis.commits.map((commit) => (
                      <div key={commit.sha} className="branch-commit-row">
                        <code>{shortSha(commit.sha)}</code>
                        <span>{commit.summary}</span>
                        <span className="branch-commit-author">
                          {commit.author ?? '—'} · {formatDateTime(commit.committedAt)}
                        </span>
                        {commit.isForeign ? (
                          <StatusChip tone="warning">Ajeno</StatusChip>
                        ) : (
                          <StatusChip tone="success">Propio</StatusChip>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}

              {analysis.files.length > 0 ? (
                <div className="branch-analysis-section">
                  <div className="branch-section-head">
                    <h4>Archivos modificados</h4>
                    <span className="req-section-meta">{analysis.files.length}</span>
                  </div>
                  <div className="branch-file-list">
                    {analysis.files.map((file) => (
                      <div key={`${file.status}-${file.path}`} className="branch-file-row">
                        <span className={`branch-file-status branch-file-${file.status}`}>
                          {file.status}
                        </span>
                        <span title={file.path}>{file.path}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
            </section>
          ))}
        </div>
      )}
    </Modal>
  );
}
