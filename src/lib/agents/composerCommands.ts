import { descriptorFor, type AgentKind } from "./index"

export function composerCommandFor(kind: AgentKind, text: string): "usage" | null {
  const name = /^\/([^\s/]+)(?:\s|$)/.exec(text.trim())?.[1]
  return descriptorFor(kind).composerCommands?.find(command => command.name === name)?.action ?? null
}
