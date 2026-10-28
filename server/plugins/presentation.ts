import { satisfies } from "semver"
import type { ClientRuntimeDescriptor, PluginManifest, ConnectionDefinition } from "@cogpit/plugin-contracts"
import type { PluginStoreSnapshot } from "../../shared/contracts/plugins"

const supportsContributions = (client?: ClientRuntimeDescriptor) => client?.apiVersions.some(version => satisfies(version, ">=1.2.0 <2.0.0")) === true

export function canReadPluginManifest(manifest: PluginManifest, client?: ClientRuntimeDescriptor): boolean {
  if (supportsContributions(client)) return true
  return !!manifest.entry && manifest.contributes.panels.length > 0
    && manifest.contributes.settings === undefined && manifest.contributes.skills === undefined
    && manifest.contributes.chatBlocks === undefined && manifest.contributes.sessionActions === undefined
}

export function canReadConnection(definition: ConnectionDefinition, client?: ClientRuntimeDescriptor): boolean {
  return supportsContributions(client) || Object.values(definition.operations).every(operation => operation.method === "GET" && !operation.body && !operation.response
    && Object.values(operation.args).every(argument => argument.type !== "number" && (argument.type !== "string" || argument.multiline === undefined && argument.maxLength <= 1024 && (argument.enum?.length ?? 0) <= 32)))
}

export function pluginSnapshotForClient(snapshot: PluginStoreSnapshot, client?: ClientRuntimeDescriptor): PluginStoreSnapshot {
  const plugins = snapshot.plugins.filter(plugin => canReadPluginManifest(plugin.manifest, client)).map(plugin => ({ ...plugin, versions: plugin.versions.filter(version => canReadPluginManifest(version.manifest, client)) }))
  const availableSeeds = snapshot.availableSeeds?.filter(seed => canReadPluginManifest(seed.manifest, client))
  const hidden = plugins.length !== snapshot.plugins.length || availableSeeds?.length !== snapshot.availableSeeds?.length
  return { ...snapshot, plugins, ...(availableSeeds ? { availableSeeds } : {}),
    ...(hidden ? { error: snapshot.error ?? "Some plugins require a newer Cogpit client. Existing compatible panels remain available." } : {}),
  }
}
