import { useTranslation } from "@/hooks/useTranslation"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  AlertTriangle,
  CheckCircle2,
  GripVertical,
  KeyRound,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  ShieldAlert,
  Trash2,
  XCircle,
} from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import { ConfirmActionDialog } from "@/components/shared/ConfirmActionDialog"
import { InlineEditPanel } from "@/components/shared/InlineEditPanel"
import { cn } from "@/lib/utils"
import { switchDevice } from "@/lib/device"
import { useDragReorder, type DragHandleProps } from "@/hooks/useDragReorder"
import { shortcutLabel, type KeybindingCommand } from "@/lib/keybindings"
import {
  deviceSignIn,
  deviceVersion,
  useDevices,
  type DeviceHello,
  type MutationResult,
  type ProbeResult,
  type PublicDevice,
  type UpdateDeviceInput,
} from "@/hooks/useDevices"
import packageJson from "../../package.json"

const HUB_VERSION = packageJson.version
const DEFAULT_PORT = 19384
const DEFAULT_TLS_PORT = 443
const PROBE_DEBOUNCE_MS = 450

const SWITCH_TIP = shortcutLabel("device.switch.1").replace(/1$/, "1–9")

// Which field an add-error code belongs under.
const PASSWORD_CODES = new Set(["BAD_PASSWORD", "PASSWORD_REQUIRED", "USERNAME_REQUIRES_PASSWORD"])
const USERNAME_CODES = new Set(["ACCOUNT_REFUSED"])

interface DevicesDialogProps {
  open: boolean
  initialMode: "add" | "manage"
  onClose: () => void
}

/**
 * Split a "host" or "host:port" entry. A pasted `https://` prefix marks the
 * device as TLS (default port 443); a pasted `http://` prefix is just dropped.
 */
