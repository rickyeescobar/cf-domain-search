/**
 * Credential resolution and storage.
 *
 * This store resolves, in priority order:
 *
 *   1. `CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID` via Config — real
 *      environment variables first, then a `.env` in the working directory
 *      (the ConfigProvider layer in bin.ts adds the `.env` fallback)
 *   2. the config saved by `cf-domain-search setup` (`~/.config/cf-domain-search/config.json`)
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

export class CredentialStore extends Context.Service<CredentialStore, {
  /** Credentials from the highest-priority source that provides them. */
  readonly load: Effect.Effect<Option.Option<Credentials>>
  /** Persist credentials to the config file (mode 600). */
  save(credentials: Credentials): Effect.Effect<void, PlatformError>
  /** Delete the config file; false when there was none. */
  readonly clear: Effect.Effect<boolean, PlatformError>
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

      const readStored = fs.readFileString(configPath).pipe(
        Effect.flatMap(decodeStoredConfig),
        Effect.orElseSucceed((): typeof StoredConfig.Type => ({}))
      )

      const load = Effect.gen(function*() {
        const env = {
          token: yield* Config.option(Config.redacted("CLOUDFLARE_API_TOKEN")),
          accountId: yield* Config.option(Config.string("CLOUDFLARE_ACCOUNT_ID"))
        }
        const stored = yield* readStored

        return Option.all({
          token: Option.orElse(env.token, () =>
            Option.map(Option.fromUndefinedOr(stored.api_token), Redacted.make)),
          accountId: Option.orElse(env.accountId, () => Option.fromUndefinedOr(stored.account_id))
        })
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

      const clear = Effect.gen(function*() {
        const exists = yield* fs.exists(configPath)
        if (exists) yield* fs.remove(configPath)
        return exists
      })

      return CredentialStore.of({ load, save, clear, configPath })
    })
  )
}
