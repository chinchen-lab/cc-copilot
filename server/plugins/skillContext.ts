type SkillProvider = (workspacePath: string) => Promise<string>
let provider: SkillProvider | null = null

export function registerPluginSkills(value: SkillProvider): () => void {
  provider = value
  return () => { if (provider === value) provider = null }
}

export function pluginSkillContext(workspacePath: string): Promise<string> | null {
  const current = provider
  return current ? Promise.resolve().then(() => current(workspacePath)).catch(() => "") : null
}
