# cf-domain-search

Check a name's availability and price across every Cloudflare Registrar TLD, using the
official [Registrar API](https://developers.cloudflare.com/registrar/registrar-api/) (beta,
April 2026). Availability is authoritative (live registry check) and prices are Cloudflare's
at-cost prices.

Written in [Effect v4](https://effect.website) with `effect/unstable/cli`, typechecked by
TypeScript 7 (tsgo) with the [Effect language service](https://github.com/Effect-TS/tsgo).

## Setup

Just run it — on first use with no credentials it starts an interactive walkthrough:
step-by-step token-creation instructions (with links), live verification of the pasted
token, account auto-discovery (or a guided manual step), a real Registrar API probe with
troubleshooting hints on 403, and saves everything to
`~/.config/cf-domain-search/config.json` (mode 600). Re-run anytime with `cfdom setup`.

Credentials are resolved in this order, so the wizard is only a fallback:

1. `--token` / `--account-id` flags
2. `CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID` environment variables
3. a `.env` file in the working directory
4. the saved config from `cfdom setup`

The token needs the **Account → Registrar Domains → Edit** permission (the beta API
requires write scope even for read-only checks); create it at
<https://dash.cloudflare.com/profile/api-tokens>. The account ID is the hex segment in
your dashboard URL: `https://dash.cloudflare.com/<account-id>`.

## Usage

```sh
npx cf-domain-search myname       # once published to npm (Node ≥ 20)
bun src/bin.ts myname             # from this directory; myname.<tld> across all 423 TLDs
bun src/bin.ts myname --available # only the available ones
bun src/bin.ts myname --tlds com,dev,io
bun src/bin.ts myname.dev         # exact single-domain check
bun src/bin.ts myname --json      # machine-readable
bun src/bin.ts myname --live-tlds # merge TLD list from cfdomainpricing.com
```

Output is grouped: available (sorted cheapest first, with registration + renewal price and a
premium-tier flag), taken, and TLDs the beta API doesn't support yet (those may still be
purchasable in the dashboard — the summary line prints the dashboard purchase URL).

The CLI runner also provides `--help`, `--version`, `--wizard` (guided flag entry), and
`--completions bash|zsh|fish|sh` for free. `--no-color` (or the `NO_COLOR` env var)
disables colored output, and `--token` / `--account-id` supply credentials inline.

## Architecture

```
src/
  bin.ts          entrypoint — wires the command to NodeServices + FetchHttpClient layers
  Cli.ts          command definition, flag parsing, and the check/sweep orchestration
  Cloudflare.ts   Cloudflare API service: schemas, envelope decoding, transient retry
  Credentials.ts  credential resolution (env → .env → config file) and storage service
  Setup.ts        interactive wizard built on effect/unstable/cli Prompt
  Report.ts       pure rendering: grouping, sorting, money formatting
  Tlds.ts         embedded TLD list + live feed fetch
  Style.ts        minimal ANSI styling (honors NO_COLOR / non-TTY)
```

Services follow the v4 `Context.Service` class pattern with static layers. The API client
retries 408/429/5xx with exponential backoff (`HttpClient.retryTransient`), checks 20
domains per request, and runs 5 requests concurrently (`Effect.forEach` with
`{ concurrency: 5 }`), so a full sweep takes a few seconds. Batch failures are collected
per batch (`Effect.result`), reported, and turn the exit code non-zero without aborting
the rest of the sweep.

## Development

```sh
bun install        # also applies the effect-tsgo patch (prepare script)
bun run check      # tsc 7 --noEmit with Effect diagnostics
bun run build      # bundle src/bin.ts → dist/cfdom.js (self-contained, no deps)
```

## Publishing

`prepack` runs the typecheck and build, shipping `dist/` with bins `cf-domain-search` +
`cfdom`:

```sh
npm login
npm publish
```

Verify locally first with `npm pack` and
`npx --yes --package=./cf-domain-search-0.2.0.tgz cf-domain-search myname`.

## Notes

- The TLD list is embedded (from <https://www.cloudflare.com/tld-policies/>, Aug 2026).
  `--live-tlds` unions in the list from <https://cfdomainpricing.com/prices.json> at runtime.
- Registration via API exists too (`POST /registrar/registrations`) but this tool
  deliberately only searches.
