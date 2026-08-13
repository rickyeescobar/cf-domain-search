/**
 * The `cfdomains` command: check a name's availability and price across every
 * Cloudflare Registrar TLD, plus the `setup` subcommand.
 */
import { Array as Arr, Config, Console, Data, Effect, Option, Redacted, Ref, Result, Runtime, Schema } from "effect"
import { Argument, CliError, Command, Flag, GlobalFlag } from "effect/unstable/cli"
import { printBanner } from "./Banner.ts"
import { CheckedDomain, Cloudflare, type CloudflareError } from "./Cloudflare.ts"
import { CredentialStore, type Credentials } from "./Credentials.ts"
import { purchaseUrl, render, type BatchFailure } from "./Report.ts"
import { wizard } from "./Setup.ts"
import { plain, Style } from "./Style.ts"
import * as Tlds from "./Tlds.ts"

const BATCH_SIZE = 20 // domain-check API maximum per request
const CONCURRENCY = 5
const BAR_WIDTH = 24

const progressBar = (done: number, total: number): string => {
  const filled = total === 0 ? BAR_WIDTH : Math.round((done / total) * BAR_WIDTH)
  return `▐${"█".repeat(filled)}${"░".repeat(BAR_WIDTH - filled)}▌ ${done}/${total}`
}

const DomainName = Schema.String.pipe(
  Schema.check(Schema.isPattern(/^[a-z0-9]([a-z0-9.-]*[a-z0-9])?\.?$/i, {
    message: "Expected a domain label like `myname` or a full domain like `myname.dev`"
  }))
)

const name = Argument.string("name").pipe(
  Argument.withDescription("Name to check across TLDs, or a full domain for an exact check"),
  Argument.withSchema(DomainName)
)

const normalizeTld = (tld: string): string => tld.trim().toLowerCase().replace(/^\./, "")

const flags = {
  available: Flag.boolean("available").pipe(
    Flag.withAlias("a"),
    Flag.withDescription("Only show available domains")
  ),
  json: Flag.boolean("json").pipe(
    Flag.withDescription("Machine-readable output (includes purchase_url per available domain)")
  ),
  links: Flag.boolean("links").pipe(
    Flag.withAlias("l"),
    Flag.withDescription("Print a purchase link under each available domain")
  ),
  tlds: Flag.string("tlds").pipe(
    Flag.withDescription("Restrict to a comma-separated list of TLDs, e.g. com,dev,io"),
    Flag.map((csv) => csv.split(",").map(normalizeTld).filter((tld) => tld.length > 0)),
    Flag.optional
  ),
  liveTlds: Flag.boolean("live-tlds").pipe(
    Flag.withDescription("Merge in the TLD list from cfdomainpricing.com")
  ),
  token: Flag.redacted("token").pipe(
    Flag.withDescription("Cloudflare API token (falls back to CLOUDFLARE_API_TOKEN)"),
    Flag.withFallbackConfig(Config.redacted("CLOUDFLARE_API_TOKEN")),
    Flag.optional
  ),
  accountId: Flag.string("account-id").pipe(
    Flag.withDescription("Cloudflare account ID (falls back to CLOUDFLARE_ACCOUNT_ID)"),
    Flag.withFallbackConfig(Config.string("CLOUDFLARE_ACCOUNT_ID")),
    Flag.optional
  )
}

const NoColor = GlobalFlag.setting("no-color")({
  flag: Flag.boolean("no-color").pipe(Flag.withDescription("Disable colored output"))
})

/** Honor --no-color by overriding the Style reference for everything downstream. */
const withStyleFlag = <A, E, R>(self: Effect.Effect<A, E, R>) =>
  Effect.gen(function*() {
    return (yield* NoColor)
      ? yield* Effect.provideService(self, Style, plain)
      : yield* self
  })

/** Exits 1 without extra logging — the details were already printed. */
class QuietFailure extends Data.TaggedError("QuietFailure") {
  readonly [Runtime.errorReported] = false
}

/** Turn a prompt abort (ctrl-c / closed input) into a quiet non-zero exit. */
const onQuitAbort = () =>
  Console.error("Setup aborted.").pipe(Effect.flatMap(() => new QuietFailure()))

const setup = Command.make("setup", {}, () =>
  printBanner.pipe(
    Effect.flatMap(() => wizard),
    Effect.flatMap(() => Console.log("\nSetup complete. Try: cfdomains yourname")),
    Effect.catchTag("QuitError", onQuitAbort),
    withStyleFlag
  )).pipe(
    Command.withDescription("Interactive credential setup")
  )

const logout = Command.make("logout", {}, () =>
  Effect.gen(function*() {
    const store = yield* CredentialStore
    const { dim, green } = yield* Style
    yield* printBanner
    const removed = yield* store.clear
    if (removed) {
      yield* Console.log(`\n${green("✔")} removed ${store.configPath}`)
      yield* Console.log(dim("Environment variables and .env files are untouched."))
    } else {
      yield* Console.log(`\nNo saved credentials (${store.configPath} does not exist).`)
    }
  }).pipe(withStyleFlag)).pipe(
    Command.withDescription("Delete credentials saved by `cfdomains setup`")
  )

