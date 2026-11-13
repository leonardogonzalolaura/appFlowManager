export type Tone = 'success' | 'warning' | 'danger' | 'info' | 'neutral';

export type ViewId =
  | 'inicio'
  | 'requerimientos'
  | 'lotes'
  | 'repositorios'
  | 'bases'
  | 'configuracion';

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

export interface RequirementFilter {
  search?: string;
  source?: string;
  developers?: string[];
  statuses?: string[];
  priority?: string;
  feature?: string;
  includeArchived?: boolean;
}

export interface RequirementListItem {
  id: string;
  externalKey: string;
  source: 'monday' | 'manual';
  title: string;
  type: string | null;
  feature: string | null;
  developer: string | null;
  status: string | null;
  priority: string | null;
  repoCount: number;
  manualCreated: boolean;
  manualLocked: boolean;
  updatedAt: string;
  lastImportPresent: boolean;
  archivedAt: string | null;
}

export interface RequirementPage {
  items: RequirementListItem[];
  total: number;
  page: number;
  pageSize: number;
}

export interface RequirementSubtask {
  id: string;
  name: string;
  owner: string | null;
  status: string | null;
  estimatedSp: number | null;
  actualSp: number | null;
  positionNo: number;
}

export interface RequirementRepositoryMapping {
  id: string;
  repositoryId: string;
  name: string;
  localPath: string;
  branchName: string;
  baseBranch: string;
  branchStatus: string;
  mappingSource: string;
  notes: string | null;
  baseSha: string | null;
  branchCreatedAt: string | null;
  lastAnalyzedAt: string | null;
  createdByApp: boolean;
}

export interface BranchCommit {
  sha: string;
  summary: string;
  author: string | null;
  committedAt: string;
  isForeign: boolean;
  /** Rama del requerimiento que aporta el commit (selección de despliegue). */
  sourceBranch?: string | null;
  /** Clave del requerimiento dueño de esa rama. */
  requirementKey?: string | null;
}

export interface BranchCheck {
  branchName: string;
  baseBranch: string;
  baseRef: string;
  baseSha: string | null;
  localExists: boolean;
  remoteExists: boolean;
  localSha: string | null;
  ahead: number;
  behind: number;
  commits: BranchCommit[];
  warning: string | null;
  fetched: boolean;
  fetchError: string | null;
}

export interface BranchFile {
  path: string;
  status: string;
}

export interface BranchAnalysis {
  branchName: string;
  baseBranch: string;
  baseRef: string;
  status: 'ok' | 'no_commits' | 'branch_missing';
  baseSha: string | null;
  branchSha: string | null;
  mergeBaseSha: string | null;
  ahead: number;
  behind: number;
  commits: BranchCommit[];
  files: BranchFile[];
  totalAdditions: number;
  totalDeletions: number;
  foreignCommits: number;
  message: string;
}

export interface RepositoryBranchAnalysis extends BranchAnalysis {
  repositoryId: string;
  repositoryName: string;
}

export interface BranchOperationResult {
  branchName: string;
  baseBranch: string;
  baseSha: string | null;
  localExisted: boolean;
  remoteExisted: boolean;
  created: boolean;
  preserved: boolean;
  recreated: boolean;
  pushed: boolean;
  message: string;
}

export interface SquashCandidate {
  requirementId: string;
  externalKey: string;
  title: string;
  type: string | null;
  branchName: string;
  branchStatus: string;
  ahead: number;
  behind: number;
  commits: BranchCommit[];
  available: boolean;
  warning: string | null;
}

export interface SquashRequirementRef {
  id: string;
  externalKey: string;
  title: string;
}

