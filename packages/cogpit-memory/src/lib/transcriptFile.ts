import { readFileSync } from "node:fs"
import { open, readFile, stat } from "node:fs/promises"
import * as zlib from "node:zlib"

/**
 * Transcripts an agent has stopped writing may be stored zstd-compressed as
 * `<name>.jsonl.zst`. Readers go through this module so a compressed
 * transcript reads like a plain one: offsets and sizes refer to the
 * decompressed bytes. Node gained zstd in 22.15; older runtimes skip such
 * transcripts rather than fail on them.
 */

const COMPRESSED_SUFFIX = ".zst"

const canReadCompressedTranscripts = typeof zlib.zstdDecompressSync === "function"

export function isCompressedTranscript(filePath: string): boolean {
  return filePath.endsWith(COMPRESSED_SUFFIX)
}

/** The name a transcript has uncompressed. */
export function uncompressedTranscriptName(fileName: string): string {
  return isCompressedTranscript(fileName) ? fileName.slice(0, -COMPRESSED_SUFFIX.length) : fileName
}

/**
 * Whether a directory entry is a transcript this runtime can read, given its
 * siblings: mid-compression both forms exist, and the plain one is current.
 */
export function isListableTranscript(name: string, siblings: ReadonlySet<string>): boolean {
  const plainName = uncompressedTranscriptName(name)
  if (!plainName.endsWith(".jsonl")) return false
  if (plainName === name) return true
  return canReadCompressedTranscripts && !siblings.has(plainName)
}

function inflate(data: Buffer): Buffer {
  if (!canReadCompressedTranscripts) {
    throw new Error("Reading a .jsonl.zst transcript needs Node.js 22.15 or newer, or Bun")
  }
  return zlib.zstdDecompressSync(data)
}

export function readTranscriptTextSync(filePath: string): string {
  const data = readFileSync(filePath)
  return (isCompressedTranscript(filePath) ? inflate(data) : data).toString("utf-8")
}

export async function readTranscriptText(filePath: string): Promise<string> {
  const data = await readFile(filePath)
  return (isCompressedTranscript(filePath) ? inflate(data) : data).toString("utf-8")
}

/** The subset of a `FileHandle` transcript readers use. */
export interface TranscriptHandle {
  read(buffer: Buffer, offset: number, length: number, position: number): Promise<{ bytesRead: number }>
  stat(): Promise<{ size: number; mtimeMs: number }>
  close(): Promise<void>
}

export async function openTranscript(filePath: string): Promise<TranscriptHandle> {
  if (!isCompressedTranscript(filePath)) return open(filePath, "r")
  const [fileStat, compressed] = await Promise.all([stat(filePath), readFile(filePath)])
  const data = inflate(compressed)
  return {
    async read(buffer, offset, length, position) {
      const start = Math.min(Math.max(position, 0), data.length)
      return { bytesRead: data.copy(buffer, offset, start, Math.min(start + length, data.length)) }
    },
    stat: async () => ({ size: data.length, mtimeMs: fileStat.mtimeMs }),
    close: async () => {},
  }
}
