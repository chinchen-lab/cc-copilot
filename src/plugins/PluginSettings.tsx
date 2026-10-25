import { useEffect, useId, useRef, useState } from "react"
import { validateSettings, type PluginSettingsContribution, type PluginSettingsValues } from "@cogpit/plugin-contracts"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import type { PluginSettingsSnapshot } from "../../shared/contracts/pluginSettings"
import type { RuntimePluginClient } from "./runtimeClient"

export function PluginSettings({ client, pluginId, projectId, definition }: {
  client: Pick<RuntimePluginClient, "settings" | "saveSettings">; pluginId: string; projectId: string | null; definition: PluginSettingsContribution
}) {
  const id = useId()
  const [snapshot, setSnapshot] = useState<PluginSettingsSnapshot | null>(null)
  const [values, setValues] = useState<PluginSettingsValues>({})
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState("")
  const [refresh, setRefresh] = useState(0)
  const pendingSave = useRef<AbortController | null>(null)
  const unavailable = definition.scope === "project" && !projectId
  useEffect(() => {
    pendingSave.current?.abort(); pendingSave.current = null; setSaving(false)
    setSnapshot(null); setError(null); setNotice("")
    if (unavailable) return
    const abort = new AbortController()
    void client.settings({ pluginId, projectId }, abort.signal).then(value => {
      if (!abort.signal.aborted) { setSnapshot(value); setValues(validateSettings(definition, value.values)) }
    }).catch(failure => { if (!abort.signal.aborted) setError(failure instanceof Error ? failure.message : "Unable to load plugin settings") })
    return () => { abort.abort(); pendingSave.current?.abort() }
  }, [client, pluginId, projectId, definition, unavailable, refresh])
  async function save(event: React.FormEvent) {
    event.preventDefault()
    if (!snapshot || saving) return
    let parsed: PluginSettingsValues
    try { parsed = validateSettings(definition, values) } catch { setError("Check the setting values and their limits."); return }
    setSaving(true); setError(null); setNotice("")
    const abort = new AbortController()
    pendingSave.current = abort
    try {
      const next = await client.saveSettings({ pluginId, projectId }, parsed, snapshot.revision, abort.signal)
      if (!abort.signal.aborted) { setSnapshot(next); setValues(next.values); setNotice("Settings saved.") }
    } catch (failure) { if (!abort.signal.aborted) setError(failure instanceof Error ? failure.message : "Unable to save plugin settings") }
    finally { if (pendingSave.current === abort) { pendingSave.current = null; if (!abort.signal.aborted) setSaving(false) } }
  }
  if (unavailable) return <p className="text-sm text-muted-foreground">Choose a project to edit this plugin's settings.</p>
  return <form onSubmit={event => { void save(event) }}>
    <FieldGroup>
      <p className="text-sm text-muted-foreground">{definition.scope === "project" ? "Settings for this project." : "Settings for your account on this host."}</p>
      {snapshot && definition.fields.map(field => {
        const fieldId = `${id}-${field.id}`
        const update = (value: string | number | boolean) => { setValues(previous => ({ ...previous, [field.id]: value })); setNotice("") }
        return <Field key={field.id} data-disabled={saving}>
          <FieldLabel htmlFor={fieldId}>{field.label}</FieldLabel>
          {field.description && <FieldDescription>{field.description}</FieldDescription>}
          {field.type === "boolean" ? <Checkbox id={fieldId} checked={values[field.id] === true} disabled={saving} onCheckedChange={value => update(value === true)} />
            : field.type === "select" ? <Select value={String(values[field.id])} items={field.options} disabled={saving} onValueChange={value => { if (value !== null) update(String(value)) }}>
              <SelectTrigger id={fieldId}><SelectValue /></SelectTrigger><SelectContent><SelectGroup>{field.options.map(option => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectGroup></SelectContent>
            </Select> : <Input id={fieldId} disabled={saving} type={field.type === "number" ? "number" : "text"} value={String(values[field.id] ?? "")}
              {...field.type === "number" ? { min: field.min, max: field.max, step: field.step ?? "any" } : { maxLength: field.maxLength }}
              onChange={event => update(field.type === "number" ? event.target.value === "" ? "" : Number(event.target.value) : event.target.value)} />}
        </Field>
      })}
      {!!snapshot?.adjustedFields?.length && <p role="status" className="text-sm text-muted-foreground">Some saved values no longer match this version. Defaults are shown for {snapshot.adjustedFields.join(", ")}; save to apply them.</p>}
      {!snapshot && !error && <p role="status">Loading settings…</p>}
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      {notice && <p role="status" className="text-sm">{notice}</p>}
      <div className="flex gap-2"><Button type="submit" disabled={!snapshot || saving}>{saving ? "Saving…" : "Save settings"}</Button>
        <Button type="button" variant="outline" disabled={saving} onClick={() => setRefresh(value => value + 1)}>Reload settings</Button></div>
    </FieldGroup>
  </form>
}
