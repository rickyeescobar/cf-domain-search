import { describe, it } from "@effect/vitest"
import { assertTrue, deepStrictEqual, strictEqual } from "@effect/vitest/utils"
import { Effect, Fiber, Layer, Redacted } from "effect"
import { TestClock } from "effect/testing"
import { HttpClient, HttpClientResponse } from "effect/unstable/http"
import { Cloudflare } from "../src/Cloudflare.ts"

/** A Cloudflare layer whose HTTP client answers every request with `body()`. */
const respondingWith = (body: () => Response) =>
  Cloudflare.layer.pipe(
    Layer.provide(
      Layer.succeed(HttpClient.HttpClient)(
        HttpClient.make((request) =>
          Effect.sync(() => HttpClientResponse.fromWeb(request, body()))
        )
      )
    )
  )

const json = (body: unknown) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" }
  })

const credentials = { token: Redacted.make("token"), accountId: "acct" }

const checkDomains = Effect.gen(function*() {
  const cloudflare = yield* Cloudflare
  return yield* cloudflare.checkDomains(credentials, ["acme.day"])
})

describe("checkDomains", () => {
  it.effect("decodes the bare-array response shape", () =>
    Effect.gen(function*() {
      const body = json({ success: true, result: [{ name: "acme.day", registrable: true }] })
      const result = yield* checkDomains.pipe(Effect.provide(respondingWith(() => body)))
      deepStrictEqual(result.map((domain) => domain.name), ["acme.day"])
    }))

  it.effect("decodes the wrapped { domains } response shape", () =>
    Effect.gen(function*() {
      const body = json({ success: true, result: { domains: [{ name: "acme.day", registrable: false }] } })
      const result = yield* checkDomains.pipe(Effect.provide(respondingWith(() => body)))
      deepStrictEqual(result.map((domain) => domain.registrable), [false])
    }))

  it.effect("surfaces API error messages as CloudflareError", () =>
    Effect.gen(function*() {
      const body = json({ success: false, errors: [{ code: 10000, message: "Authentication error" }] })
      const error = yield* checkDomains.pipe(Effect.flip, Effect.provide(respondingWith(() => body)))
      strictEqual(error._tag, "CloudflareError")
      strictEqual(error.detail, "10000: Authentication error")
    }))

  it.effect("includes the HTTP status when the body does not decode", () =>
    Effect.gen(function*() {
      const error = yield* checkDomains.pipe(
        Effect.flip,
        Effect.provide(respondingWith(() => new Response("rate limited", { status: 200 })))
      )
      assertTrue(error.detail.startsWith("HTTP 200:"))
    }))

  it.effect("retries transient statuses with exponential backoff", () =>
    Effect.gen(function*() {
      let calls = 0
      const flaky = respondingWith(() => {
        calls = calls + 1
        return calls <= 2
          ? new Response("slow down", { status: 429 })
          : json({ success: true, result: [{ name: "acme.day", registrable: true }] })
      })
      const fiber = yield* checkDomains.pipe(Effect.provide(flaky), Effect.forkChild)
      yield* TestClock.adjust("2 seconds")
      yield* TestClock.adjust("4 seconds")
      const result = yield* Fiber.join(fiber)
      strictEqual(calls, 3)
      deepStrictEqual(result.map((domain) => domain.name), ["acme.day"])
    }))
})

describe("verifyToken", () => {
  const verify = Effect.gen(function*() {
    const cloudflare = yield* Cloudflare
    return yield* cloudflare.verifyToken(Redacted.make("token"))
  })

  it.effect("true when the API confirms the token", () =>
    Effect.gen(function*() {
      const result = yield* verify.pipe(Effect.provide(respondingWith(() => json({ success: true }))))
      strictEqual(result, true)
    }))

  it.effect("false when the response is garbage", () =>
    Effect.gen(function*() {
      const result = yield* verify.pipe(
        Effect.provide(respondingWith(() => new Response("nope", { status: 200 })))
      )
      strictEqual(result, false)
    }))
})

describe("listAccounts", () => {
  const list = Effect.gen(function*() {
    const cloudflare = yield* Cloudflare
    return yield* cloudflare.listAccounts(Redacted.make("token"))
  })

  it.effect("returns accounts on success", () =>
    Effect.gen(function*() {
      const body = json({ success: true, result: [{ id: "abc", name: "Main" }] })
      const result = yield* list.pipe(Effect.provide(respondingWith(() => body)))
      deepStrictEqual(result.map((account) => account.name), ["Main"])
    }))

  it.effect("returns [] when the token cannot list accounts", () =>
    Effect.gen(function*() {
      const body = json({ success: false, errors: [] })
      const result = yield* list.pipe(Effect.provide(respondingWith(() => body)))
      deepStrictEqual(result, [])
    }))
})
