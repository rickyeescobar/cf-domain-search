/**
 * Pure rendering of check results: grouping, sorting, money formatting,
 * and the closing summary line. No IO happens here.
 */
import type { CheckedDomain } from "./Cloudflare.ts"
import type { Style } from "./Style.ts"

export interface BatchFailure {
  readonly domains: ReadonlyArray<string>
  readonly message: string
}

const UNSUPPORTED = "extension_not_supported_via_api"

/** Dashboard purchase page, pre-filtered to a name or exact domain. */
export const purchaseUrl = (accountId: string, query: string): string =>
  `https://dash.cloudflare.com/${accountId}/domains/registrations/purchase?query=${query}`

export const money = (value: string | number | undefined): string => {
  if (value === undefined) return "?"
  const parsed = Number(value)
  return Number.isNaN(parsed)
    ? String(value)
    : `$${parsed.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

const registrationCost = (domain: CheckedDomain): number =>
  domain.pricing?.registration_cost !== undefined
    ? Number(domain.pricing.registration_cost)
    : Infinity

const SPARKS = ["▁", "▂", "▃", "▄", "▅", "▆", "▇", "█"]

/**
 * A log-scaled price histogram: most prices cluster low with a few premium
 * spikes, so linear buckets would collapse everything into the first bar.
 */
const sparkline = (costs: ReadonlyArray<number>, buckets = 12): string => {
  const min = Math.min(...costs)
  const max = Math.max(...costs)
  if (!Number.isFinite(min) || !Number.isFinite(max) || min === max || min <= 0) return ""
  const lo = Math.log(min)
  const span = Math.log(max) - lo
  const counts = new Array<number>(buckets).fill(0)
  for (const cost of costs) {
    const bucket = Math.min(buckets - 1, Math.floor(((Math.log(cost) - lo) / span) * buckets))
    counts[bucket] = (counts[bucket] ?? 0) + 1
  }
  const top = Math.max(...counts)
  return counts
    .map((n) => SPARKS[n === 0 ? 0 : Math.max(1, Math.round((n / top) * 7))] ?? "▁")
    .join("")
}

const wrapList = (
  names: ReadonlyArray<string>,
  decorate: (line: string) => string,
  perLine = 4
): string => {
  const colWidth = Math.max(...names.map((n) => n.length)) + 2
  const lines: Array<string> = []
  for (let i = 0; i < names.length; i += perLine) {
    lines.push(decorate(names.slice(i, i + perLine).map((n) => n.padEnd(colWidth)).join("")))
  }
  return lines.join("\n")
}

export const render = (
  results: ReadonlyArray<CheckedDomain>,
  failures: ReadonlyArray<BatchFailure>,
  options: {
    readonly name: string
    readonly availableOnly: boolean
    readonly accountId: string
    readonly links: boolean
  },
  style: Style
): string => {
  const { bold, dim, green, link, red, yellow } = style

  // An exact single-domain check gets a verdict, not a table.
  const only = results[0]
  if (options.name.includes(".") && results.length === 1 && only !== undefined) {
    const url = purchaseUrl(options.accountId, only.name)
    if (only.registrable) {
      const price = money(only.pricing?.registration_cost)
      const renewal = only.pricing !== undefined
        ? `renews ${money(only.pricing.renewal_cost)}/yr`
        : ""
      const premium = only.tier !== undefined && only.tier !== "standard"
        ? yellow(`${renewal === "" ? "" : " · "}${only.tier} tier`)
        : ""
      return [
        "",
        `  ✨  ${bold(green(link(only.name, url)))} is ${bold(green("AVAILABLE"))} — ${bold(`${price}/yr`)}  ✨`,
        ...renewal !== "" || premium !== "" ? [`      ${dim(renewal)}${premium}`] : [],
        `      ${dim(url)}`
      ].join("\n")
    }
    if (only.reason === UNSUPPORTED) {
      return [
        "",
        `  ${dim("·")} ${bold(only.name)} can't be checked via the API — it may still be available:`,
        `    ${dim(url)}`
      ].join("\n")
    }
    return `\n  ${red("✘")} ${bold(only.name)} is taken  ${red(":(")}`
  }

  const available = results
    .filter((d) => d.registrable)
    .toSorted((a, b) => registrationCost(a) - registrationCost(b))
  const taken = results
    .filter((d) => !d.registrable && d.reason !== UNSUPPORTED)
    .toSorted((a, b) => a.name.localeCompare(b.name))
  const unsupported = results
    .filter((d) => !d.registrable && d.reason === UNSUPPORTED)
    .toSorted((a, b) => a.name.localeCompare(b.name))

  const width = Math.max(...results.map((d) => d.name.length), 0) + 2
  const lines: Array<string> = []

  if (available.length > 0) {
    lines.push(bold(`\nAvailable (${available.length})`))
    for (const domain of available) {
      const renewal = domain.pricing !== undefined
        ? dim(`renews ${money(domain.pricing.renewal_cost)}/yr`)
        : ""
      const premium = domain.tier !== undefined && domain.tier !== "standard"
        ? yellow(` [${domain.tier} tier]`)
        : ""
      const url = purchaseUrl(options.accountId, domain.name)
      // Pad before wrapping in the OSC 8 link so escape codes don't skew width.
      const padding = " ".repeat(width - domain.name.length)
      lines.push(
        `  ${green("✔")} ${link(domain.name, url)}${padding} ` +
          `${money(domain.pricing?.registration_cost).padStart(8)}  ${renewal}${premium}`
      )
      if (options.links) {
        lines.push(`    ${dim(url)}`)
      }
    }
  } else {
    lines.push(bold("\nNo available domains found") + `  ${red(":(")}`)
  }

  if (!options.availableOnly) {
    if (taken.length > 0) {
      lines.push(bold(`\nTaken (${taken.length})`))
      lines.push(wrapList(taken.map((d) => d.name), (s) => `  ${red("✘")} ${s}`))
    }
    if (unsupported.length > 0) {
      lines.push(
        bold(`\nNot supported via API (${unsupported.length})`) +
          dim(" — may still be purchasable in the dashboard")
      )
      lines.push(wrapList(unsupported.map((d) => d.name), (s) => `  ${dim("·")} ${dim(s)}`))
    }
  }

  for (const failure of failures) {
    lines.push(
      red(`\nerror: batch [${failure.domains[0]} … ${failure.domains.at(-1)}] failed: ${failure.message}`)
    )
  }

  const cheapest = available[0]
  lines.push("")
  lines.push(
    `${bold(String(available.length))} available · ${taken.length} taken · ` +
      `${unsupported.length} unsupported` +
      (cheapest !== undefined
        ? ` · cheapest: ${bold(cheapest.name)} at ${money(cheapest.pricing?.registration_cost)}/yr`
        : "")
  )
  const costs = available.map(registrationCost).filter((cost) => Number.isFinite(cost))
  const sparks = costs.length >= 8 ? sparkline(costs) : ""
  if (sparks !== "") {
    lines.push(dim(`prices ${money(Math.min(...costs))} – ${money(Math.max(...costs))}  ${sparks}`))
  }
  lines.push(dim(`buy: ${purchaseUrl(options.accountId, options.name)}`))

  return lines.join("\n")
}
