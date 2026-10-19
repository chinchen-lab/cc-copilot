import { describe, expect, it } from "vitest"
import type { CrewMember, SessionCrew } from "../../../../shared/contracts/crew"
import {
  acrossWidth,
  CARD_HEIGHT,
  CARD_WIDTH,
  COLUMN_GAP,
  GROUP_INSET,
  GROUP_MIN,
  ROW_GAP,
  crewDepth,
  crewMapCounts,
  FOLD_ROOM,
  INDENT,
  layoutCrewMap,
  shownMembers,
  trailTo,
} from "../crewMapLayout"

function member(sessionId: string, parentId: string | null, startedAt: number, overrides: Partial<CrewMember> = {}): CrewMember {
  return { sessionId, parentId, startedAt, device: null, address: null, outcome: "completed", waiting: [], ...overrides }
}

const waiting = [{ kind: "question" as const, requestId: "q-1", questions: [] }] as unknown as CrewMember["waiting"]

/**
 * root
 * ├─ research (done)
 * │  ├─ scraper (running)
 * │  └─ analyst (done)
 * ├─ writer (needs input)
 * └─ coder (done)
 *    └─ reviewer (done)
 */
function crew(overrides: Record<string, Partial<CrewMember>> = {}): SessionCrew {
  const members = [
    member("root", null, 0, { startedAt: null }),
    member("research", "root", 10),
    member("writer", "root", 20, { outcome: "needs_input", waiting }),
    member("coder", "root", 30),
    member("scraper", "research", 40, { outcome: "running", status: "tool_use", toolName: "Bash" }),
    member("analyst", "research", 50),
    member("reviewer", "coder", 60),
  ].map((value) => ({ ...value, ...overrides[value.sessionId] }))
  return { sessionId: "root", rootId: "root", members }
}

const ids = (layout: ReturnType<typeof layoutCrewMap>) => layout.nodes.map((node) => node.member.sessionId)
const row = (index: number) => index * (CARD_HEIGHT + ROW_GAP)
const column = (depth: number) => depth * (CARD_WIDTH + COLUMN_GAP)

