/** Plain HTTP browser access is an explicit per-process deployment choice. */
export function allowsHttpBrowserAccess(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.COGPIT_ALLOW_HTTP === "1"
}
