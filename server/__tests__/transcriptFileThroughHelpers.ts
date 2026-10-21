/**
 * Stand-in for `agents/transcriptFile` in route tests that mock the fs
 * functions of `../helpers`: plain transcripts read through those mocks, so a
 * test's fixture content reaches the route unchanged.
 *
 *   vi.mock("../../agents/transcriptFile", () => import("../transcriptFileThroughHelpers"))
 */
import { open, readFile, stat } from "../helpers"

export const isCompressedTranscript = (filePath: string) => filePath.endsWith(".zst")
export const uncompressedTranscriptName = (fileName: string) => fileName.replace(/\.zst$/, "")
export const readTranscriptText = (filePath: string) => readFile(filePath, "utf-8")
export const readTranscriptBuffer = (filePath: string) => readFile(filePath)
export const openTranscript = (filePath: string) => open(filePath, "r")
export const statTranscript = (filePath: string) => stat(filePath)
