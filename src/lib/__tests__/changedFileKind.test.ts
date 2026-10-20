import { describe, expect, it } from "vitest"
import { classifyChangedFile, summarizeChanges } from "../../../shared/changedFileKind"

describe("classifyChangedFile", () => {
  it.each([
    ["server/routes/session-file-changes.ts", "code"],
    ["src/latest.ts", "code"],
    ["src/Latest.java", "code"],
    ["src/contest.py", "code"],
    ["src/mockingbird.ts", "code"],
    ["src/testimonials/List.tsx", "code"],
    ["src/testUtils.ts", "code"],
    ["src/foo.test.ts", "tests"],
    ["src/Foo.browser.test.tsx", "tests"],
    ["src/foo.spec.js", "tests"],
    ["pkg/server_test.go", "tests"],
    ["tests/test_api.py", "tests"],
    ["conftest.py", "tests"],
    ["vitest.setup.ts", "tests"],
    ["src/main/java/RequestTest.java", "tests"],
    ["Sources/AppTests.swift", "tests"],
    ["spec/models/user_spec.rb", "tests"],
    ["src/__tests__/helpers.ts", "tests"],
    ["src\\__tests__\\app.ts", "tests"],
    ["e2e/login.ts", "tests"],
    ["src/__mocks__/fs.ts", "mocks"],
    ["test/fixtures/pr.json", "mocks"],
    ["src/__snapshots__/view.test.ts.snap", "mocks"],
    ["src/api.mock.ts", "mocks"],
    ["src/mockServer.ts", "mocks"],
    ["pkg/testdata/input.txt", "mocks"],
    ["pnpm-lock.yaml", "generated"],
    ["apps/web/package-lock.json", "generated"],
    ["bun.lock", "generated"],
    ["Cargo.lock", "generated"],
    ["go.sum", "generated"],
    ["src/routeTree.gen.ts", "generated"],
    ["src/__generated__/types.ts", "generated"],
    ["api/user.pb.go", "generated"],
    ["api/user_pb2_grpc.py", "generated"],
    ["dist/app.min.js", "generated"],
    ["dist/app.js.map", "generated"],
    ["README.md", "docs"],
    ["docs/internals/overview.mdx", "docs"],
    ["CHANGELOG.markdown", "docs"],
    ["docs/index.rst", "docs"],
    ["guide.adoc", "docs"],
    ["NOTES.txt", "docs"],
    ["requirements-dev.txt", "code"],
    ["constraints.txt", "code"],
    ["CMakeLists.txt", "code"],
    ["public/robots.txt", "code"],
    ["llms.txt", "code"],
    ["tests/README.md", "tests"],
  ] as const)("%s is %s", (path, kind) => {
    expect(classifyChangedFile(path)).toBe(kind)
  })
})

describe("summarizeChanges", () => {
  it("sums each kind in a fixed order and leaves out kinds without changes", () => {
    expect(summarizeChanges([
      { path: "README.md", additions: 4, deletions: 1 },
      { path: "src/app.ts", additions: 10, deletions: 2 },
      { path: "src/app.test.ts", additions: 20, deletions: 0 },
      { path: "src/lib.ts", additions: 5, deletions: 3 },
      { path: "bun.lock", additions: 0, deletions: 0 },
    ])).toEqual([
      { kind: "code", label: "Code", additions: 15, deletions: 5 },
      { kind: "tests", label: "Tests", additions: 20, deletions: 0 },
      { kind: "docs", label: "Docs", additions: 4, deletions: 1 },
    ])
  })

  it("is empty when nothing changed", () => {
    expect(summarizeChanges([])).toEqual([])
  })
})
