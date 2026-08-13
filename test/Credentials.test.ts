import { describe, expect, test } from "bun:test"
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
  test("environment variables win", async () => {
    const result = await Effect.runPromise(load.pipe(Effect.provide(Layer.mergeAll(
      storeLayer({ readFileString: () => Effect.succeed(storedJson) }),
      environment({ CLOUDFLARE_API_TOKEN: "env-token", CLOUDFLARE_ACCOUNT_ID: "env-account" })
    ))))
    const credentials = Option.getOrThrow(result)
    expect(Redacted.value(credentials.token)).toBe("env-token")
    expect(credentials.accountId).toBe("env-account")
  })

  test("falls back to the saved config file", async () => {
    const result = await Effect.runPromise(load.pipe(Effect.provide(Layer.mergeAll(
      storeLayer({ readFileString: () => Effect.succeed(storedJson) }),
      environment({})
    ))))
    const credentials = Option.getOrThrow(result)
    expect(Redacted.value(credentials.token)).toBe("stored-token")
    expect(credentials.accountId).toBe("stored-account")
  })

  test("merges per field: env token with stored account id", async () => {
    const result = await Effect.runPromise(load.pipe(Effect.provide(Layer.mergeAll(
      storeLayer({ readFileString: () => Effect.succeed(JSON.stringify({ account_id: "stored-account" })) }),
      environment({ CLOUDFLARE_API_TOKEN: "env-token" })
    ))))
    const credentials = Option.getOrThrow(result)
    expect(Redacted.value(credentials.token)).toBe("env-token")
    expect(credentials.accountId).toBe("stored-account")
  })

  test("none when no source provides both values", async () => {
    const result = await Effect.runPromise(load.pipe(Effect.provide(Layer.mergeAll(
      storeLayer({}),
      environment({ CLOUDFLARE_ACCOUNT_ID: "env-account" })
    ))))
    expect(Option.isNone(result)).toBe(true)
  })

  test("ignores an unreadable config file", async () => {
    const result = await Effect.runPromise(load.pipe(Effect.provide(Layer.mergeAll(
      storeLayer({ readFileString: () => Effect.succeed("not json at all") }),
      environment({})
    ))))
    expect(Option.isNone(result)).toBe(true)
  })
})

describe("clear", () => {
  const clear = Effect.gen(function*() {
    const store = yield* CredentialStore
    return yield* store.clear
  })

  test("removes the config file when it exists", async () => {
    const removed: Array<string> = []
    const result = await Effect.runPromise(clear.pipe(Effect.provide(storeLayer({
      exists: () => Effect.succeed(true),
      remove: (path) => Effect.sync(() => void removed.push(path))
    }))))
    expect(result).toBe(true)
    expect(removed).toHaveLength(1)
    expect(removed.map((path) => path.endsWith("config.json"))).toEqual([true])
  })

  test("reports when there was nothing to remove", async () => {
    const result = await Effect.runPromise(clear.pipe(Effect.provide(storeLayer({
      exists: () => Effect.succeed(false)
    }))))
    expect(result).toBe(false)
  })
})
