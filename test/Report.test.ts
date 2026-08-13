import { describe, it } from "@effect/vitest"
import { assertFalse, assertInclude, assertTrue, strictEqual } from "@effect/vitest/utils"
import { CheckedDomain, Pricing } from "../src/Cloudflare.ts"
import { money, purchaseUrl, render } from "../src/Report.ts"
import { plain } from "../src/Style.ts"

const pricing = (cost: string) =>
  new Pricing({ currency: "USD", registration_cost: cost, renewal_cost: cost })

const options = {
  name: "acme",
  availableOnly: false,
  accountId: "acct",
  links: false
}

const day = new CheckedDomain({ name: "acme.day", registrable: true, tier: "standard", pricing: pricing("10.20") })
const bid = new CheckedDomain({ name: "acme.bid", registrable: true, tier: "standard", pricing: pricing("4.18") })
const com = new CheckedDomain({ name: "acme.com", registrable: false, reason: "domain_unavailable" })
const sh = new CheckedDomain({ name: "acme.sh", registrable: false, reason: "extension_not_supported_via_api" })
const results = [day, bid, com, sh]

describe("render", () => {
  it("groups results and sorts available cheapest first", () => {
    const output = render(results, [], options, plain)
    assertInclude(output, "Available (2)")
    assertInclude(output, "Taken (1)")
    assertInclude(output, "Not supported via API (1)")
    assertTrue(output.indexOf("acme.bid") < output.indexOf("acme.day"))
    assertInclude(output, "2 available · 1 taken · 1 unsupported · cheapest: acme.bid at $4.18/yr")
    assertInclude(output, `buy: ${purchaseUrl("acct", "acme")}`)
  })

  it("availableOnly hides taken and unsupported groups", () => {
    const output = render(results, [], { ...options, availableOnly: true }, plain)
    assertFalse(output.includes("Taken"))
    assertFalse(output.includes("Not supported"))
    assertInclude(output, "1 taken · 1 unsupported")
  })

  it("links prints a purchase url under each available domain", () => {
    const output = render(results, [], { ...options, links: true }, plain)
    assertInclude(output, purchaseUrl("acct", "acme.bid"))
    assertInclude(output, purchaseUrl("acct", "acme.day"))
    assertFalse(output.includes(purchaseUrl("acct", "acme.com")))
  })

  it("flags premium tiers", () => {
    const premium = [
      new CheckedDomain({ name: "acme.inc", registrable: true, tier: "premium", pricing: pricing("2000.20") })
    ]
    const output = render(premium, [], options, plain)
    assertInclude(output, "[premium tier]")
    assertInclude(output, "$2,000.20")
  })

  it("frowns when nothing is available", () => {
    const output = render([com, sh], [], options, plain)
    assertInclude(output, "No available domains found  :(")
  })

  it("renders batch failures and keeps the summary", () => {
    const failures = [{ domains: ["acme.a", "acme.b"], message: "boom" }]
    const output = render(results, failures, options, plain)
    assertInclude(output, "error: batch [acme.a … acme.b] failed: boom")
    assertInclude(output, "2 available")
  })

  describe("exact single-domain checks", () => {
    it("available domain gets a verdict with price and purchase url", () => {
      const output = render([day], [], { ...options, name: "acme.day" }, plain)
      assertInclude(output, "acme.day is AVAILABLE — $10.20/yr")
      assertInclude(output, "renews $10.20/yr")
      assertInclude(output, purchaseUrl("acct", "acme.day"))
      assertFalse(output.includes("Available ("))
    })

    it("taken domain gets a frown", () => {
      const output = render([com], [], { ...options, name: "acme.com" }, plain)
      assertInclude(output, "acme.com is taken  :(")
    })

    it("unsupported domain points at the dashboard", () => {
      const output = render([sh], [], { ...options, name: "acme.sh" }, plain)
      assertInclude(output, "can't be checked via the API")
      assertInclude(output, purchaseUrl("acct", "acme.sh"))
    })
  })
})

describe("money", () => {
  it("formats numeric strings and numbers with separators", () => {
    strictEqual(money("10.20"), "$10.20")
    strictEqual(money(4.18), "$4.18")
    strictEqual(money("2000.2"), "$2,000.20")
  })

  it("passes through the unknowns", () => {
    strictEqual(money(undefined), "?")
    strictEqual(money("free"), "free")
  })
})
