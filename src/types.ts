export type Tone = 'success' | 'warning' | 'danger' | 'info' | 'neutral';

export type ViewId = 'inicio' | 'repositorios' | 'configuracion';

export interface GitStatus {
  available: boolean;
  version: string | null;
  message: string | null;
}

export interface Counts {
  repositories: number;
  requirements: number;
  databaseConnections: number;
  activeRuns: number;
}

export interface SetupStatus {
  gitOk: boolean;
  databaseOk: boolean;
  repositoriesOk: boolean;
  requirementsOk: boolean;
  databaseConfigured: boolean;
  completedSteps: number;
  totalSteps: number;
}

export interface SystemInfo {
  appVersion: string;
  os: string;
  arch: string;
  dataDir: string;
  dbPath: string;
  dbReady: boolean;
  dbError: string | null;
  dbSizeBytes: number;
  schemaVersion: number | null;
  logsDir: string;
  backupsDir: string;
  worktreesDir: string;
  git: GitStatus;
  counts: Counts;
  setup: SetupStatus;
  startedAt: string;
  /** Solo en el preview web, sin backend Tauri. */
  demo?: boolean;
}

export interface ApiError {
  code: string;
  message: string;
  details?: string | null;
  retryable?: boolean;
  context?: unknown;
}

export type ResolutionMode = 'auto' | 'manual';

export interface EnvironmentDefinition {
  key: string;
  label: string;
  color: string;
  position: number;
  aliases: string[];
  pattern: string | null;
  isSystem: boolean;
  resolvedCount: number;
  repositoryCount: number;
}

export interface CreateEnvironmentInput {
  key: string;
  label?: string;
  color?: string;
  aliases?: string[];
  pattern?: string;
}

export interface UpdateEnvironmentInput {
  key: string;
  label?: string;
  color?: string;
  aliases?: string[];
  pattern?: string;
}

export interface BranchCandidate {
  name: string;
  sha: string;
  committedAt: string;
  version: string | null;
}

export interface EnvironmentState {
  environment: string;
  label: string;
  color: string;
  position: number;
  branchName: string | null;
  mode: ResolutionMode;
  sha: string | null;
  resolvedAt: string | null;
  note: string;
  ambiguous: boolean;
  available: boolean;
  usesBaseBranch: boolean;
  warning: string | null;
  candidates: BranchCandidate[];
}

export interface BranchInfo {
  name: string;
  sha: string;
  committedAt: string;
  author: string | null;
  message: string | null;
  isRemote: boolean;
}

export interface RepositorySummary {
  id: string;
  name: string;
  localPath: string;
  remoteName: string;
  remoteUrl: string | null;
  provider: string;
  githubOwner: string | null;
  githubRepo: string | null;
  baseBranch: string;
  lastFetchedAt: string | null;
  environments: EnvironmentState[];
  configuredCount: number;
  pathWarning: string | null;
  warnings: string[];
}

export interface RepositoryDetail extends RepositorySummary {
  branches: BranchInfo[];
  headBranch: string | null;
  defaultBranch: string;
  createdAt: string;
  updatedAt: string;
}

export interface FetchResult {
  repository: RepositoryDetail;
  message: string;
  branchCount: number;
  durationMs: number;
}

export interface AddRepositoryInput {
  path: string;
  name?: string;
  baseBranch?: string;
}

export interface CloneRepositoryInput {
  url: string;
  parentDir: string;
  folderName?: string;
  name?: string;
  baseBranch?: string;
}

export interface UpdateRepositoryInput {
  repositoryId: string;
  name?: string;
  baseBranch?: string;
  githubOwner?: string;
  githubRepo?: string;
}

export interface SetEnvironmentInput {
  repositoryId: string;
  environment: string;
  mode: ResolutionMode;
  branchName?: string;
}
