import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { loadModelCatalog } from "@/hooks/useModelOptions"
import { ModelCatalogRefresh } from "../settings/ModelCatalogRefresh"

vi.mock("@/hooks/useModelOptions", () => ({ loadModelCatalog: vi.fn() }))
const load = vi.mocked(loadModelCatalog)
beforeEach(() => { load.mockReset() })

describe("ModelCatalogRefresh", () => {
  it("forces a refresh and prevents repeated clicks while loading", async () => {
    let finish!: () => void
    load.mockImplementationOnce(() => new Promise<void>((resolve) => { finish = resolve }))
    render(<ModelCatalogRefresh />)
    const button = screen.getByRole("button", { name: "Refresh models" })
    fireEvent.click(button)
    expect(load).toHaveBeenCalledExactlyOnceWith(true)
    expect(button).toBeDisabled()
    fireEvent.click(button)
    expect(load).toHaveBeenCalledOnce()
    finish()
    await waitFor(() => expect(button).toBeEnabled())
  })

  it("shows a failed refresh and allows retrying", async () => {
    load.mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce(undefined)
    render(<ModelCatalogRefresh />)
    const button = screen.getByRole("button", { name: "Refresh models" })
    fireEvent.click(button)
    expect(await screen.findByRole("alert")).toHaveTextContent("Refresh failed. Try again.")
    fireEvent.click(button)
    await waitFor(() => expect(button).toBeEnabled())
    expect(screen.queryByRole("alert")).not.toBeInTheDocument()
    expect(load).toHaveBeenCalledTimes(2)
  })
})