export function parseHostPort(input: string): { host: string; port?: number; tls?: true } {
  const trimmed = input.trim()
  const tls = /^https:\/\//i.test(trimmed)
  const noScheme = trimmed.replace(/^https?:\/\//i, "").replace(/\/.*$/, "")
  const match = /^(.+):(\d+)$/.exec(noScheme)
  const host = match ? match[1] : noScheme
  const port = match ? Number(match[2]) : undefined
  return tls ? { host, port, tls: true } : { host, port }
}

type ProbeTone = "ok" | "warn" | "info" | "error"

interface ProbeDisplayState {
  tone: ProbeTone
  text: string
  hello?: DeviceHello
}

/** Turn a probe result into actionable, human copy. */
export function probeMessage(
  result: ProbeResult,
  host: string,
  port: number,
): { tone: ProbeTone; text: string } {
  if (result.ok) {
    if (result.hello.signIn === "account" && result.hello.setupRequired === true) {
      return {
        tone: "info",
        text: "Reachable server — finish its setup before adding it here.",
      }
    }
    if (result.hello.signIn !== "account" && result.hello.networkAccess === false) {
      return {
        tone: "warn",
        text: "Cogpit is running but network access is disabled — enable it in that device's settings.",
      }
    }
    if (result.hello.configured === false) {
      return {
        tone: "info",
        text: "Reachable — this device hasn't finished setup yet and will show its setup screen.",
      }
    }
    const name = result.hello.name ? ` "${result.hello.name}"` : ""
    const version = result.hello.version ? ` (v${result.hello.version})` : ""
    return { tone: "ok", text: `Found Cogpit${name}${version}.` }
  }
  switch (result.code) {
    case "UNREACHABLE":
      return {
        tone: "error",
        text: `Can't reach ${host}:${port}. Is Cogpit running with network access enabled?`,
      }
    case "LEGACY_NO_HELLO":
      return { tone: "error", text: "That Cogpit is too old for multi-device — update it." }
    case "NOT_COGPIT":
      return { tone: "error", text: "Something responded, but it isn't Cogpit." }
    case "SELF_ADD":
      return { tone: "error", text: "That's this machine." }
    default:
      return { tone: "error", text: result.error ?? "Could not reach the device." }
  }
}

const TONE_CLASS: Record<ProbeTone, string> = {
  ok: "text-success",
  warn: "text-warning",
  info: "text-info",
  error: "text-destructive",
}

function ToneIcon({ tone }: { tone: ProbeTone }) {
  const className = cn("size-3.5 shrink-0", TONE_CLASS[tone])
  if (tone === "ok") return <CheckCircle2 data-icon="inline-start" className={className} />
  if (tone === "warn") return <AlertTriangle data-icon="inline-start" className={className} />
  if (tone === "info") return <RefreshCw data-icon="inline-start" className={className} />
  return <XCircle data-icon="inline-start" className={className} />
}

// ── Existing-device row ──────────────────────────────────────────────────────

const AUTH_STATE_DOT: Record<PublicDevice["runtime"]["authState"], string> = {
  ok: "bg-success",
  unknown: "bg-warning",
  "bad-password": "bg-destructive",
}

interface DeviceRowProps {
  device: PublicDevice
  onRename: (id: string, name: string) => Promise<void>
  onCredentials: (id: string, patch: UpdateDeviceInput) => Promise<MutationResult>
  onRemove: (id: string) => Promise<void>
  onTest: (id: string) => Promise<void>
  /** Shortcut slot (1–9) this row opens; `this machine` always holds slot 1. */
  slot: number
  rowRef: (element: HTMLElement | null) => void
  dragging: boolean
  dragHandleProps: DragHandleProps
}

function DeviceRow({
  device,
  onRename,
  onCredentials,
  onRemove,
  onTest,
  slot,
  rowRef,
  dragging,
  dragHandleProps,
}: DeviceRowProps) {
  const { t } = useTranslation()
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(device.name)
  const [editingCredentials, setEditingCredentials] = useState(false)
  const [credentialUsername, setCredentialUsername] = useState(device.username ?? "")
  const [credentialPassword, setCredentialPassword] = useState("")
  const [credentialError, setCredentialError] = useState<string | null>(null)
  const [removeOpen, setRemoveOpen] = useState(false)
  const [busy, setBusy] = useState<null | "rename" | "credentials" | "test">(null)

  useEffect(() => {
    setName(device.name)
  }, [device.name])

  useEffect(() => {
    setCredentialUsername(device.username ?? "")
  }, [device.username])

  const version = deviceVersion(device)
  const skewed = version !== undefined && version !== HUB_VERSION
  const accountDevice = deviceSignIn(device) === "account"
  const hasShortcut = slot <= 9

  async function saveName() {
    const trimmed = name.trim()
    if (!trimmed || trimmed === device.name) {
      setEditing(false)
      setName(device.name)
      return
    }
    setBusy("rename")
    await onRename(device.id, trimmed)
    setBusy(null)
    setEditing(false)
  }

  async function saveCredentials() {
    const username = credentialUsername.trim()
    const currentUsername = device.username ?? ""
    const usernameChanged = username !== currentUsername
    const passwordChanged = credentialPassword.length > 0
    if (!usernameChanged && !passwordChanged) {
      setEditingCredentials(false)
      setCredentialPassword("")
      setCredentialError(null)
      return
    }
    if (device.auth === "none" && !passwordChanged) {
      setCredentialError("Enter a password when adding an account to an unauthenticated device.")
      return
    }

    const patch: UpdateDeviceInput = {}
    if (usernameChanged) patch.username = username || null
    if (passwordChanged) patch.password = credentialPassword

    setBusy("credentials")
    setCredentialError(null)
    const result = await onCredentials(device.id, patch)
    setBusy(null)
    if (!result.ok) {
      setCredentialError(result.error)
      return
    }
    setEditingCredentials(false)
    setCredentialPassword("")
  }

  return (
    <div
      ref={rowRef}
      className={cn("rounded-lg border bg-card", dragging && "relative z-10 shadow-lg")}
    >
      <div className="flex items-center gap-2.5 px-3 py-2">
        <button
          type="button"
          aria-label={t("Reorder {0}", { "0": device.name })}
          title={t("Drag to reorder (or use ↑ ↓)")}
          className="-ml-1 flex size-6 shrink-0 cursor-grab touch-none items-center justify-center rounded text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring active:cursor-grabbing"
          {...dragHandleProps}
        >
          <GripVertical className="size-4" />
        </button>
        <span
          className="w-4 shrink-0 text-center font-mono text-xs text-muted-foreground"
          title={hasShortcut ? t("{0} opens this device", { "0": shortcutLabel(`device.switch.${slot}` as KeybindingCommand) }) : t("No shortcut")}
        >
          {hasShortcut && slot}
        </span>
        <span
          aria-label={t("Status: {0}", { "0": device.runtime.authState })}
          className={cn("size-2 shrink-0 rounded-full", AUTH_STATE_DOT[device.runtime.authState])}
        />
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          {editing ? (
            <Input
              value={name}
              autoFocus
              aria-label={t("Rename {0}", { "0": device.name })}
              onChange={(event) => setName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") void saveName()
                if (event.key === "Escape") {
                  setEditing(false)
                  setName(device.name)
                }
              }}
              onBlur={() => void saveName()}
              className="h-6 text-sm"
            />
          ) : (
            <div className="flex items-center gap-1.5">
              <span className="truncate text-sm text-foreground">{device.name}</span>
              {version && (
                <span
                  className={cn("shrink-0 font-mono text-xs", skewed ? "text-warning" : "text-muted-foreground")}
                  title={skewed ? t("Device runs v{0}; hub runs v{1}", { "0": version, "1": HUB_VERSION }) : undefined}
                >
                  v{version}
                  {skewed && t(" ≠ hub")}
                </span>
              )}
              {device.auth === "none" && (
                <Badge variant="secondary">{t("Unauthenticated")}</Badge>
              )}
            </div>
          )}
          <span className="truncate font-mono text-xs text-muted-foreground">
            {device.tls ? "https://" : ""}{device.host}:{device.port}
          </span>
          {device.username ? (
            <span className="truncate text-xs text-muted-foreground" title={device.username}>
              {t("Account: ")}{device.username}
            </span>
          ) : accountDevice ? (
            <span className="text-xs text-warning">{t("Account not configured")}</span>
          ) : null}
        </div>

        <div className="flex shrink-0 items-center gap-0.5">
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={t("Re-test {0}", { "0": device.name })}
            disabled={busy === "test"}
            onClick={async () => {
              setBusy("test")
              await onTest(device.id)
              setBusy(null)
            }}
          >
            <RefreshCw data-icon="inline-start" className={cn(busy === "test" && "animate-spin")} />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={t("Edit account for {0}", { "0": device.name })}
            onClick={() => {
              setEditingCredentials((value) => !value)
              setCredentialUsername(device.username ?? "")
              setCredentialPassword("")
              setCredentialError(null)
            }}
          >
            <KeyRound data-icon="inline-start" />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={t("Rename {0}", { "0": device.name })}
            onClick={() => setEditing(true)}
          >
            <Pencil data-icon="inline-start" />
          </Button>
          <ConfirmActionDialog
            open={removeOpen}
            onOpenChange={setRemoveOpen}
            trigger={(
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={t("Remove {0}", { "0": device.name })}
                className="text-destructive hover:bg-destructive/10 hover:text-destructive"
              >
                <Trash2 data-icon="inline-start" />
              </Button>
            )}
            title={<>{t("Remove ")}{device.name}?</>}
            description={t("This device will disappear from Cogpit. You can add it again later.")}
            confirmLabel="Remove device"
            destructive
            onConfirm={async () => {
              await onRemove(device.id)
              return null
            }}
          />
        </div>
      </div>

      {editingCredentials && (
        <InlineEditPanel
          error={credentialError}
          busy={busy === "credentials"}
          saveLabel="Save account"
          onCancel={() => {
            setEditingCredentials(false)
            setCredentialUsername(device.username ?? "")
            setCredentialPassword("")
            setCredentialError(null)
          }}
          onSave={() => void saveCredentials()}
        >
          <div className="grid gap-2 sm:grid-cols-2">
            <Field>
              <FieldLabel htmlFor={`device-username-${device.id}`}>
                {t("Username ")}<span className="text-muted-foreground/60">{t("(account sign-in)")}</span>
              </FieldLabel>
              <Input
                id={`device-username-${device.id}`}
                aria-label={t("Username for {0}", { "0": device.name })}
                value={credentialUsername}
                onChange={(event) => setCredentialUsername(event.target.value)}
                placeholder={t("Leave empty for password-only auth")}
                autoComplete="off"
                spellCheck={false}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor={`device-password-${device.id}`}>
                {t("New password ")}<span className="text-muted-foreground/60">{t("(optional)")}</span>
              </FieldLabel>
              <Input
                id={`device-password-${device.id}`}
                aria-label={t("New password for {0}", { "0": device.name })}
                type="password"
                value={credentialPassword}
                onChange={(event) => setCredentialPassword(event.target.value)}
                placeholder={t("Leave blank to keep the stored password")}
                autoComplete="new-password"
              />
            </Field>
          </div>
          {device.username && credentialUsername.trim() === "" && (
            <p className="text-xs text-warning">
              {t("Clearing the username switches this device back to password-only authentication.")}
            </p>
          )}
        </InlineEditPanel>
      )}
    </div>
  )
}