describe("layoutCrewMap", () => {
  it("draws every session from the root, each level in the order it was started", () => {
    const layout = layoutCrewMap(crew(), "all", new Set())
    expect(ids(layout)).toEqual(["root", "research", "scraper", "analyst", "writer", "coder", "reviewer"])
    const at = Object.fromEntries(layout.nodes.map((node) => [node.member.sessionId, [node.x, node.y]]))
    // A parent sits level with its first child; each childless card takes a row.
    expect(at.root).toEqual([column(0), row(0)])
    expect(at.research).toEqual([column(1), row(0)])
    expect(at.scraper).toEqual([column(2), row(0)])
    expect(at.analyst).toEqual([column(2), row(1)])
    expect(at.writer).toEqual([column(1), row(2)])
    expect(at.coder).toEqual([column(1), row(3)])
    expect(at.reviewer).toEqual([column(2), row(3)])
    expect(layout.width).toBe(3 * CARD_WIDTH + 2 * COLUMN_GAP)
    expect(layout.height).toBe(row(4) - ROW_GAP)
    expect(layout.edges.map((edge) => edge.parentId)).toEqual(["research", "coder", "root"])
    expect(layout.nodes.every((node) => !node.context)).toBe(true)
  })

  it("orders siblings started together by id, so polls never shuffle them", () => {
    const tied = crew({ writer: { startedAt: 10 } })
    expect(ids(layoutCrewMap(tied, "all", new Set())).slice(0, 5)).toEqual(["root", "research", "scraper", "analyst", "writer"])
  })

  it("keeps an active session's ancestors under Active and drops inactive siblings and finished branches", () => {
    const layout = layoutCrewMap(crew(), "active", new Set())
    expect(ids(layout)).toEqual(["root", "research", "scraper", "writer"])
    const context = Object.fromEntries(layout.nodes.map((node) => [node.member.sessionId, node.context]))
    expect(context).toEqual({ root: true, research: true, scraper: false, writer: false })
    // Ancestors keep their own state; they are context, not active.
    expect(layout.nodes.find((node) => node.member.sessionId === "research")?.member.outcome).toBe("completed")
  })

  it("keeps every ancestor of a deeply nested active session, up to the root", () => {
    const deep: SessionCrew = {
      sessionId: "root",
      rootId: "root",
      members: [
        member("root", null, 0, { startedAt: null }),
        member("a", "root", 1),
        member("b", "a", 2),
        member("c", "b", 3),
        member("d", "c", 4, { outcome: "needs_input", waiting }),
        member("b-sibling", "a", 5),
      ],
    }
    const layout = layoutCrewMap(deep, "active", new Set())
    expect(ids(layout)).toEqual(["root", "a", "b", "c", "d"])
    expect(layout.nodes.map((node) => node.depth)).toEqual([0, 1, 2, 3, 4])
  })

  it("shows only the root under Active when the root alone is working", () => {
    const busyRoot = crew({ root: { outcome: "running" }, scraper: { outcome: "completed" }, writer: { outcome: "completed", waiting: [] } })
    const layout = layoutCrewMap(busyRoot, "active", new Set())
    expect(ids(layout)).toEqual(["root"])
    expect(layout.nodes[0]!.context).toBe(false)
    expect(layout.edges).toEqual([])
  })

  it("draws nothing under Active when nothing is working or waiting", () => {
    const idle = crew({ scraper: { outcome: "completed" }, writer: { outcome: "completed", waiting: [] } })
    const layout = layoutCrewMap(idle, "active", new Set())
    expect(layout.nodes).toEqual([])
    expect(layout).toMatchObject({ width: 0, height: 0 })
  })

  it("folds a branch, counting the work it hides, without moving what sits above it", () => {
    const open = layoutCrewMap(crew(), "all", new Set())
    const folded = layoutCrewMap(crew(), "all", new Set(["research"]))
    expect(ids(folded)).toEqual(["root", "research", "writer", "coder", "reviewer"])
    const research = folded.nodes.find((node) => node.member.sessionId === "research")!
    expect(research).toMatchObject({ collapsed: true, childCount: 2, hidden: { count: 2, working: 1, needsYou: 0 } })
    expect(folded.nodes.find((node) => node.member.sessionId === "root")!.y).toBe(open.nodes[0]!.y)
    // A short stub stays on the folded card so the toggle reads as attached.
    expect(folded.edges.find((edge) => edge.parentId === "research")?.path).toBe(`M${column(1) + CARD_WIDTH} ${CARD_HEIGHT / 2}H${column(1) + CARD_WIDTH + COLUMN_GAP / 2}`)
  })

  it("counts a fold's hidden work at every depth, under the filter in use", () => {
    const folded = layoutCrewMap(crew(), "active", new Set(["root"]))
    expect(ids(folded)).toEqual(["root"])
    expect(folded.nodes[0]!.hidden).toEqual({ count: 3, working: 1, needsYou: 1 })
  })

  it("ignores a fold on a card with nothing under it", () => {
    const layout = layoutCrewMap(crew(), "all", new Set(["writer"]))
    expect(layout.nodes.find((node) => node.member.sessionId === "writer")).toMatchObject({ collapsed: false, childCount: 0 })
  })

  it("lays out the same places when only statuses change", () => {
    const before = layoutCrewMap(crew(), "all", new Set())
    const after = layoutCrewMap(crew({ coder: { outcome: "running" }, scraper: { outcome: "completed" } }), "all", new Set())
    expect(after.nodes.map(({ x, y }) => [x, y])).toEqual(before.nodes.map(({ x, y }) => [x, y]))
  })

  it("gives a member whose parent is not in the crew a tree of its own, with no invented edge", () => {
    const withOrphan: SessionCrew = { ...crew(), members: [...crew().members, member("stray", "hidden-parent", 70, { outcome: "running" })] }
    const layout = layoutCrewMap(withOrphan, "active", new Set())
    expect(ids(layout)).toEqual(["root", "research", "scraper", "writer", "stray"])
    const stray = layout.nodes.at(-1)!
    expect(stray).toMatchObject({ depth: 0, x: 0, context: false })
    expect(layout.edges.some((edge) => edge.parentId === "hidden-parent")).toBe(false)
  })
})

