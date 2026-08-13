import { describe, expect, test } from "bun:test"
import { Effect, Layer, Redacted } from "effect"
import { HttpClient, HttpClientResponse } from "effect/unstable/http"
import { Cloudflare } from "../src/Cloudflare.ts"

/** A Cloudflare layer whose HTTP client answers every request with `body`. */
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
  test("decodes the bare-array response shape", async () => {
    const body = json({ success: true, result: [{ name: "acme.day", registrable: true }] })
    const result = await Effect.runPromise(
      checkDomains.pipe(Effect.provide(respondingWith(() => body)))
    )
    expect(result).toHaveLength(1)
    expect(result.map((domain) => domain.name)).toEqual(["acme.day"])
  })

  test("decodes the wrapped { domains } response shape", async () => {
    const body = json({ success: true, result: { domains: [{ name: "acme.day", registrable: false }] } })
    const result = await Effect.runPromise(
      checkDomains.pipe(Effect.provide(respondingWith(() => body)))
    )
    expect(result.map((domain) => domain.registrable)).toEqual([false])
  })

  test("surfaces API error messages as CloudflareError", async () => {
    const body = json({ success: false, errors: [{ code: 10000, message: "Authentication error" }] })
    const error = await Effect.runPromise(
      checkDomains.pipe(Effect.flip, Effect.provide(respondingWith(() => body)))
    )
    expect(error._tag).toBe("CloudflareError")
    expect(error.detail).toBe("10000: Authentication error")
  })

  test("includes the HTTP status when the body does not decode", async () => {
    const body = new Response("rate limited", { status: 200 })
    const error = await Effect.runPromise(
      checkDomains.pipe(Effect.flip, Effect.provide(respondingWith(() => body)))
    )
    expect(error.detail).toStartWith("HTTP 200:")
  })
})

describe("verifyToken", () => {
  const verify = Effect.gen(function*() {
    const cloudflare = yield* Cloudflare
    return yield* cloudflare.verifyToken(Redacted.make("token"))
  })

  test("true when the API confirms the token", async () => {
    const result = await Effect.runPromise(
      verify.pipe(Effect.provide(respondingWith(() => json({ success: true }))))
    )
    expect(result).toBe(true)
  })

  test("false when the response is garbage", async () => {
    const result = await Effect.runPromise(
      verify.pipe(Effect.provide(respondingWith(() => new Response("nope", { status: 200 }))))
    )
    expect(result).toBe(false)
  })
})

describe("listAccounts", () => {
  const list = Effect.gen(function*() {
    const cloudflare = yield* Cloudflare
    return yield* cloudflare.listAccounts(Redacted.make("token"))
  })

  test("returns accounts on success", async () => {
    const body = json({ success: true, result: [{ id: "abc", name: "Main" }] })
    const result = await Effect.runPromise(list.pipe(Effect.provide(respondingWith(() => body))))
    expect(result.map((account) => account.name)).toEqual(["Main"])
  })

  test("returns [] when the token cannot list accounts", async () => {
    const body = json({ success: false, errors: [] })
    const result = await Effect.runPromise(list.pipe(Effect.provide(respondingWith(() => body))))
    expect(result).toEqual([])
  })
})
