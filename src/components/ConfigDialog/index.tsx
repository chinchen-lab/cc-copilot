import { useTranslation } from "@/hooks/useTranslation"
import { useState, useCallback, useEffect } from "react"
import { FontScaleSettings } from "@/components/FontScaleSettings"
import { LanguageSettings } from "@/components/LanguageSettings"
import { FolderOpen, CheckCircle, XCircle, Loader2, TerminalSquare, Code2, PanelsTopLeft } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Input } from "@/components/ui/input"
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/components/ui/input-group"
import { useConfigValidation } from "@/hooks/useConfigValidation"
import { authFetch } from "@/lib/auth"
import { can } from "@/lib/capabilities"
import { isRemoteDeviceActive } from "@/lib/device"
import { NetworkAccessSection } from "./NetworkAccessSection"
import { ExecutableSection } from "./ExecutableSection"
import { AccountSection } from "./AccountSection"
import {
  DEFAULT_EXECUTABLE_CHOICE,
  parseExecutableChoice,
  type ExecutableChoice,
} from "../../../shared/contracts/agentExecutable"
import { allDescriptors } from "../../../shared/session/agent-descriptors"
import { PASSWORD_MIN_LENGTH } from "../../../shared/contracts/password"

/** Agents with more than one binary on offer, so a picker is worth showing. */
const EXECUTABLE_CHOICE_KINDS = allDescriptors()
  .filter((descriptor) => descriptor.cli.bundledBySdk)
  .map((descriptor) => descriptor.kind)

const ACCOUNT_SWITCHING_KINDS = allDescriptors()
  .filter((descriptor) => descriptor.capabilities.accountSwitching)
  .map((descriptor) => descriptor.kind)

function sameChoice(a: ExecutableChoice, b: ExecutableChoice): boolean {
  return a.source === b.source && (a.source !== "custom" || a.path === b.path)
}

function ValidationStatus({ status, error }: { status: string; error: string | null }) {
  const { t } = useTranslation()
  if (status === "validating") {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 data-icon="inline-start" className="size-3.5 animate-spin" />
        {t("Checking path...")}
      </div>
    )
  }
  if (status === "valid") {
    return (
      <div className="flex items-center gap-2 text-sm text-success">
        <CheckCircle data-icon="inline-start" className="size-3.5" />
        {t("Valid .claude directory found")}
      </div>
    )
  }
  if (status === "invalid" && error) {
    return (
      <div className="flex items-center gap-2 text-sm text-destructive">
        <XCircle data-icon="inline-start" className="size-3.5" />
        {error}
      </div>
    )
  }
  return null
}

interface ConfigDialogProps {
  open: boolean
  currentPath: string
  onClose: () => void
  onSaved: (newPath: string) => void
}

