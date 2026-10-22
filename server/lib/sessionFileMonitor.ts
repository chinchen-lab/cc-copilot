import { watch, type FSWatcher } from "node:fs"
import type { AgentStore, SessionFileInfo } from "../agents/types"

type FileStore = Pick<AgentStore, "sessionsRoot" | "listSessionFiles">
interface Listing {
  root: string | null
  watcher: FSWatcher | null
  dirty: boolean
  checkedAt: number
  files: SessionFileInfo[] | null
}

const BACKSTOP_MS = 30_000

/** Reuse quiet transcript listings; runtime liveness is still checked on every sweep. */
export class SessionFileMonitor {
  private readonly listings = new Map<FileStore, Listing>()

  retain(stores: readonly FileStore[]): void {
    const current = new Set(stores)
    for (const [store, listing] of this.listings) {
      if (current.has(store)) continue
      listing.watcher?.close()
      this.listings.delete(store)
    }
  }

  async list(store: FileStore): Promise<SessionFileInfo[]> {
    const root = store.sessionsRoot()
    let listing = this.listings.get(store)
    if (!listing || listing.root !== root) {
      listing?.watcher?.close()
      listing = { root, watcher: null, dirty: true, checkedAt: 0, files: null }
      this.listings.set(store, listing)
    }
    const current = listing
    if (root && !current.watcher) {
      try {
        const watcher = watch(root, { recursive: true }, (event, fileName) => {
          if (event === "rename" || !fileName || String(fileName).endsWith(".jsonl")) current.dirty = true
        })
        current.watcher = watcher
        current.dirty = true
        watcher.unref()
        watcher.on("error", () => {
          watcher.close()
          if (current.watcher === watcher) current.watcher = null
          current.dirty = true
        })
      } catch {
        // Missing roots and unsupported watchers keep the original polling path.
      }
    }
    if (current.watcher && !current.dirty && current.files && Date.now() - current.checkedAt < BACKSTOP_MS) return current.files
    current.dirty = false
    try {
      current.files = await store.listSessionFiles()
      current.checkedAt = Date.now()
      return current.files
    } catch (error) {
      current.dirty = true
      throw error
    }
  }

  close(): void { this.retain([]) }
}
