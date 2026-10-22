// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createInterface } from "node:readline"
import { zstdCompressSync } from "node:zlib"
import {
  openTranscript,
  readTranscriptStart,
  readTranscriptText,
  statTranscript,
  transcriptReadStream,
  uncompressedTranscriptName,
} from "../../agents/transcriptFile"
import { readHeadLines, readTranscriptHead } from "../../agents/transcriptHead"

const LINES = Array.from({ length: 2000 }, (_, index) => JSON.stringify({ index, text: `line ${index} ${"x".repeat(40)}` }))
const CONTENT = `${LINES.join("\n")}\n`

let dir: string
let plain: string
let compressed: string

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "cogpit-transcript-file-"))
  plain = join(dir, "rollout.jsonl")
  compressed = join(dir, "archived.jsonl.zst")
  await writeFile(plain, CONTENT)
  await writeFile(compressed, zstdCompressSync(Buffer.from(CONTENT)))
})

afterAll(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe("transcript files", () => {
  it("names a compressed transcript by its plain name", () => {
    expect(uncompressedTranscriptName("a/rollout-x.jsonl.zst")).toBe("a/rollout-x.jsonl")
    expect(uncompressedTranscriptName("a/rollout-x.jsonl")).toBe("a/rollout-x.jsonl")
  })

  it.each([["plain", () => plain], ["compressed", () => compressed]])("reads a %s transcript as its decompressed bytes", async (_label, path) => {
    const filePath = path()
    expect(await readTranscriptText(filePath)).toBe(CONTENT)
    expect((await statTranscript(filePath)).size).toBe(Buffer.byteLength(CONTENT))
    expect((await readTranscriptStart(filePath, 100)).toString()).toBe(CONTENT.slice(0, 100))
    const head = CONTENT.slice(0, 200)
    expect(await readHeadLines(filePath, 200)).toEqual(head.slice(0, head.lastIndexOf("\n")).split("\n"))

    const handle = await openTranscript(filePath)
    try {
      const buffer = Buffer.alloc(50)
      const position = CONTENT.length - 30
      const { bytesRead } = await handle.read(buffer, 0, 50, position)
      expect(buffer.subarray(0, bytesRead).toString()).toBe(CONTENT.slice(position))
      expect((await handle.stat()).size).toBe(Buffer.byteLength(CONTENT))
    } finally {
      await handle.close()
    }

    const streamed: string[] = []
    for await (const line of createInterface({ input: transcriptReadStream(filePath).setEncoding("utf8") })) streamed.push(line)
    expect(streamed).toEqual(LINES)
  })

  it("reads a compressed transcript's head whole", async () => {
    await expect(readTranscriptHead(compressed)).resolves.toEqual({
      lines: LINES,
      isPartialRead: false,
      size: Buffer.byteLength(CONTENT),
    })
  })

  it("rejects cleanly when a compressed transcript is gone", async () => {
    const missing = join(dir, "decompressed-on-resume.jsonl.zst")
    await expect(readTranscriptStart(missing, 100)).rejects.toMatchObject({ code: "ENOENT" })
    await expect(readHeadLines(missing, 100)).rejects.toMatchObject({ code: "ENOENT" })
    await expect((async () => {
      for await (const _chunk of transcriptReadStream(missing)) void _chunk
    })()).rejects.toMatchObject({ code: "ENOENT" })
  })
})
