import { createReadStream } from "node:fs"
import { open, readFile, stat } from "node:fs/promises"
import { pipeline, type Readable } from "node:stream"
import { promisify } from "node:util"
import { createZstdDecompress, zstdDecompress } from "node:zlib"

/**
 * Transcripts an agent has stopped writing may be stored zstd-compressed as
 * `<name>.jsonl.zst`. Every reader goes through this module so a compressed
 * transcript reads exactly like a plain one: offsets, sizes and lines all refer
 * to the decompressed bytes.
 */

const COMPRESSED_SUFFIX = ".zst"

const inflate = promisify(zstdDecompress)

export function isCompressedTranscript(filePath: string): boolean {
  return filePath.endsWith(COMPRESSED_SUFFIX)
}

/** The name a transcript has uncompressed, so both forms share one address. */
export function uncompressedTranscriptName(fileName: string): string {
  return isCompressedTranscript(fileName) ? fileName.slice(0, -COMPRESSED_SUFFIX.length) : fileName
}

/**
 * Whether a directory entry is a transcript, given its siblings:
 * mid-compression both forms exist, and the plain one is current.
 */
export function isListableTranscript(name: string, siblings: ReadonlySet<string>): boolean {
  const plainName = uncompressedTranscriptName(name)
  if (!plainName.endsWith(".jsonl")) return false
  return plainName === name || !siblings.has(plainName)
}

/** Paged reads open the same transcript many times; keep a few inflated. */
const CACHE_ENTRIES = 4
const CACHE_MAX_BYTES = 256 * 1024 * 1024
const inflated = new Map<string, { key: string; data: Buffer }>()
/** Outlives `inflated`, so a size stays known after its content is evicted. */
const inflatedSizes = new Map<string, { key: string; size: number }>()

async function readInflated(filePath: string): Promise<{ data: Buffer; mtimeMs: number }> {
  const fileStat = await stat(filePath)
  const key = `${fileStat.mtimeMs}:${fileStat.size}`
  const cached = inflated.get(filePath)
  if (cached?.key === key) {
    inflated.delete(filePath)
    inflated.set(filePath, cached)
    return { data: cached.data, mtimeMs: fileStat.mtimeMs }
  }

  const data = await inflate(await readFile(filePath))
  inflated.set(filePath, { key, data })
  inflatedSizes.set(filePath, { key, size: data.length })
  let total = 0
  for (const entry of inflated.values()) total += entry.data.length
  for (const [path, entry] of inflated) {
    if (inflated.size <= 1 || (inflated.size <= CACHE_ENTRIES && total <= CACHE_MAX_BYTES)) break
    inflated.delete(path)
    total -= entry.data.length
  }
  return { data, mtimeMs: fileStat.mtimeMs }
}

/** The subset of a `FileHandle` transcript readers use. */
export interface TranscriptHandle {
  read(buffer: Buffer, offset: number, length: number, position: number): Promise<{ bytesRead: number }>
  stat(): Promise<{ size: number; mtimeMs: number }>
  close(): Promise<void>
}

function bufferHandle(data: Buffer, mtimeMs: number): TranscriptHandle {
  return {
    async read(buffer, offset, length, position) {
      const start = Math.min(Math.max(position, 0), data.length)
      return { bytesRead: data.copy(buffer, offset, start, Math.min(start + length, data.length)) }
    },
    stat: async () => ({ size: data.length, mtimeMs }),
    close: async () => {},
  }
}

export async function openTranscript(filePath: string): Promise<TranscriptHandle> {
  if (!isCompressedTranscript(filePath)) return open(filePath, "r")
  const { data, mtimeMs } = await readInflated(filePath)
  return bufferHandle(data, mtimeMs)
}

/** Up to `byteLimit` leading bytes, inflating no further than that. */
export async function readTranscriptStart(filePath: string, byteLimit: number): Promise<Buffer> {
  if (!isCompressedTranscript(filePath)) {
    const fh = await open(filePath, "r")
    try {
      const buf = Buffer.allocUnsafe(byteLimit)
      const { bytesRead } = await fh.read(buf, 0, byteLimit, 0)
      return buf.subarray(0, bytesRead)
    } finally {
      await fh.close()
    }
  }

  const output = transcriptReadStream(filePath)
  const chunks: Buffer[] = []
  let total = 0
  try {
    for await (const chunk of output) {
      chunks.push(chunk as Buffer)
      total += (chunk as Buffer).length
      if (total >= byteLimit) break
    }
  } finally {
    output.destroy()
  }
  return Buffer.concat(chunks).subarray(0, byteLimit)
}

/** The transcript's content as a stream, for readers that never hold it whole. */
export function transcriptReadStream(filePath: string): Readable {
  const source = createReadStream(filePath)
  if (!isCompressedTranscript(filePath)) return source
  return pipeline(source, createZstdDecompress(), () => {})
}

export async function readTranscriptBuffer(filePath: string): Promise<Buffer> {
  return isCompressedTranscript(filePath) ? (await readInflated(filePath)).data : readFile(filePath)
}

export async function readTranscriptText(filePath: string): Promise<string> {
  return (await readTranscriptBuffer(filePath)).toString("utf-8")
}

/** Size and mtime, with the size of the decompressed content. */
export async function statTranscript(filePath: string): Promise<{ size: number; mtimeMs: number }> {
  const fileStat = await stat(filePath)
  if (!isCompressedTranscript(filePath)) return fileStat
  const key = `${fileStat.mtimeMs}:${fileStat.size}`
  const known = inflatedSizes.get(filePath)
  if (known?.key === key) return { size: known.size, mtimeMs: fileStat.mtimeMs }
  const { data, mtimeMs } = await readInflated(filePath)
  return { size: data.length, mtimeMs }
}