// ── Dialog ───────────────────────────────────────────────────────────────────

export function DevicesDialog({ open, initialMode, onClose }: DevicesDialogProps) {
  const { t } = useTranslation()
  const { devices, refresh, probe, addDevice, updateDevice, removeDevice, reorderDevices, testDevice } = useDevices()

  const [name, setName] = useState("")
  const [hostInput, setHostInput] = useState("")
  const [username, setUsername] = useState("")
  const [password, setPassword] = useState("")
  const [allowLocalTunnel, setAllowLocalTunnel] = useState(false)
  const [probing, setProbing] = useState(false)
  const [probeState, setProbeState] = useState<ProbeDisplayState | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<{ field: "host" | "username" | "password"; message: string } | null>(null)

  const hostRef = useRef<HTMLInputElement>(null)
  const probeSeq = useRef(0)

  // Reset the form each time the dialog opens; focus the host field in add mode.
  useEffect(() => {
    if (!open) return
    setName("")
    setHostInput("")
    setUsername("")
    setPassword("")
    setAllowLocalTunnel(false)
    setProbing(false)
    setProbeState(null)
    setSubmitError(null)
    if (initialMode === "add") {
      requestAnimationFrame(() => hostRef.current?.focus())
    }
  }, [open, initialMode])

  const runProbe = useCallback(async () => {
    const { host, port, tls } = parseHostPort(hostInput)
    if (!host) {
      setProbeState(null)
      setProbing(false)
      return
    }
    const seq = ++probeSeq.current
    setProbing(true)
    const result = await probe(host, port, allowLocalTunnel, tls)
    if (seq !== probeSeq.current) return // a newer probe superseded this one
    setProbeState({
      ...probeMessage(result, host, port ?? (tls ? DEFAULT_TLS_PORT : DEFAULT_PORT)),
      hello: result.ok ? result.hello : undefined,
    })
    setProbing(false)
  }, [hostInput, probe, allowLocalTunnel])

  // Debounced live probe as the host is typed.
  useEffect(() => {
    if (!open) return
    if (!parseHostPort(hostInput).host) {
      setProbeState(null)
      setProbing(false)
      return
    }
    const timer = window.setTimeout(() => void runProbe(), PROBE_DEBOUNCE_MS)
    return () => window.clearTimeout(timer)
  }, [open, hostInput, runProbe])

  const targetUsesAccounts = probeState?.hello?.signIn === "account"
  const targetNeedsSetup = targetUsesAccounts && probeState?.hello?.setupRequired === true
  const credentialsRequired = targetUsesAccounts || !allowLocalTunnel

  const canSubmit = useMemo(() => {
    if (submitting) return false
    if (!parseHostPort(hostInput).host) return false
    if (probing || !probeState) return false
    if (targetNeedsSetup) return false
    if (credentialsRequired && !password) return false
    if (targetUsesAccounts && !username.trim()) return false
    if (probeState?.tone === "error") return false
    return true
  }, [submitting, hostInput, probing, probeState, targetNeedsSetup, credentialsRequired, targetUsesAccounts, username, password])

  async function handleSubmit() {
    const { host, port, tls } = parseHostPort(hostInput)
    if (!host) return
    setSubmitting(true)
    setSubmitError(null)
    const result = await addDevice({
      name: name.trim() || undefined,
      host,
      port,
      tls,
      username: targetUsesAccounts ? username.trim() : undefined,
      password: credentialsRequired ? password || undefined : undefined,
      allowLocalTunnel,
    })
    setSubmitting(false)
    if (result.ok) {
      onClose()
      switchDevice(result.device.id)
      return
    }
    setSubmitError({
      field: USERNAME_CODES.has(result.code)
        ? "username"
        : PASSWORD_CODES.has(result.code) ? "password" : "host",
      message: result.error,
    })
  }

  const handleRename = useCallback(
    async (id: string, next: string) => {
      await updateDevice(id, { name: next })
    },
    [updateDevice],
  )
  const handleRemove = useCallback(
    async (id: string) => {
      await removeDevice(id)
    },
    [removeDevice],
  )
  const { order, draggingId, rowRef, handleProps } = useDragReorder(
    devices.map((device) => device.id),
    reorderDevices,
  )
  const handleTest = useCallback(
    async (id: string) => {
      await testDevice(id)
      await refresh()
    },
    [testDevice, refresh],
  )

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => { if (!next) onClose() }}
    >
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{t("Devices")}</DialogTitle>
          <DialogDescription>
            {t("Control another Cogpit device from here. The active device is chosen from the header switcher — ")}{SWITCH_TIP} {t(" jumps between devices. Drag a device by its handle to change its number; this machine is always 1.")}
          </DialogDescription>
        </DialogHeader>

        {devices.length > 0 && (
          <div className="flex flex-col gap-2">
            {order.map((id, index) => {
              const device = devices.find((candidate) => candidate.id === id)
              if (!device) return null
              return (
                <DeviceRow
                  key={device.id}
                  device={device}
                  slot={index + 2}
                  rowRef={rowRef(device.id)}
                  dragging={draggingId === device.id}
                  dragHandleProps={handleProps(device.id)}
                  onRename={handleRename}
                  onCredentials={updateDevice}
                  onRemove={handleRemove}
                  onTest={handleTest}
                />
              )
            })}
          </div>
        )}

        <div className="flex flex-col gap-4 border-t pt-4">
          <div className="flex items-center gap-2">
            <Plus data-icon="inline-start" className="size-4 text-muted-foreground" />
            <p className="text-sm font-medium text-foreground">{t("Add a device")}</p>
          </div>

          <FieldGroup>
            <Field data-invalid={submitError?.field === "host"}>
              <FieldLabel htmlFor="device-host">{t("Host")}</FieldLabel>
              <FieldDescription>{t("Enter a local address or an HTTPS URL.")}</FieldDescription>
              <Input
                id="device-host"
                ref={hostRef}
                value={hostInput}
                onChange={(event) => {
                  probeSeq.current += 1
                  setHostInput(event.target.value)
                  setUsername("")
                  setProbeState(null)
                  setSubmitError(null)
                }}
                onBlur={() => void runProbe()}
                placeholder="192.168.1.42, my-mac.local:19384 or https://cogpit.example.com"
                spellCheck={false}
                autoComplete="off"
              />
              {probing && (
                <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Loader2 data-icon="inline-start" className="size-3.5 animate-spin" /> {t(" Checking device…")}
                </p>
              )}
              {!probing && probeState && (
                <p role="status" className={cn("flex items-center gap-1.5 text-xs", TONE_CLASS[probeState.tone])}>
                  <ToneIcon tone={probeState.tone} />
                  {probeState.text}
                </p>
              )}
              {submitError?.field === "host" && (
                <FieldError>{submitError.message}</FieldError>
              )}
            </Field>

            <Field>
              <FieldLabel htmlFor="device-name">
                {t("Name ")}<span className="text-muted-foreground/60">{t("(optional)")}</span>
              </FieldLabel>
              <Input
                id="device-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder={t("Defaults to the device's own name")}
              />
            </Field>

            {targetUsesAccounts && (
              <Field data-invalid={submitError?.field === "username"}>
                <FieldLabel htmlFor="device-username">{t("Username")}</FieldLabel>
                <Input
                  id="device-username"
                  value={username}
                  onChange={(event) => setUsername(event.target.value)}
                  placeholder={t("Account username")}
                  autoComplete="username"
                  spellCheck={false}
                />
                <FieldDescription>
                  {t("Requests through this hub act as this account on that server.")}
                </FieldDescription>
                {submitError?.field === "username" && (
                  <FieldError>{submitError.message}</FieldError>
                )}
              </Field>
            )}

            {credentialsRequired && (
              <Field data-invalid={submitError?.field === "password"}>
                <FieldLabel htmlFor="device-password">{t("Password")}</FieldLabel>
                <Input
                  id="device-password"
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder={targetUsesAccounts ? t("Password for that account") : t("Network access password for that device")}
                  autoComplete={targetUsesAccounts ? "current-password" : "off"}
                />
                {submitError?.field === "password" && (
                  <FieldError>{submitError.message}</FieldError>
                )}
              </Field>
            )}
          </FieldGroup>

          <Field orientation="horizontal">
            <Checkbox
              id="device-local-tunnel"
              name="device-local-tunnel"
              checked={allowLocalTunnel}
              onCheckedChange={(checked) => {
                probeSeq.current += 1
                setAllowLocalTunnel(checked === true)
                setProbeState(null)
                setSubmitError(null)
              }}
            />
            <FieldLabel htmlFor="device-local-tunnel">
              {t("This is a local tunnel")}{targetUsesAccounts ? "" : t(" — no password")}
            </FieldLabel>
          </Field>
          {allowLocalTunnel && (
            <Alert className="border-warning/40 bg-warning/10 text-warning">
              <ShieldAlert />
              <AlertDescription className="text-warning">
                {targetUsesAccounts ? (
                  <>{t("The loopback address is allowed because the tunnel is local; account sign-in still applies.")}</>
                ) : (
                  <>{t("Traffic to this device is forwarded ")}<strong>{t("unauthenticated")}</strong>{t(". Only use this for an SSH tunnel or another already-secured local channel.")}</>
                )}
              </AlertDescription>
            </Alert>
          )}

          <div className="flex justify-end gap-2 pt-1">
            <Button variant="outline" onClick={onClose}>
              {t("Close")}
            </Button>
            <Button disabled={!canSubmit} onClick={() => void handleSubmit()}>
              {submitting ? (
                <>
                  <Loader2 data-icon="inline-start" className="size-4 animate-spin" /> {t(" Adding…")}</>
              ) : (
                "Add device"
              )}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