describe("layoutCrewMap with groups", () => {
  /** lead → branch (→ leaf-of-branch) and `count` childless lanes. */
  function wide(count: number, overrides: Record<string, Partial<CrewMember>> = {}): SessionCrew {
    const lanes = Array.from({ length: count }, (_, index) => member(`lane-${String(index).padStart(2, "0")}`, "lead", 10 + index))
    const members = [
      member("lead", null, 0, { startedAt: null }),
      member("branch", "lead", 50),
      member("leaf-of-branch", "branch", 60),
      ...lanes,
    ].map((value) => ({ ...value, ...overrides[value.sessionId] }))
    return { sessionId: "lead", rootId: "lead", members }
  }

  it("keeps a column unless asked, and below the threshold", () => {
    expect(layoutCrewMap(wide(12), "all", new Set()).groups).toEqual([])
    expect(layoutCrewMap(wide(GROUP_MIN - 1), "all", new Set(), { group: true }).groups).toEqual([])
  })

  it("puts many childless siblings in one framed grid after the branches, in the order they started", () => {
    const layout = layoutCrewMap(wide(9), "all", new Set(), { group: true })
    expect(ids(layout)).toEqual(["lead", "branch", "leaf-of-branch", ...Array.from({ length: 9 }, (_, index) => `lane-0${index}`)])
    const [frame] = layout.groups
    // The branch takes the first row; the grid of three columns starts on the next.
    expect(frame).toEqual({
      parentId: "lead",
      x: column(1),
      y: row(1),
      width: 3 * CARD_WIDTH + 2 * COLUMN_GAP + 2 * GROUP_INSET,
      height: 3 * CARD_HEIGHT + 2 * ROW_GAP + 2 * GROUP_INSET,
    })
    const cell = (id: string) => layout.nodes.find((node) => node.member.sessionId === id)!
    expect(cell("lane-00")).toMatchObject({ x: column(1) + GROUP_INSET, y: row(1) + GROUP_INSET, depth: 1, grouped: true })
    expect(cell("lane-04")).toMatchObject({ x: column(2) + GROUP_INSET, y: row(2) + GROUP_INSET })
    expect(cell("branch").grouped).toBe(false)
    expect(layout.width).toBe(column(1) + frame!.width)
    expect(layout.height).toBe(frame!.y + frame!.height)
    // One connector into the branch and one into the frame's first row.
    expect(layout.edges.find((edge) => edge.parentId === "lead")!.path).toContain(`V${row(1) + GROUP_INSET + CARD_HEIGHT / 2 - 6}`)
  })

  it("seats a parent level with its grid when the grid comes first", () => {
    const flat = wide(9)
    const layout = layoutCrewMap({ ...flat, members: flat.members.filter((value) => !value.sessionId.includes("branch")) }, "all", new Set(), { group: true })
    expect(layout.nodes[0]).toMatchObject({ y: GROUP_INSET })
    expect(layout.groups[0]).toMatchObject({ y: 0 })
  })

  it("counts a folded branch as childless, so it joins the grid with its toggle", () => {
    const layout = layoutCrewMap(wide(7), "all", new Set(["branch"]), { group: true })
    expect(layout.groups).toHaveLength(1)
    expect(layout.nodes.find((node) => node.member.sessionId === "branch")).toMatchObject({ grouped: true, collapsed: true })
  })

  it("leads the trail to a card in a grid through the frame", () => {
    const layout = layoutCrewMap(wide(9), "all", new Set(), { group: true })
    expect(trailTo(layout, "lane-08")).toBe(`M${CARD_WIDTH} ${CARD_HEIGHT / 2}H${CARD_WIDTH + COLUMN_GAP / 2}M${CARD_WIDTH + COLUMN_GAP / 2} ${CARD_HEIGHT / 2}V${row(1) + GROUP_INSET + CARD_HEIGHT / 2 - 6}Q${CARD_WIDTH + COLUMN_GAP / 2} ${row(1) + GROUP_INSET + CARD_HEIGHT / 2} ${CARD_WIDTH + COLUMN_GAP / 2 + 6} ${row(1) + GROUP_INSET + CARD_HEIGHT / 2}H${column(1)}`)
  })
})

