/** A complete, historical file pair. Neither side comes from the live worktree. */
export interface FileSnapshot {
  before: string
  after: string
}
