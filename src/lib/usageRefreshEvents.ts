import type { AgentKind } from "@/lib/agents"
import { getActiveDeviceScope } from "@/lib/device"

export const USAGE_REFRESH_EVENT = "cogpit:usage-refresh"
export interface UsageRefreshDetail { agentKind: AgentKind; scope: string }

export function announceUsageRefresh(agentKind: AgentKind, scope = getActiveDeviceScope()): void {
  window.dispatchEvent(new CustomEvent<UsageRefreshDetail>(USAGE_REFRESH_EVENT, { detail: { agentKind, scope } }))
}
