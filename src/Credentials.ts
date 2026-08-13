/**
 * Credential resolution and storage.
 *
 * This store resolves, in priority order:
 *
 *   1. `CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID` environment variables
 *   2. a `.env` file in the working directory (never overrides real env vars)
 *   3. the config saved by `cfdomains setup` (`~/.config/cf-domain-search/config.json`)
 *
 * The `--token` / `--account-id` flags (see Cli.ts) take precedence over all
 * of these, and the interactive wizard is the last resort.
 */
import { Config, Context, Effect, FileSystem, Layer, Option, Path, Redacted, Schema } from "effect"
import type { PlatformError } from "effect/PlatformError"
import { homedir } from "node:os"

export interface Credentials {
  readonly token: Redacted.Redacted
  readonly accountId: string
}

const StoredConfig = Schema.Struct({
  api_token: Schema.optionalKey(Schema.String),
  account_id: Schema.optionalKey(Schema.String)
})

const decodeStoredConfig = Schema.decodeUnknownEffect(Schema.fromJsonString(StoredConfig))

/** Parse `.env` lines of the form `KEY=value`, tolerating quotes and whitespace. */
const parseDotEnv = (text: string): ReadonlyMap<string, string> => {
  const values = new Map<string, string>()
  for (const line of text.split("\n")) {
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/)
    if (match === null) continue
    const [, key, raw] = match
    if (key === undefined || raw === undefined) continue
    values.set(key, raw.trim().replace(/^(["'])(.*)\1$/, "$2"))
  }
  return values
}

export class CredentialStore extends Context.Service<CredentialStore, {
  /** Credentials from the highest-priority source that provides them. */
  readonly load: Effect.Effect<Option.Option<Credentials>>
  /** Persist credentials to the config file (mode 600). */
  save(credentials: Credentials): Effect.Effect<void, PlatformError>
  /** Where `save` writes. */
  readonly configPath: string
}>()("cfdomains/CredentialStore") {
  static readonly layer = Layer.effect(
    CredentialStore,
    Effect.gen(function*() {
      const fs = yield* FileSystem.FileSystem
      const path = yield* Path.Path

      const configDir = path.join(
        process.env.XDG_CONFIG_HOME ?? path.join(homedir(), ".config"),
        "cf-domain-search"
      )
      const configPath = path.join(configDir, "config.json")

      const readIfExists = (file: string) =>
        fs.readFileString(file).pipe(Effect.orElseSucceed(() => undefined))

      const load = Effect.gen(function*() {
        const env = {
          token: yield* Config.option(Config.redacted("CLOUDFLARE_API_TOKEN")),
          accountId: yield* Config.option(Config.string("CLOUDFLARE_ACCOUNT_ID"))
        }

        const dotEnvText = yield* readIfExists(".env")
        const dotEnv = dotEnvText === undefined ? new Map<string, string>() : parseDotEnv(dotEnvText)

        const storedText = yield* readIfExists(configPath)
        const stored: typeof StoredConfig.Type = storedText === undefined
          ? {}
          : yield* decodeStoredConfig(storedText).pipe(
            Effect.orElseSucceed((): typeof StoredConfig.Type => ({}))
          )

        const fallbackToken = dotEnv.get("CLOUDFLARE_API_TOKEN") ?? stored.api_token
        const token = Option.getOrUndefined(env.token)
          ?? (fallbackToken !== undefined ? Redacted.make(fallbackToken) : undefined)
        const accountId = Option.getOrUndefined(env.accountId)
          ?? dotEnv.get("CLOUDFLARE_ACCOUNT_ID")
          ?? stored.account_id

        return token !== undefined && accountId !== undefined
          ? Option.some<Credentials>({ token, accountId })
          : Option.none<Credentials>()
      }).pipe(Effect.orDie)

      const save = (credentials: Credentials) =>
        Effect.gen(function*() {
          yield* fs.makeDirectory(configDir, { recursive: true })
          const content = JSON.stringify(
            { api_token: Redacted.value(credentials.token), account_id: credentials.accountId },
            null,
            2
          )
          yield* fs.writeFileString(configPath, content + "\n")
          yield* fs.chmod(configPath, 0o600)
        })

      return CredentialStore.of({ load, save, configPath })
    })
  )
}
