import {readFileSync} from "node:fs"
import {join} from "node:path"
import {describe, expect, it} from "vitest"
import {FAULTS, REASONS, STAGES, STEPS, failed, reasonCode, sizeWords} from "src/domain/orderSteps"

// Each table row of MARKETPLACE.md, as its trimmed cells.
const rows = readFileSync(join(__dirname, "../../../MARKETPLACE.md"), "utf8")
  .split("\n")
  .filter(line => line.startsWith("|"))
  .map(line =>
    line
      .slice(1, -1)
      .split("|")
      .map(cell => cell.trim()),
  )

const hasRow = (cells: string[]) => rows.some(row => row.join("|") === cells.join("|"))

describe("order step names and codes", () => {
  it("gives every code its own number in a known stage", () => {
    const codes = FAULTS.map(f => f.code)

    expect(new Set(codes).size).toBe(codes.length)

    for (const code of codes) {
      expect(STAGES.map(s => s.codes[0])).toContain(String(code)[0])
    }
  })

  it("keeps every name and title to a word or a few", () => {
    for (const step of STEPS) expect(step.name).toMatch(/^[A-Z]+$/)
    for (const fault of FAULTS) expect(fault.title.split(" ").length).toBeLessThanOrEqual(3)
  })

  it("documents every step, code and reason in MARKETPLACE.md", () => {
    for (const s of STEPS) expect(hasRow([`\`${s.name}\``, s.by, s.about]), s.name).toBe(true)
    for (const s of STAGES) expect(hasRow([s.codes, s.stage]), s.codes).toBe(true)

    for (const f of FAULTS) {
      expect(hasRow([`\`${f.code}\``, f.title, f.about, f.next]), String(f.code)).toBe(true)
    }

    for (const r of REASONS) expect(hasRow([`\`${r.reason}\``, r.about]), r.reason).toBe(true)
  })

  it("shows a library reason only when it is a code", () => {
    expect(reasonCode("INVOICE_EXPIRED")).toBe("INVOICE_EXPIRED")
    expect(reasonCode("a bill or payment proof came before any acceptance")).toBeUndefined()
    expect(reasonCode(null)).toBeUndefined()
    expect(failed(301, "INVOICE_EXPIRED")).toEqual({
      name: "BILL",
      short: "Bill refused",
      code: 301,
      reason: "INVOICE_EXPIRED",
    })
    expect(() => failed(999)).toThrow()
  })

  it("names a file size in a few words", () => {
    expect(sizeWords(512)).toBe("512 bytes")
    expect(sizeWords(199 * 1024)).toBe("199 KB")
    expect(sizeWords(3 * 1024 * 1024)).toBe("3.0 MB")
  })
})
