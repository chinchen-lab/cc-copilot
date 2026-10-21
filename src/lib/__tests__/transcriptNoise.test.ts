import { describe, expect, it } from "vitest"

import { formatFor, isAnyAgentNoiseLine } from "../../../shared/session/agents"

const claude = formatFor("claude")

const request = '{"type":"api-request","sessionId":"s","id":"0a","timestamp":"2026-10-20T11:00:40.897Z"}'
const blob = '{"type":"api-request-blob","sessionId":"s","hash":"07","message":{"role":"user","content":[{"type":"text","text":"hi"}]}}'
const shape = '{"type":"api-request-shape","sessionId":"s","shapeHash":"3b","version":"2.1.303","shape":{"system":[]}}'
const user = '{"parentUuid":null,"type":"user","uuid":"u1","sessionId":"s","timestamp":"2026-10-20T11:00:41.000Z","message":{"role":"user","content":"hello"}}'

describe("Claude transcript noise", () => {
  it("names the api-request records Claude Code writes", () => {
    expect([request, blob, shape].every(claude.isNoiseLine)).toBe(true)
    expect(claude.isNoiseLine(user)).toBe(false)
  })

  it("finds the record type wherever the writer put the key", () => {
    expect(claude.isNoiseLine('{"sessionId":"s","type":"api-request-blob","hash":"07"}')).toBe(true)
  })

  it("ignores the same words inside a nested object or a string", () => {
    expect(claude.isNoiseLine('{"type":"user","message":{"type":"api-request"}}')).toBe(false)
    expect(claude.isNoiseLine('{"type":"user","message":{"content":"{\\"type\\":\\"api-request\\"}"}}')).toBe(false)
    expect(claude.isNoiseLine('{"data":{"x":1},"type":"api-request"}')).toBe(false)
  })

  it("is Claude's alone", () => {
    expect(formatFor("codex").isNoiseLine(request)).toBe(false)
    expect(formatFor("copilot").isNoiseLine(request)).toBe(false)
    expect(isAnyAgentNoiseLine(request)).toBe(true)
    expect(isAnyAgentNoiseLine(user)).toBe(false)
  })

  it("parses a transcript the same with or without them", () => {
    const withNoise = claude.parse([shape, blob, user, request].join("\n"))
    const without = claude.parse(user)
    expect(withNoise.turns).toEqual(without.turns)
    expect(withNoise.rawMessages).toEqual(without.rawMessages)
  })
})
