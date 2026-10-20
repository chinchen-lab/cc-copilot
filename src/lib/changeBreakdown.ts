import { summarizeChanges, type ChangeBreakdownRow, type LineChanges } from "../../shared/changedFileKind"
import { relativePathWithin } from "@/lib/paths"

/**
 * Lines per kind of file for changes recorded with absolute paths, classified
 * relative to `cwd` so the directories above the project do not count.
 */
export function changeBreakdownWithin(
  cwd: string,
  files: Iterable<{ filePath: string } & LineChanges>,
): ChangeBreakdownRow[] {
  return summarizeChanges(Array.from(files, (file) => ({
    path: relativePathWithin(cwd, file.filePath) ?? file.filePath,
    additions: file.additions,
    deletions: file.deletions,
  })))
}
