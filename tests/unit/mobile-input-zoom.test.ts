import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"

const styles = readFileSync(resolve("src/app/styles.css"), "utf8")

describe("mobile text controls", () => {
  it("keeps editable controls at 16px so iOS does not zoom on focus", () => {
    expect(styles).not.toContain("@media (max-width: 767px)")
    expect(styles).toContain('.field-label input[type="text"]')
    expect(styles).toContain(".auth-field input")
    expect(styles).toContain(".field-label textarea,")
    expect(styles).toContain(".field-label select,")
    expect(styles).toContain("font-size: 16px;")
  })
})
