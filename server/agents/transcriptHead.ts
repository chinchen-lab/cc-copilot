import { readFile, stat } from "node:fs/promises"
import { isCompressedTranscript, readTranscriptBuffer, readTranscriptStart } from "./transcriptFile"
import type { TranscriptHead } from "./types"

/** Bytes read from the head of a transcript, for metadata and for identity. */
export const HEAD_BYTES = 32768
/** Transcripts up to this size are read whole rather than by their head. */
const WHOLE_FILE_LIMIT = 65536

/**
 * Whole lines from the first `byteLimit` bytes of a file. A read that filled
 * the buffer drops its trailing line, which may have been cut mid-record.
 */
export async function readHeadLines(filePath: string, byteLimit: number): Promise<string[]> {
  const buf = await readTranscriptStart(filePath, byteLimit)
  let text = buf.toString("utf-8")
  if (buf.length === byteLimit) {
    const lastNewline = text.lastIndexOf("\n")
    if (lastNewline >= 0) text = text.slice(0, lastNewline)
  }
  return text.split("\n").filter(Boolean)
}

/**
 * The opening lines of a transcript — the whole file when it is small, the
 * first `HEAD_BYTES` (cut at a line boundary) when it is not.
 */
export async function readTranscriptHead(filePath: string): Promise<TranscriptHead> {
  // Only the whole of a compressed transcript is cheaper to have than its size.
  if (isCompressedTranscript(filePath)) {
    const content = await readTranscriptBuffer(filePath)
    return { lines: content.toString("utf-8").split("\n").filter(Boolean), isPartialRead: false, size: content.length }
  }
  const fileStat = await stat(filePath)
  if (fileStat.size <= WHOLE_FILE_LIMIT) {
    const content = await readFile(filePath, "utf-8")
    return { lines: content.split("\n").filter(Boolean), isPartialRead: false, size: fileStat.size }
  }

  return { lines: await readHeadLines(filePath, HEAD_BYTES), isPartialRead: true, size: fileStat.size }
}

/** Every line of the transcript, re-reading only when `head` stopped short. */
export async function readWholeTranscript(filePath: string, head: TranscriptHead): Promise<string[]> {
  if (!head.isPartialRead) return head.lines
  const content = await readFile(filePath, "utf-8")
  return content.split("\n").filter(Boolean)
}
