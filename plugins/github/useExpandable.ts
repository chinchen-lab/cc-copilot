import { useCallback, useEffect, useRef, useState } from "react"
import type { GitHubErrorResponse } from "@cogpit/plugin-integrations"
import { toErrorResponse } from "./githubStore.js"

export interface LazyResourceState<T> {
  data: T | null
  error: GitHubErrorResponse | null
  loading: boolean
}

interface LoadedState<T> extends LazyResourceState<T> {
  revision?: string
}

const EMPTY_STATE: LoadedState<never> = { data: null, error: null, loading: false }

/**
 * Detail behind a collapsible row: fetched the first time it opens, and again
 * on every open while `stale` says the row is still moving. A row that starts
 * open fetches on mount, and `prefetch` reads it without opening. Detail read
 * for an earlier `revision` is read again.
 */
export function useExpandable<T>(
  fetchDetail: () => Promise<T>,
  fallbackError: string,
  stale = false,
  initiallyOpen = false,
  revision?: string,
): {
  open: boolean
  state: LazyResourceState<T>
  onOpenChange: (next: boolean) => void
  prefetch: () => void
} {
  const [open, setOpen] = useState(initiallyOpen)
  const [state, setState] = useState<LoadedState<T>>(EMPTY_STATE)
  const pendingInitialLoad = useRef(initiallyOpen)
  const outdated = state.data !== null && state.revision !== revision

  const load = useCallback(async (): Promise<void> => {
    if (state.loading) return
    setState((current) => ({ ...current, error: null, loading: true }))
    try {
      setState({ data: await fetchDetail(), error: null, loading: false, revision })
    } catch (error) {
      setState({ data: null, error: toErrorResponse(error, fallbackError), loading: false })
    }
  }, [fetchDetail, fallbackError, state.loading, revision])

  useEffect(() => {
    if (!pendingInitialLoad.current) return
    pendingInitialLoad.current = false
    void load()
  }, [load])

  useEffect(() => {
    if (outdated) void load()
  }, [outdated, load])

  function onOpenChange(next: boolean): void {
    setOpen(next)
    if (next && (!state.data || stale)) void load()
  }

  function prefetch(): void {
    if (!state.data) void load()
  }

  return {
    open,
    state: outdated ? { data: null, error: null, loading: state.loading } : state,
    onOpenChange,
    prefetch,
  }
}