export interface SquashSession {
  id: string;
  batchId: string | null;
  repositoryId: string;
  repositoryName: string;
  githubOwner: string | null;
  githubRepo: string | null;
  environment: string | null;
  targetBranch: string | null;
  targetBaseSha: string | null;
  deployBranch: string | null;
  deploySha: string | null;
  pushedSha: string | null;
  pushedAt: string | null;
  phase: 'squash' | 'deploy';
  baseBranch: string;
  baseRef: string;
  baseSha: string;
  internalBranch: string;
  worktreePath: string;
  strategy: 'all_commits' | 'selected_commits';
  status: 'preparing' | 'conflict' | 'ready' | 'no_changes' | 'aborted' | 'failed';
  message: string;
  selectedRequirements: SquashRequirementRef[];
  selectedCommits: BranchCommit[];
  conflicts: string[];
  currentAction: string | null;
  squashSha: string | null;
  filesChanged: number;
  additions: number;
  deletions: number;
  deployFilesChanged: number;
  deployAdditions: number;
  deployDeletions: number;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface DeploymentReport {
  squashFiles: string[];
  alreadyInEnvironment: string[];
  deployFiles: string[];
  whitespaceOnlyFiles: string[];
  additions: number;
  deletions: number;
}

export interface SquashPrepareInput {
  repositoryId: string;
  requirementIds: string[];
  strategy: 'all_commits' | 'selected_commits';
  commitShas?: string[];
  message?: string;
}

export interface DeploymentRequirementRef {
  requirementId: string;
  externalKey: string;
  title: string;
  branchName: string;
  branchStatus: string;
}

export interface DeploymentRepoGroup {
  repositoryId: string;
  repositoryName: string;
  localPath: string;
  targetBranch: string | null;
  targetSha: string | null;
  requirements: DeploymentRequirementRef[];
  available: boolean;
  warning: string | null;
  common: boolean;
}

export interface DeploymentPreview {
  environment: string;
  environmentLabel: string;
  repositories: DeploymentRepoGroup[];
  requirementCount: number;
  commonRepositoryCount: number;
  unmappedRequirements: SquashRequirementRef[];
}

export type EnvironmentPresenceStatus =
  | 'applied'
  | 'partial'
  | 'pending'
  | 'unknown'
  | 'no_changes';

export interface EnvironmentPresence {
  environment: string;
  label: string;
  color: string | null;
  branch: string | null;
  status: EnvironmentPresenceStatus;
  filesTotal: number;
  filesApplied: number;
  filesPending: number;
  evidence: 'ancestry' | 'content' | 'none';
  pendingFiles: string[];
  pushedAt: string | null;
  pushedBranch: string | null;
  detail: string | null;
}

export interface RepositoryPresence {
  repositoryId: string;
  repositoryName: string;
  branchName: string;
  branchStatus: string;
  environments: EnvironmentPresence[];
}

export interface RequirementPresence {
  requirementId: string;
  externalKey: string;
  repositories: RepositoryPresence[];
}

export interface AppSettings {
  baseBranch: string;
  manualKeyPrefix: string;
  mondaySubdomain: string;
  gitUserName: string;
  gitUserEmail: string;
  gitConfigUserName: string | null;
  gitConfigUserEmail: string | null;
}

export interface DeploymentCleanupResult {
  sessions: SquashSession[];
  cleanedBranches: string[];
  failedBranches: string[];
}

export interface DeploymentDeleteResult {
  deletedSessions: number;
  cleanedBranches: string[];
  failedBranches: string[];
}

export interface DeploymentBatchSummary {
  batchId: string;
  environment: string | null;
  environmentLabel: string;
  status:
    | 'conflict'
    | 'completed'
    | 'ready_push'
    | 'ready_create'
    | 'failed'
    | 'cancelled'
    | 'in_progress';
  createdAt: string;
  updatedAt: string;
  repositoryCount: number;
  requirementCount: number;
  pushedCount: number;
  pendingCount: number;
  conflictCount: number;
  repositories: string[];
  requirements: SquashRequirementRef[];
}

export type DbEngine = 'sqlserver' | 'postgres';

export interface DbConnectionSummary {
  id: string;
  repositoryId: string | null;
  repositoryName: string | null;
  environment: string;
  environmentLabel: string;
  engine: DbEngine;
  host: string;
  port: number;
  databaseName: string;
  username: string;
  sslMode: string | null;
  isActive: boolean;
  hasPassword: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface DbConnectionInput {
  id?: string;
  repositoryId?: string | null;
  environment: string;
  engine: DbEngine;
  host: string;
  port: number;
  databaseName: string;
  username: string;
  password?: string;
  sslMode?: string | null;
  isActive?: boolean;
}

export interface DbConnectionTestResult {
  ok: boolean;
  latencyMs: number;
  message: string;
}

export interface DbScriptSummary {
  id: string;
  requirementId: string;
  requirementKey: string;
  repositoryId: string;
  repositoryName: string;
  name: string;
  engine: DbEngine;
  sequenceNo: number;
  environmentScope: string;
  sourceType: 'inline' | 'file';
  content: string | null;
  filePath: string | null;
  checksum: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface DbScriptInput {
  id?: string;
  requirementId: string;
  repositoryId: string;
  name: string;
  engine: DbEngine;
  sequenceNo?: number;
  environmentScope?: string;
  sourceType?: 'inline' | 'file';
  content?: string;
  filePath?: string | null;
  isActive?: boolean;
}

export interface DbScriptValidation {
  valid: boolean;
  warnings: string[];
}

export interface DbScriptExecutionResult {
  scriptId: string;
  scriptName: string;
  engine: DbEngine;
  environment: string;
  status: 'success' | 'failed' | 'skipped';
  output: string | null;
  error: string | null;
  durationMs: number;
  executedAt: string;
}

export interface DbExecutionSummary {
  id: string;
  scriptId: string | null;
  requirementId: string | null;
  repositoryId: string | null;
  scriptName: string;
  engine: DbEngine;
  environment: string;
  status: 'success' | 'failed' | 'skipped';
  output: string | null;
  error: string | null;
  durationMs: number;
  executedAt: string;
}

export type NoteLevel = 'info' | 'warning' | 'danger';

export interface RequirementDetail {
  id: string;
  externalKey: string;
  source: 'monday' | 'manual';
  title: string;
  type: string | null;
  feature: string | null;
  status: string | null;
  priority: string | null;
  developer: string | null;
  qa: string | null;
  informed: string | null;
  subtasksSummary: string | null;
  timelineStart: string | null;
  timelineEnd: string | null;
  mondayDocUrl: string | null;
  sourceCreatedAt: string | null;
  sourceUpdatedAt: string | null;
  firstSeenAt: string;
  lastSeenAt: string;
  lastImportPresent: boolean;
  manualCreated: boolean;
  manualLocked: boolean;
  isActive: boolean;
  archivedAt: string | null;
  notes: string | null;
  noteLevel: NoteLevel;
  createdAt: string;
  updatedAt: string;
  subtasks: RequirementSubtask[];
  repositories: RequirementRepositoryMapping[];
}

export interface RequirementFacets {
  developers: string[];
  statuses: string[];
  priorities: string[];
  features: string[];
}

export interface ImportFieldChange {
  field: string;
  from: string | null;
  to: string | null;
}

export interface ImportPreviewItem {
  externalKey: string;
  title: string;
  developer: string | null;
  status: string | null;
  feature: string | null;
  type: string | null;
  subtaskCount: number;
}

export interface ImportUpdatedItem {
  externalKey: string;
  title: string;
  changes: ImportFieldChange[];
}

export interface ImportManualConflict {
  externalKey: string;
  title: string;
  developer: string | null;
  manualLocked: boolean;
  archived: boolean;
}

export interface ImportAbsentItem {
  externalKey: string;
  title: string;
  developer: string | null;
  status: string | null;
}

export interface ImportInvalidRow {
  rowNumber: number;
  reason: string;
  preview: string;
}

export interface ImportPreview {
  source: string;
  fileName: string;
  fileHash: string;
  totalRows: number;
  newCount: number;
  updatedCount: number;
  unchangedCount: number;
  absentCount: number;
  manualConflictCount: number;
  invalidCount: number;
  duplicateCount: number;
  newItems: ImportPreviewItem[];
  updatedItems: ImportUpdatedItem[];
  manualConflicts: ImportManualConflict[];
  absentItems: ImportAbsentItem[];
  invalidRows: ImportInvalidRow[];
  duplicateKeys: string[];
}

export interface ImportResult {
  importId: string;
  total: number;
  created: number;
  updated: number;
  unchanged: number;
  absent: number;
  skippedManual: number;
  adoptedManual: number;
  lockedManual: number;
}

export interface ManualRequirementInput {
  externalKey?: string;
  title: string;
  feature?: string;
  type?: string;
  developer?: string;
  qa?: string;
  status?: string;
  priority?: string;
  notes?: string;
  manualLocked?: boolean;
  repositoryIds?: string[];
}

export interface ManualRequirementPatch {
  title?: string;
  feature?: string;
  type?: string;
  developer?: string;
  qa?: string;
  status?: string;
  priority?: string;
  notes?: string;
  noteLevel?: NoteLevel;
  manualLocked?: boolean;
}