const missingCredentials = new CliError.UserError({
  cause: "missing credentials",
  userMessage: "No Cloudflare credentials found.\n" +
    "Set CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID (env or .env), " +
    "or run `cfdomains setup` in a terminal once."
})

const resolveCredentials = Effect.fn(function*(
  flagToken: Option.Option<Redacted.Redacted>,
  flagAccountId: Option.Option<string>
) {
  const store = yield* CredentialStore
  const stored = yield* store.load
  const merged = Option.all({
    token: Option.orElse(flagToken, () => Option.map(stored, (c) => c.token)),
    accountId: Option.orElse(flagAccountId, () => Option.map(stored, (c) => c.accountId))
  })
  if (Option.isSome(merged)) {
    return merged.value satisfies Credentials
  }
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    return yield* missingCredentials
  }
  yield* Console.log("No Cloudflare credentials found — starting one-time setup.")
  const credentials = yield* wizard
  yield* Console.log("")
  return credentials
})

const resolveTlds = Effect.fn(function*(
  filter: Option.Option<ReadonlyArray<string>>,
  live: boolean
) {
  const known = live
    ? Arr.union(Tlds.tlds, yield* Tlds.fetchLive).toSorted()
    : Tlds.tlds
  if (Option.isNone(filter)) return known
  const requested = filter.value
  const unknown = requested.filter((tld) => !known.includes(tld))
  if (unknown.length > 0) {
    const { yellow } = yield* Style
    yield* Console.error(yellow(`warning: not in known TLD list: ${unknown.join(", ")}`))
  }
  return requested
})

const sweep = Effect.fn(function*(
  credentials: Credentials,
  targets: ReadonlyArray<string>,
  showProgress: boolean
) {
  const cloudflare = yield* Cloudflare
  const done = yield* Ref.make(0)

  const outcomes = yield* Effect.forEach(
    Arr.chunksOf(targets, BATCH_SIZE),
    (batch) =>
      cloudflare.checkDomains(credentials, batch).pipe(
        Effect.result,
        Effect.map((result) => ({ batch, result })),
        Effect.tap(() =>
          showProgress
            ? Ref.updateAndGet(done, (count) => count + batch.length).pipe(
              Effect.flatMap((count) =>
                // Progress goes to stderr so piped stdout stays clean.
                Effect.sync(() => process.stderr.write(`\r  ${progressBar(count, targets.length)}`))
              )
            )
            : Effect.void
        )
      ),
    { concurrency: CONCURRENCY }
  )
  if (showProgress) process.stderr.write("\r\x1b[2K")

  const results: Array<CheckedDomain> = []
  const failures: Array<BatchFailure> = []
  for (const { batch, result } of outcomes) {
    if (Result.isSuccess(result)) results.push(...result.success)
    else failures.push({ domains: batch, message: result.failure.detail })
  }
  return { results, failures }
})

const check = Effect.fn(function*(input: {
  readonly name: string
  readonly available: boolean
  readonly json: boolean
  readonly links: boolean
  readonly tlds: Option.Option<ReadonlyArray<string>>
  readonly liveTlds: boolean
  readonly token: Option.Option<Redacted.Redacted>
  readonly accountId: Option.Option<string>
}) {
  const query = input.name.toLowerCase().replace(/\.$/, "")
  if (!input.json) yield* printBanner
  const credentials = yield* resolveCredentials(input.token, input.accountId)
  const tlds = yield* resolveTlds(input.tlds, input.liveTlds)

  const targets = query.includes(".") ? [query] : tlds.map((tld) => `${query}.${tld}`)
  const showProgress = process.stderr.isTTY === true && !input.json
  const { results, failures } = yield* sweep(credentials, targets, showProgress)

  if (input.json) {
    const selected = (input.available ? results.filter((d) => d.registrable) : results)
      .toSorted((a, b) => a.name.localeCompare(b.name))
    const payload = selected.map((d) =>
      d.registrable
        ? { ...d, purchase_url: purchaseUrl(credentials.accountId, d.name) }
        : d
    )
    yield* Console.log(JSON.stringify(payload, null, 2))
    if (failures.length > 0) {
      yield* Console.error(JSON.stringify({ errors: failures }, null, 2))
    }
  } else {
    const style = yield* Style
    yield* Console.log(render(results, failures, {
      name: query,
      availableOnly: input.available,
      accountId: credentials.accountId,
      links: input.links
    }, style))
  }
  if (failures.length > 0) {
    return yield* new QuietFailure()
  }
})

export const cfdomains = Command.make("cfdomains", { name, ...flags }, (input) =>
  check(input).pipe(Effect.catchTag("QuitError", onQuitAbort), withStyleFlag)).pipe(
    Command.withDescription(
      "Check a name's availability and price across every Cloudflare Registrar TLD"
    ),
    Command.withSubcommands([setup, logout]),
    Command.withGlobalFlags([NoColor]),
    Command.withExamples([
      { command: "cfdomains myname", description: "Check myname.<tld> for every known TLD" },
      { command: "cfdomains myname --available", description: "Only show available domains" },
      { command: "cfdomains myname --tlds com,dev,io", description: "Restrict to specific TLDs" },
      { command: "cfdomains myname --links", description: "Show purchase links per domain" },
      { command: "cfdomains myname.dev", description: "Check a single exact domain" },
      { command: "cfdomains setup", description: "Interactive credential setup" }
    ])
  )