export function ConfigDialog({ open, currentPath, onClose, onSaved }: ConfigDialogProps) {
  const { t } = useTranslation()
  const [tab, setTab] = useState<"general" | "agents" | "network">("general")
  const [path, setPath] = useState(currentPath)
  const [saving, setSaving] = useState(false)
  const { status, error, debouncedValidate, reset, save } = useConfigValidation()
  // Editing a remote device's network access through the proxy could rotate its
  // password or disable its network access — either one locks this hub out.
  const remoteDevice = isRemoteDeviceActive()
  // An account without configWrite gets a read-only view (the server refuses writes anyway).
  const canWriteConfig = can("configWrite")

  // Network access state
  const [networkAccess, setNetworkAccess] = useState(false)
  const [networkPassword, setNetworkPassword] = useState("")
  const [showNetworkPassword, setShowNetworkPassword] = useState(false)

  // Terminal app
  const [terminalApp, setTerminalApp] = useState("")
  const [initialTerminalApp, setInitialTerminalApp] = useState("")

  // Editor app
  const [editorApp, setEditorApp] = useState("")
  const [initialEditorApp, setInitialEditorApp] = useState("")

  // Route "open in editor" to Cogpit's own file workspace instead
  const [useBuiltInEditor, setUseBuiltInEditor] = useState(false)
  const [initialUseBuiltInEditor, setInitialUseBuiltInEditor] = useState(false)

  const [agentExecutable, setAgentExecutable] = useState<ExecutableChoice>(DEFAULT_EXECUTABLE_CHOICE)
  const [executableReportVersion, setExecutableReportVersion] = useState(0)
  const [initialAgentExecutable, setInitialAgentExecutable] = useState<ExecutableChoice>(DEFAULT_EXECUTABLE_CHOICE)

  // Track whether network settings changed (to enable save without path change)
  const [initialNetworkAccess, setInitialNetworkAccess] = useState(false)
  const [hasExistingPassword, setHasExistingPassword] = useState(false)

  // Connected devices
  const [connectedDevices, setConnectedDevices] = useState<Array<{ ip: string; deviceName: string; lastActivity: number }>>([])

  // Reset when dialog opens
  useEffect(() => {
    if (open) {
      setTab("general")
      setPath(currentPath)
      reset()
      // Fetch current network settings
      authFetch("/api/config")
        .then((res) => res.json())
        .then((data) => {
          const access = data?.networkAccess || false
          setNetworkAccess(access)
          setInitialNetworkAccess(access)
          setHasExistingPassword(!!data?.networkPassword)
          setNetworkPassword("")
          const term = data?.terminalApp || ""
          setTerminalApp(term)
          setInitialTerminalApp(term)
          const editor = data?.editorApp || ""
          setEditorApp(editor)
          setInitialEditorApp(editor)
          const builtIn = data?.useBuiltInEditor === true
          setUseBuiltInEditor(builtIn)
          setInitialUseBuiltInEditor(builtIn)
          const executable = parseExecutableChoice(data?.agentExecutable) ?? DEFAULT_EXECUTABLE_CHOICE
          setAgentExecutable(executable)
          setInitialAgentExecutable(executable)
          // Fetch connected devices if network is active
          if (access && data?.networkPassword && !remoteDevice) {
            authFetch("/api/connected-devices")
              .then((r) => r.json())
              .then((d) => setConnectedDevices(d?.devices || []))
              .catch(() => {})
          } else {
            setConnectedDevices([])
          }
        })
        .catch(() => {})
    }
  }, [open, currentPath, reset, remoteDevice])

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const value = e.target.value
      setPath(value)
      debouncedValidate(value)
    },
    [debouncedValidate]
  )

  const handleSave = useCallback(async () => {
    setSaving(true)
    const result = await save(path, {
      // Remote device: echo its current setting untouched — omitting the field
      // would disable its network access server-side and cut this hub off.
      networkAccess: remoteDevice ? initialNetworkAccess : networkAccess,
      // Only send password if user typed one (blank = keep existing)
      networkPassword: !remoteDevice && networkAccess && networkPassword.length > 0 ? networkPassword : undefined,
      terminalApp: terminalApp.trim() || undefined,
      editorApp: editorApp.trim() || undefined,
      useBuiltInEditor,
      agentExecutable,
    })
    if (result.success && result.claudeDir) {
      setExecutableReportVersion((version) => version + 1)
      onSaved(result.claudeDir)
    }
    setSaving(false)
  }, [path, networkAccess, networkPassword, terminalApp, editorApp, useBuiltInEditor, agentExecutable, save, onSaved, remoteDevice, initialNetworkAccess])

  function computeCanSave(): boolean {
    // Block save while path is being validated or is invalid
    if (status === "validating" || status === "invalid") return false

    // Check if anything actually changed
    const pathChanged = status === "valid"
    const networkChanged = !remoteDevice && (networkAccess !== initialNetworkAccess || (networkAccess && networkPassword.length > 0))
    const terminalChanged = terminalApp !== initialTerminalApp
    const editorChanged = editorApp !== initialEditorApp
      || useBuiltInEditor !== initialUseBuiltInEditor
    const executableChanged = !sameChoice(agentExecutable, initialAgentExecutable)
    if (!pathChanged && !networkChanged && !terminalChanged && !editorChanged && !executableChanged) return false
    if (agentExecutable.source === "custom" && !agentExecutable.path?.trim()) return false

    // Validate password requirements when network is enabled
    if (!remoteDevice && networkAccess) {
      const passwordTooShort = networkPassword.length > 0 && networkPassword.length < PASSWORD_MIN_LENGTH
      const needsPassword = !hasExistingPassword && networkPassword.length === 0
      if (passwordTooShort || needsPassword) return false
    }

    return true
  }

  const canSave = computeCanSave()

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="flex h-[min(46rem,calc(100dvh-2rem))] flex-col gap-0 overflow-hidden p-0 sm:max-w-xl">
        <DialogHeader className="shrink-0 px-5 pb-4 pt-5 pr-12">
          <DialogTitle className="text-foreground">{t("Settings")}</DialogTitle>
          <DialogDescription className="text-muted-foreground">
            {t("Choose a category to manage your preferences and server settings.")}
          </DialogDescription>
        </DialogHeader>

        <Tabs value={tab === "network" && (remoteDevice || !canWriteConfig) ? "general" : tab} onValueChange={(value) => {
          if (value === "general" || value === "agents" || value === "network") setTab(value)
        }} className="min-h-0 flex-1 gap-0">
          <div className="shrink-0 px-5 pb-4">
            <TabsList aria-label={t("Settings categories")} className="w-full">
              <TabsTrigger value="general">{t("General")}</TabsTrigger>
              <TabsTrigger value="agents">{t("Agents")}</TabsTrigger>
              {!remoteDevice && canWriteConfig && <TabsTrigger value="network">{t("Network & sharing")}</TabsTrigger>}
            </TabsList>
          </div>
          <div className="grid min-h-0 flex-1 grid-cols-1 items-start overflow-y-auto border-t px-5 py-5 [&>[data-slot=tabs-content]]:col-start-1 [&>[data-slot=tabs-content]]:row-start-1">
            <TabsContent value="general" keepMounted>
              <FieldGroup>
                <LanguageSettings />
                <FontScaleSettings />
                <Field>
                  <FieldLabel htmlFor="terminal-application">
                    <TerminalSquare data-icon="inline-start" className="size-4 text-muted-foreground" />
                    {t("Terminal application")}
                  </FieldLabel>
                  <FieldDescription>{t("Leave blank to use the system default for Ctrl+Cmd+T.")}</FieldDescription>
                  <Input
                    id="terminal-application"
                    value={terminalApp}
                    onChange={(e) => setTerminalApp(e.target.value)}
                    placeholder="Ghostty, iTerm, or /path/to/binary"
                    disabled={!canWriteConfig}
                  />
                </Field>

                <Field orientation="horizontal">
                  <Checkbox
                    id="use-built-in-editor"
                    checked={useBuiltInEditor}
                    onCheckedChange={(checked) => setUseBuiltInEditor(checked === true)}
                    disabled={!canWriteConfig}
                  />
                  <FieldContent>
                    <FieldLabel htmlFor="use-built-in-editor">
                      <PanelsTopLeft data-icon="inline-start" className="size-4 text-muted-foreground" />
                      {t("Open files in CC-Copilot")}
                    </FieldLabel>
                    <FieldDescription>
                      {t("Files and diffs open in CC-Copilot’s file workspace instead of launching an external editor.")}
                    </FieldDescription>
                  </FieldContent>
                </Field>

                <Field>
                  <FieldLabel htmlFor="editor-application">
                    <Code2 data-icon="inline-start" className="size-4 text-muted-foreground" />
                    {t("Editor application")}
                  </FieldLabel>
                  <FieldDescription>
                    {useBuiltInEditor
                      ? t("Not used while files open in CC-Copilot.")
                      : t("Leave blank to use $VISUAL or automatic detection.")}
                  </FieldDescription>
                  <Input
                    id="editor-application"
                    value={editorApp}
                    onChange={(e) => setEditorApp(e.target.value)}
                    placeholder="cursor, code, zed, or /path/to/binary"
                    disabled={!canWriteConfig || useBuiltInEditor}
                  />
                </Field>
              </FieldGroup>
            </TabsContent>
            <TabsContent value="agents" keepMounted>
              <FieldGroup>
                <Field>
                  <FieldLabel htmlFor="claude-directory">{t("Claude directory")}</FieldLabel>
                  <FieldDescription>{t("The directory containing your Claude configuration.")}</FieldDescription>
                  <InputGroup>
                    <InputGroupAddon>
                      <FolderOpen data-icon="inline-start" />
                    </InputGroupAddon>
                    <InputGroupInput
                      id="claude-directory"
                      value={path}
                      onChange={handleChange}
                      placeholder="/Users/you/.claude"
                      disabled={!canWriteConfig}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && canSave && !saving) handleSave()
                      }}
                    />
                  </InputGroup>
                  <div aria-live="polite">
                    <ValidationStatus status={status} error={error} />
                  </div>
                </Field>

                {EXECUTABLE_CHOICE_KINDS.map((kind) => (
                  <ExecutableSection
                    key={kind}
                    kind={kind}
                    value={agentExecutable}
                    onChange={setAgentExecutable}
                    disabled={!canWriteConfig}
                    reportVersion={executableReportVersion}
                  />
                ))}

                {ACCOUNT_SWITCHING_KINDS.map((kind) => (
                  <AccountSection key={kind} kind={kind} disabled={!canWriteConfig} />
                ))}
              </FieldGroup>
            </TabsContent>
            {!remoteDevice && canWriteConfig && (
              <TabsContent value="network" keepMounted>
                <FieldGroup>
                  <NetworkAccessSection
                    networkAccess={networkAccess}
                    setNetworkAccess={setNetworkAccess}
                    networkPassword={networkPassword}
                    setNetworkPassword={setNetworkPassword}
                    showNetworkPassword={showNetworkPassword}
                    setShowNetworkPassword={setShowNetworkPassword}
                    hasExistingPassword={hasExistingPassword}
                    initialNetworkAccess={initialNetworkAccess}
                    connectedDevices={connectedDevices}
                    minPasswordLength={PASSWORD_MIN_LENGTH}
                  />
                </FieldGroup>
              </TabsContent>
            )}
          </div>
        </Tabs>

        {status === "invalid" && tab !== "agents" && error && (
          <div role="alert" className="shrink-0 border-t px-5 py-3 text-sm text-destructive">
            <p>{error}</p>
            <Button variant="link" size="sm" className="px-0 text-destructive" onClick={() => setTab("agents")}>{t("Review agent settings")}</Button>
          </div>
        )}
        <DialogFooter className="shrink-0 border-t px-5 py-4">
          <Button variant="outline" onClick={onClose}>
            {t("Cancel")}
          </Button>
          {canWriteConfig && (
            <Button disabled={!canSave || saving} onClick={handleSave}>
              {saving ? (
                <>
                  <Loader2 data-icon="inline-start" className="size-4 animate-spin" />
                  {t("Saving...")}</>
              ) : (
                t("Save")
              )}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
