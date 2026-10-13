import { authorizeSession } from "../edition"
import { crewChatContext, postCrewChat, readCrewChat, setCrewChatListening } from "../lib/crewChat"
import { sendJson, singlePathParam, withJsonBody, type UseFn } from "../http"
import { sendHostError } from "./agentErrors"

export function registerCrewChatRoutes(use: UseFn): void {
  use("/api/crew-chat/", (req, res, next) => {
    const sessionId = singlePathParam(req)
    if (!sessionId || !["GET", "POST", "PATCH"].includes(req.method ?? "")) return next()
    const authorize = async () => {
      const level = req.method === "POST" ? "interact" : "view"
      if (await authorizeSession(req, res, { sessionId }, level) === null) return false
      const context = await crewChatContext(sessionId, req)
      return context.rootId === sessionId || await authorizeSession(req, res, { sessionId: context.rootId }, level) !== null
    }
    if (req.method === "GET") return (async () => {
      try {
        if (!await authorize()) return
        const params = new URL(req.url || "/", "http://localhost").searchParams
        const number = (name: string) => params.has(name) ? Number(params.get(name)) : undefined
        return sendJson(res, 200, await readCrewChat(sessionId, { after: number("after"), before: number("before"), limit: number("limit") }, req))
      } catch (error) { sendHostError(res, error, "Couldn't load crew chat") }
    })()
    withJsonBody<Record<string, unknown>>(req, res, async (body) => {
      try {
        if (!await authorize()) return
        if (req.method === "PATCH") {
          if (typeof body.sessionId !== "string" || typeof body.listening !== "boolean") return sendJson(res, 400, { error: "sessionId and listening are required" })
          if (await authorizeSession(req, res, { sessionId: body.sessionId }, "interact") === null) return
          return sendJson(res, 200, await setCrewChatListening(sessionId, body.sessionId, body.listening, req))
        }
        if (typeof body.text !== "string" || typeof body.commandId !== "string" || (body.mentions !== undefined && (!Array.isArray(body.mentions) || body.mentions.some((id) => typeof id !== "string"))) || (body.senderSessionId !== undefined && typeof body.senderSessionId !== "string")) return sendJson(res, 400, { error: "text, commandId and optional member mentions are required" })
        sendJson(res, 200, await postCrewChat(sessionId, { text: body.text, commandId: body.commandId, mentions: body.mentions as string[] | undefined, senderSessionId: body.senderSessionId as string | undefined }, req))
      } catch (error) { sendHostError(res, error, "Couldn't update crew chat") }
    })
  })
}
