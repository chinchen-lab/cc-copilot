import { useCallback, useRef, type KeyboardEvent } from "react"

/** Let the IME own candidate selection before the composer handles shortcuts. */
export function useImeComposition() {
  const composing = useRef(false)
  const onCompositionStart = useCallback(() => { composing.current = true }, [])
  const onCompositionEnd = useCallback(() => { composing.current = false }, [])
  const isComposingEvent = useCallback((event: KeyboardEvent) => {
    // Safari ends composition before the confirming Enter, but reports 229.
    return composing.current || event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229
  }, [])
  return { onCompositionStart, onCompositionEnd, isComposingEvent }
}
