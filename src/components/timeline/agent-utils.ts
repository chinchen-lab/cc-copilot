import type { SubAgentMessage } from "../../../shared/session/types"

function shortId(id: string): string {
  return id.length > 8 ? id.slice(0, 8) : id
}

export function formatAgentLabel(agentId: string, subagentType?: string | null, agentName?: string | null): string {
  const type = subagentType ?? agentName
  if (type) return `${type} - ${shortId(agentId)}`
  return shortId(agentId)
}

export function buildAgentLabelMap(messages: SubAgentMessage[]): Map<string, string> {
  const map = new Map<string, string>()
  for (const msg of messages) {
    if (!map.has(msg.agentId)) {
      map.set(msg.agentId, formatAgentLabel(msg.agentId, msg.subagentType, msg.agentName))
    }
  }
  return map
}

/**
 * agentId → Task/Agent tool_use id, the key for an agent's live stream.
 *
 * Cogpit now binds agents by task id, but sessions it recorded while it
 * matched agents to calls by prompt can carry one tool id under several
 * agents. Keying off it would replay one agent's stream under every sibling,
 * so contested ids are dropped instead.
 */
export function buildParentToolByAgent(messages: SubAgentMessage[]): Map<string, string> {
  const map = new Map<string, string>()
  for (const msg of messages) {
    if (msg.parentToolUseId && !map.has(msg.agentId)) map.set(msg.agentId, msg.parentToolUseId)
  }

  const agentsPerTool = new Map<string, number>()
  for (const toolId of map.values()) {
    agentsPerTool.set(toolId, (agentsPerTool.get(toolId) ?? 0) + 1)
  }
  for (const [agentId, toolId] of map) {
    if ((agentsPerTool.get(toolId) ?? 0) > 1) map.delete(agentId)
  }
  return map
}

/**
 * Agents in display order, each followed by the agents it launched, with
 * their nesting depth. An agent whose parent is not among them is a root.
 */
export function orderAgentsByParent(
  messages: ReadonlyArray<Pick<SubAgentMessage, "agentId" | "parentAgentId">>,
): Array<{ agentId: string; depth: number }> {
  const parentOf = new Map<string, string | undefined>()
  for (const msg of messages) {
    if (msg.parentAgentId) parentOf.set(msg.agentId, msg.parentAgentId)
    else if (!parentOf.has(msg.agentId)) parentOf.set(msg.agentId, undefined)
  }
  const children = new Map<string | undefined, string[]>()
  for (const [agentId, parentId] of parentOf) {
    const key = parentId && parentOf.has(parentId) && parentId !== agentId ? parentId : undefined
    children.set(key, [...(children.get(key) ?? []), agentId])
  }

  const ordered: Array<{ agentId: string; depth: number }> = []
  const placed = new Set<string>()
  const place = (agentId: string, depth: number) => {
    if (placed.has(agentId)) return
    placed.add(agentId)
    ordered.push({ agentId, depth })
    for (const child of children.get(agentId) ?? []) place(child, depth + 1)
  }
  for (const root of children.get(undefined) ?? []) place(root, 0)
  // A parent cycle has no root to reach it from.
  for (const agentId of parentOf.keys()) place(agentId, 0)
  return ordered
}
