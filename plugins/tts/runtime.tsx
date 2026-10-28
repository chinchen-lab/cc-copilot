import { useEffect, useRef, useState } from "react"
import { createRoot } from "react-dom/client"
import { createPluginClient, PluginRequestError, type PluginClientOptions } from "@cogpit/plugin-sdk"
import { Button } from "@cogpit/plugin-ui/button"
import { Spinner } from "@cogpit/plugin-ui/Spinner"
import "./styles.css"

const SETUP_HINT = "Connect the speech service and choose a voice in Plugins, under Text to speech."

function clock(seconds: number): string {
  const whole = Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds)) : 0
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`
}

function PlayIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true" className="size-4 translate-x-px fill-current"><path d="M7 4.5v15a1 1 0 0 0 1.52.86l12-7.5a1 1 0 0 0 0-1.72l-12-7.5A1 1 0 0 0 7 4.5Z" /></svg>
}
function PauseIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true" className="size-4 fill-current"><rect x="6" y="4.5" width="4" height="15" rx="1" /><rect x="14" y="4.5" width="4" height="15" rx="1" /></svg>
}

export function SpeechCard({ client }: { client: ReturnType<typeof createPluginClient> }) {
  const source = client.context.surface?.source ?? ""
  const [audio, setAudio] = useState<{ url: string; voice: string } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [playing, setPlaying] = useState(false)
  const [time, setTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const pending = useRef<AbortController | null>(null)
  const player = useRef<HTMLAudioElement>(null)
  useEffect(() => () => { pending.current?.abort() }, [])
  useEffect(() => {
    if (!audio) return
    player.current?.play()?.catch(() => {})
    return () => URL.revokeObjectURL(audio.url)
  }, [audio])

  async function generate() {
    if (pending.current) return
    const abort = new AbortController()
    pending.current = abort
    setBusy(true); setError(null)
    try {
      const [settings, connection] = await Promise.all([client.settings.get({ signal: abort.signal }), client.connections.status("speech", { signal: abort.signal })])
      if (!connection.configured || !connection.selected.voice) throw new Error(SETUP_HINT)
      if (!settings || typeof settings !== "object" || Array.isArray(settings) || typeof settings.speed !== "number" || (settings.format !== "mp3" && settings.format !== "wav")) throw new Error("Check the speed and format in the plugin's settings.")
      const blob = await client.connections.media("speech", "synthesize", { input: source, speed: settings.speed, format: settings.format }, { signal: abort.signal })
      abort.signal.throwIfAborted()
      setTime(0); setDuration(0); setPlaying(false)
      setAudio({ url: URL.createObjectURL(blob), voice: connection.selected.voice.label })
    } catch (failure) {
      if (!abort.signal.aborted) setError(failure instanceof PluginRequestError
        ? failure.code === "CONNECTION_REQUIRED" || failure.code === "RESOURCE_REQUIRED" ? SETUP_HINT : "The speech service did not answer. Check the connection and try again."
        : failure instanceof Error ? failure.message : "Audio could not be generated.")
    } finally { if (pending.current === abort) { pending.current = null; setBusy(false) } }
  }
  function toggle() {
    const element = player.current
    if (busy) return
    if (!audio || !element) { void generate(); return }
    if (playing) element.pause(); else element.play()?.catch(() => setError("This audio could not be played. Generate it again."))
  }
  const label = busy ? "Preparing audio" : !audio ? "Listen" : playing ? "Pause" : "Play"
  return <section className="flex gap-3 rounded-lg border border-border bg-card p-3 text-foreground" aria-label="Text to speech">
    <Button type="button" size="icon" className="mt-0.5 rounded-full" aria-label={label} aria-busy={busy} onClick={toggle}>
      {busy ? <Spinner className="size-4" /> : audio && playing ? <PauseIcon /> : <PlayIcon />}
    </Button>
    <div className="flex min-w-0 flex-1 flex-col gap-2">
      <p className="m-0 max-h-56 overflow-y-auto whitespace-pre-wrap text-sm leading-relaxed [overflow-wrap:anywhere]">{source}</p>
      {audio && <div className="flex items-center gap-3">
        <input type="range" className="speech-seek" aria-label="Position" min={0} max={duration || 0} step={0.1} value={Math.min(time, duration || 0)} disabled={!duration}
          style={{ "--played": `${duration ? (time / duration) * 100 : 0}%` } as React.CSSProperties}
          onChange={event => { if (player.current) player.current.currentTime = Number(event.target.value) }} />
        <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{clock(time)} / {clock(duration)}</span>
      </div>}
      <div className="flex min-h-5 flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
        {error ? <p role="alert" className="m-0 text-destructive">{error}</p>
          : busy ? <><span>Preparing audio with your voice settings.</span><button type="button" className="cursor-pointer rounded-sm bg-transparent p-0 text-foreground underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-ring" onClick={() => pending.current?.abort()}>Cancel</button></>
          : audio ? <span>{audio.voice} voice</span> : <span>Press play to generate audio.</span>}
        {audio && !busy && <button type="button" className="cursor-pointer rounded-sm bg-transparent p-0 underline-offset-4 hover:text-foreground hover:underline focus-visible:outline-2 focus-visible:outline-ring" onClick={() => { void generate() }}>Generate again</button>}
      </div>
    </div>
    {audio && <audio ref={player} preload="metadata" src={audio.url} aria-label="Generated speech"
      onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onEnded={() => { setPlaying(false); setTime(0) }}
      onTimeUpdate={event => setTime(event.currentTarget.currentTime)} onDurationChange={event => setDuration(Number.isFinite(event.currentTarget.duration) ? event.currentTarget.duration : 0)}
      onError={() => setError("This audio could not be played. Generate it again.")} />}
  </section>
}

function mountSpeech(options: PluginClientOptions): () => void {
  const client = createPluginClient(options)
  const element = document.createElement("div")
  document.body.append(element)
  const root = createRoot(element)
  const surface = client.context.surface
  if (surface?.type === "chat-block" && surface.id === "speech") root.render(<SpeechCard client={client} />)
  let lastHeight = 0
  const observer = new ResizeObserver(() => {
    if (!surface || !client.context.visible) return
    const height = Math.max(80, Math.min(800, Math.ceil(element.getBoundingClientRect().height)))
    if (height !== lastHeight) { lastHeight = height; void client.ui.resize(height).catch(() => {}) }
  })
  observer.observe(element)
  let disposed = false
  function dispose() {
    if (disposed) return
    disposed = true; observer.disconnect(); root.unmount(); element.remove(); client.dispose()
    window.removeEventListener("pagehide", dispose)
  }
  window.addEventListener("pagehide", dispose, { once: true })
  void client.ready().catch(dispose)
  return dispose
}
Object.assign(globalThis, { cogpitPlugin: mountSpeech })
