/**
 * The interactive credential wizard: token creation instructions, live token
 * verification, account discovery, a real Registrar API probe with
 * troubleshooting hints, and saving to the config file.
 */
import { Array as Arr, Console, Effect, Option, Redacted, Result, Terminal } from "effect"
import { Prompt } from "effect/unstable/cli"
import { Cloudflare } from "./Cloudflare.ts"
import { CredentialStore, type Credentials } from "./Credentials.ts"
import { Style } from "./Style.ts"

const intro = ({ bold, dim, orange }: Style) => `
${orange("        ▄▄▄▄▄")}
${orange("    ▄▄█████████▄▄")}            ${bold("cfdomains")}
${orange("  ▄███████████████▄▄▄")}        ${dim("Cloudflare Registrar domain search")}
${orange(" ▟█████████████████████▙")}
${orange(" ▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀")}

${bold("Setup")}

Domain checks go through Cloudflare's Registrar API, which needs an API token
from your Cloudflare account:

  1. Open           ${bold("https://dash.cloudflare.com/profile/api-tokens")}
  2. Click          Create Token → Custom token (bottom of the page)
  3. Token name     anything, e.g. "cf-domain-search"
  4. Permissions    ${bold("Account · Registrar Domains · Edit")}
     ${dim("optionally add Account · Account Settings · Read so this setup")}
     ${dim("can find your account ID for you")}
  5. Account Resources   Include · your account
  6. Continue to summary → Create Token → copy the token

${dim("Create a fresh token rather than editing an old one — permissions added to")}
${dim("existing tokens may never take effect (endless 403s).")}
`

const registrarHints = (accountId: string, { bold }: Style) => `
  The token is valid but the Registrar API rejected it. Likely causes:
    · the permission row isn't exactly ${bold("Account · Registrar Domains · Edit")}
    · the Domain Registration Agreement hasn't been accepted — open
      https://dash.cloudflare.com/${accountId}/domains/registrations/purchase once
    · the account has no billing profile / payment method
  Fix it in the dashboard, then re-run: ${bold("cfdomains setup")}
`

const askToken = Effect.fn(function*(cloudflare: typeof Cloudflare.Service) {
  const { green, red } = yield* Style
  for (;;) {
    const token = yield* Prompt.password({ message: "Paste your API token" })
    if (Redacted.value(token).length === 0) {
      yield* Console.log("No token entered — setup cancelled.")
      return yield* new Terminal.QuitError()
    }
    if (yield* cloudflare.verifyToken(token)) {
      yield* Console.log(`  ${green("✔")} token is valid and active`)
      return token
    }
    yield* Console.log(
      `  ${red("✘")} Cloudflare rejected it — check the paste and try again (empty to abort).`
    )
  }
})

const askAccountId = Effect.fn(function*(
  cloudflare: typeof Cloudflare.Service,
  token: Redacted.Redacted
) {
  const { dim, green, yellow } = yield* Style
  const accounts = yield* cloudflare.listAccounts(token)
  const first = Arr.head(accounts)
  if (accounts.length === 1 && Option.isSome(first)) {
    const account = first.value
    yield* Console.log(`  ${green("✔")} using "${account.name}" ${dim(`(${account.id})`)}`)
    return account.id
  }
  if (accounts.length > 1) {
    return yield* Prompt.select({
      message: "Which account?",
      choices: accounts.map((account) => ({
        title: account.name,
        description: account.id,
        value: account.id
      }))
    })
  }
  yield* Console.log(`  ${yellow("no accounts visible to this token")}`)
  yield* Console.log("  Your account ID is the 32-character hex segment in your dashboard URL:")
  yield* Console.log(`  ${dim("https://dash.cloudflare.com/<account-id>")}`)
  const answer = yield* Prompt.text({
    message: "Account ID",
    validate: (value) =>
      /^[0-9a-f]{32}$/.test(value.trim().toLowerCase())
        ? Effect.succeed(value)
        : Effect.fail("expected 32 hex characters")
  })
  return answer.trim().toLowerCase()
})

/**
 * Runs the wizard and returns working credentials. Fails with
 * `Terminal.QuitError` when the user aborts.
 */
export const wizard: Effect.Effect<
  Credentials,
  Terminal.QuitError,
  Cloudflare | CredentialStore | Prompt.Environment
> = Effect.gen(function*() {
  const cloudflare = yield* Cloudflare
  const store = yield* CredentialStore
  const style = yield* Style

  yield* Console.log(intro(style))
  const token = yield* askToken(cloudflare)
  const accountId = yield* askAccountId(cloudflare, token)
  const credentials: Credentials = { token, accountId }

  yield* Console.log("  checking Registrar API access…")
  const probe = yield* Effect.result(cloudflare.checkDomains(credentials, ["example.com"]))
  if (Result.isSuccess(probe)) {
    yield* Console.log(`  ${style.green("✔")} Registrar API access works`)
  } else {
    yield* Console.log(`  ${style.red(`✘ refused (${probe.failure.detail})`)}`)
    yield* Console.log(registrarHints(accountId, style))
  }

  const save = yield* Prompt.confirm({
    message: `Save credentials to ${store.configPath}?`,
    initial: true
  })
  if (save) {
    yield* store.save(credentials).pipe(
      Effect.tap(() =>
        Console.log(style.dim("  saved (file mode 600) — re-run `cfdomains setup` to replace"))
      ),
      Effect.catch((error) =>
        Console.error(style.red(`  could not save credentials: ${error.message}`))
      )
    )
  }
  return credentials
})
