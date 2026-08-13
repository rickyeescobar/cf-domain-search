import { describe, it } from "@effect/vitest"
import { assertNone, assertTrue, strictEqual } from "@effect/vitest/utils"
import { ConfigProvider, Effect, FileSystem, Layer, Option, Path, Redacted } from "effect"
import { CredentialStore } from "../src/Credentials.ts"

/**
 * CredentialStore over a fake filesystem (unimplemented methods fail typed,
 * which the store treats as "no stored config") and an explicit config
 * provider standing in for the process environment.
 */
const storeLayer = (fs: Partial<FileSystem.FileSystem>) =>
  CredentialStore.layer.pipe(
    Layer.provide(Layer.succeed(FileSystem.FileSystem)(FileSystem.makeNoop(fs))),
    Layer.provide(Path.layer)
  )

const environment = (values: Record<string, string>) =>
  ConfigProvider.layer(ConfigProvider.fromUnknown(values))

const load = Effect.gen(function*() {
  const store = yield* CredentialStore
  return yield* store.load
})

const storedJson = JSON.stringify({ api_token: "stored-token", account_id: "stored-account" })

describe("load", () => {
  it.effect("environment variables win", () =>
    Effect.gen(function*() {
      const result = yield* load.pipe(Effect.provide(Layer.mergeAll(
        storeLayer({ readFileString: () => Effect.succeed(storedJson) }),
        environment({ CLOUDFLARE_API_TOKEN: "env-token", CLOUDFLARE_ACCOUNT_ID: "env-account" })
      )))
      const credentials = Option.getOrThrow(result)
      strictEqual(Redacted.value(credentials.token), "env-token")
      strictEqual(credentials.accountId, "env-account")
    }))

  it.effect("falls back to the saved config file", () =>
    Effect.gen(function*() {
      const result = yield* load.pipe(Effect.provide(Layer.mergeAll(
        storeLayer({ readFileString: () => Effect.succeed(storedJson) }),
        environment({})
      )))
      const credentials = Option.getOrThrow(result)
      strictEqual(Redacted.value(credentials.token), "stored-token")
      strictEqual(credentials.accountId, "stored-account")
    }))

  it.effect("merges per field: env token with stored account id", () =>
    Effect.gen(function*() {
      const result = yield* load.pipe(Effect.provide(Layer.mergeAll(
        storeLayer({ readFileString: () => Effect.succeed(JSON.stringify({ account_id: "stored-account" })) }),
        environment({ CLOUDFLARE_API_TOKEN: "env-token" })
      )))
      const credentials = Option.getOrThrow(result)
      strictEqual(Redacted.value(credentials.token), "env-token")
      strictEqual(credentials.accountId, "stored-account")
    }))

  it.effect("none when no source provides both values", () =>
    Effect.gen(function*() {
      const result = yield* load.pipe(Effect.provide(Layer.mergeAll(
        storeLayer({}),
        environment({ CLOUDFLARE_ACCOUNT_ID: "env-account" })
      )))
      assertNone(result)
    }))

  it.effect("ignores an unreadable config file", () =>
    Effect.gen(function*() {
      const result = yield* load.pipe(Effect.provide(Layer.mergeAll(
        storeLayer({ readFileString: () => Effect.succeed("not json at all") }),
        environment({})
      )))
      assertNone(result)
    }))
})

describe("clear", () => {
  const clear = Effect.gen(function*() {
    const store = yield* CredentialStore
    return yield* store.clear
  })

  it.effect("removes the config file when it exists", () =>
    Effect.gen(function*() {
      const removed: Array<string> = []
      const result = yield* clear.pipe(Effect.provide(storeLayer({
        exists: () => Effect.succeed(true),
        remove: (path) => Effect.sync(() => void removed.push(path))
      })))
      strictEqual(result, true)
      strictEqual(removed.length, 1)
      assertTrue(removed[0]?.endsWith("config.json"))
    }))

  it.effect("reports when there was nothing to remove", () =>
    Effect.gen(function*() {
      const result = yield* clear.pipe(Effect.provide(storeLayer({
        exists: () => Effect.succeed(false)
      })))
      strictEqual(result, false)
    }))
})
