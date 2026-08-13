import { describe, expect, test } from "bun:test"
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
  test("groups results and sorts available cheapest first", () => {
    const output = render(results, [], options, plain)
    expect(output).toContain("Available (2)")
    expect(output).toContain("Taken (1)")
    expect(output).toContain("Not supported via API (1)")
    expect(output.indexOf("acme.bid")).toBeLessThan(output.indexOf("acme.day"))
    expect(output).toContain("2 available · 1 taken · 1 unsupported · cheapest: acme.bid at $4.18/yr")
    expect(output).toContain(`buy: ${purchaseUrl("acct", "acme")}`)
  })

  test("availableOnly hides taken and unsupported groups", () => {
    const output = render(results, [], { ...options, availableOnly: true }, plain)
    expect(output).not.toContain("Taken")
    expect(output).not.toContain("Not supported")
    expect(output).toContain("1 taken · 1 unsupported")
  })

  test("links prints a purchase url under each available domain", () => {
    const output = render(results, [], { ...options, links: true }, plain)
    expect(output).toContain(purchaseUrl("acct", "acme.bid"))
    expect(output).toContain(purchaseUrl("acct", "acme.day"))
    expect(output).not.toContain(purchaseUrl("acct", "acme.com"))
  })

  test("flags premium tiers", () => {
    const premium = [
      new CheckedDomain({ name: "acme.inc", registrable: true, tier: "premium", pricing: pricing("2000.20") })
    ]
    const output = render(premium, [], options, plain)
    expect(output).toContain("[premium tier]")
    expect(output).toContain("$2,000.20")
  })

  test("frowns when nothing is available", () => {
    const output = render([com, sh], [], options, plain)
    expect(output).toContain("No available domains found  :(")
  })

  test("renders batch failures and keeps the summary", () => {
    const failures = [{ domains: ["acme.a", "acme.b"], message: "boom" }]
    const output = render(results, failures, options, plain)
    expect(output).toContain("error: batch [acme.a … acme.b] failed: boom")
    expect(output).toContain("2 available")
  })

  describe("exact single-domain checks", () => {
    test("available domain gets a verdict with price and purchase url", () => {
      const output = render([day], [], { ...options, name: "acme.day" }, plain)
      expect(output).toContain("acme.day is AVAILABLE — $10.20/yr")
      expect(output).toContain("renews $10.20/yr")
      expect(output).toContain(purchaseUrl("acct", "acme.day"))
      expect(output).not.toContain("Available (")
    })

    test("taken domain gets a frown", () => {
      const output = render([com], [], { ...options, name: "acme.com" }, plain)
      expect(output).toContain("acme.com is taken  :(")
    })

    test("unsupported domain points at the dashboard", () => {
      const output = render([sh], [], { ...options, name: "acme.sh" }, plain)
      expect(output).toContain("can't be checked via the API")
      expect(output).toContain(purchaseUrl("acct", "acme.sh"))
    })
  })
})

describe("money", () => {
  test("formats numeric strings and numbers with separators", () => {
    expect(money("10.20")).toBe("$10.20")
    expect(money(4.18)).toBe("$4.18")
    expect(money("2000.2")).toBe("$2,000.20")
  })

  test("passes through the unknowns", () => {
    expect(money(undefined)).toBe("?")
    expect(money("free")).toBe("free")
  })
})
