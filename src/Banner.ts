/**
 * The cf-domain-search cloud, printed at the top of every human-facing interaction
 * (never in `--json` output).
 */
import { Console, Effect } from "effect"
import { Style } from "./Style.ts"

export const banner = ({ bold, dim, orange }: Style): string =>
  [
    orange("        ▄▄▄▄▄"),
    `${orange("    ▄▄█████████▄▄")}            ${bold("cf-domain-search")}`,
    `${orange("  ▄███████████████▄▄▄")}        ${dim("Cloudflare Registrar domain search")}`,
    orange(" ▟█████████████████████▙"),
    orange(" ▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀")
  ].join("\n")

/** Prints the banner preceded by a blank line, styled per the current Style. */
export const printBanner: Effect.Effect<void> = Effect.gen(function*() {
  const style = yield* Style
  yield* Console.log(`\n${banner(style)}`)
})