describe("layoutCrewMap stacked", () => {
  const stacked = { stacked: { cardWidth: 240 } }

  it("gives every card its own row, stepped in under the session that started it", () => {
    const layout = layoutCrewMap(crew(), "all", new Set(), stacked)
    expect(layout).toMatchObject({ orientation: "stacked", cardWidth: 240, groups: [] })
    expect(ids(layout)).toEqual(["root", "research", "scraper", "analyst", "writer", "coder", "reviewer"])
    expect(layout.nodes.map(({ x, y }) => [x, y])).toEqual(layout.nodes.map((node, index) => [node.depth * INDENT, row(index)]))
    // The widest of the deepest parent with room for its fold toggle, and the deepest card.
    expect(layout.width).toBe(INDENT + 240 + FOLD_ROOM)
    expect(layoutCrewMap({ ...crew(), members: [crew().members[0]!] }, "all", new Set(), stacked).width).toBe(240)
    expect(layout.height).toBe(row(7) - ROW_GAP)
  })

  it("runs each connector down the step from under the parent into its children", () => {
    const layout = layoutCrewMap(crew(), "all", new Set(), stacked)
    const rail = INDENT / 2
    const into = (index: number) => row(index) + CARD_HEIGHT / 2
    expect(layout.edges.find((edge) => edge.parentId === "root")!.path).toBe(
      [1, 4, 5].map((index) => `M${rail} ${CARD_HEIGHT}V${into(index) - 6}Q${rail} ${into(index)} ${rail + 6} ${into(index)}H${INDENT}`).join(""),
    )
    expect(trailTo(layout, "scraper")).toBe(
      `M${rail} ${CARD_HEIGHT}V${into(1) - 6}Q${rail} ${into(1)} ${rail + 6} ${into(1)}H${INDENT}`
      + `M${INDENT + rail} ${row(1) + CARD_HEIGHT}V${into(2) - 6}Q${INDENT + rail} ${into(2)} ${INDENT + rail + 6} ${into(2)}H${2 * INDENT}`,
    )
  })

  it("folds without a stub, since its toggle sits beside the card", () => {
    const layout = layoutCrewMap(crew(), "all", new Set(["research"]), stacked)
    expect(ids(layout)).toEqual(["root", "research", "writer", "coder", "reviewer"])
    expect(layout.edges.some((edge) => edge.parentId === "research")).toBe(false)
  })

  it("never draws grids", () => {
    const flat: SessionCrew = { sessionId: "root", rootId: "root", members: [member("root", null, 0), ...Array.from({ length: 10 }, (_, index) => member(`lane-${index}`, "root", index))] }
    expect(layoutCrewMap(flat, "all", new Set(), { group: true, ...stacked }).groups).toEqual([])
  })
})

describe("crewDepth", () => {
  it("measures the whole crew, whatever is shown, and the across width it needs", () => {
    expect(crewDepth(crew())).toBe(2)
    expect(crewDepth({ sessionId: "root", rootId: "root", members: [member("root", null, 0)] })).toBe(0)
    expect(acrossWidth(2)).toBe(3 * CARD_WIDTH + 2 * COLUMN_GAP)
  })
})

describe("shownMembers", () => {
  it("keeps everything under All", () => {
    expect(shownMembers(crew(), "all").size).toBe(7)
  })

  it("survives a parent cycle without looping", () => {
    const looped: SessionCrew = { sessionId: "a", rootId: "a", members: [member("a", "b", 1), member("b", "a", 2, { outcome: "running" })] }
    expect([...shownMembers(looped, "active")].sort()).toEqual(["a", "b"])
    expect(ids(layoutCrewMap(looped, "all", new Set()))).toEqual(["a", "b"])
  })
})

describe("crewMapCounts", () => {
  it("counts the root with its members, active as working plus waiting", () => {
    expect(crewMapCounts(crew())).toEqual({ all: 7, active: 2, working: 1, needsYou: 1 })
    expect(crewMapCounts(crew({ root: { outcome: "running" } }))).toMatchObject({ active: 3, working: 2 })
  })
})

describe("trailTo", () => {
  it("draws the connectors from the root to the open session", () => {
    const layout = layoutCrewMap(crew(), "all", new Set())
    const trail = trailTo(layout, "reviewer")!
    // root → coder bends down to coder's row; coder → reviewer runs straight.
    expect(trail).toContain(`V${row(3) + CARD_HEIGHT / 2 - 6}`)
    expect(trail.endsWith(`M${column(1) + CARD_WIDTH} ${row(3) + CARD_HEIGHT / 2}H${column(2)}`)).toBe(true)
    expect(trailTo(layout, "root")).toBeNull()
    expect(trailTo(layout, null)).toBeNull()
  })

  it("stops where a fold hides the open session", () => {
    const layout = layoutCrewMap(crew(), "all", new Set(["coder"]))
    expect(trailTo(layout, "reviewer")).toBeNull()
  })
})
