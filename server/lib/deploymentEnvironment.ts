import names from "../../shared/deploymentEnvironment.json"

type DeploymentSetting = keyof typeof names

export function deploymentName(setting: DeploymentSetting): string {
  return names[setting]
}

/** The public deployment name takes precedence, including an explicitly empty value. */
export function deploymentValue(setting: DeploymentSetting, env: NodeJS.ProcessEnv = process.env): string | undefined {
  return env[names[setting]] ?? env[setting]
}

/** Normalize once at startup; internal agent/CLI environment contracts stay intact. */
export function applyDeploymentEnvironment(env: NodeJS.ProcessEnv = process.env): void {
  for (const setting of Object.keys(names) as DeploymentSetting[]) {
    const value = env[names[setting]]
    if (value !== undefined) env[setting] = value
  }
}

export function setDeploymentValue(setting: DeploymentSetting, value: string, env: NodeJS.ProcessEnv = process.env): void {
  env[names[setting]] = value
  env[setting] = value
}
