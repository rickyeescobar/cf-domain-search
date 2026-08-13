import { describe, it } from "@effect/vitest"
import { assertFalse, assertTrue, deepStrictEqual, strictEqual } from "@effect/vitest/utils"
import { Effect, Layer } from "effect"
import { TestConsole } from "effect/testing"
import { HttpClient, HttpClientResponse } from "effect/unstable/http"
import { plain, Style } from "../src/Style.ts"
import * as Tlds from "../src/Tlds.ts"

const clientLayer = (body: () => Response) =>
  Layer.succeed(HttpClient.HttpClient)(
    HttpClient.make((request) => Effect.sync(() => HttpClientResponse.fromWeb(request, body())))
  )

describe("tlds", () => {
  it("has no duplicates", () => {
    strictEqual(new Set(Tlds.tlds).size, Tlds.tlds.length)
  })

  it("is normalized: lowercase, trimmed, no leading dot", () => {
    for (const tld of Tlds.tlds) {
      strictEqual(tld, tld.trim().toLowerCase())
      assertFalse(tld.startsWith("."))
    }
  })
})

describe("fetchLive", () => {
  it.effect("returns the feed's keys", () =>
    Effect.gen(function*() {
      const body = new Response(JSON.stringify({ com: {}, dev: {} }), {
        status: 200,
        headers: { "content-type": "application/json" }
      })
      const result = yield* Tlds.fetchLive.pipe(Effect.provide(clientLayer(() => body)))
      deepStrictEqual(result, ["com", "dev"])
    }))

  it.effect("warns and falls back to [] when the feed is unusable", () =>
    Effect.gen(function*() {
      const result = yield* Tlds.fetchLive.pipe(
        Effect.provideService(Style, plain),
        Effect.provide(clientLayer(() => new Response("oops", { status: 200 })))
      )
      deepStrictEqual(result, [])
      const errors = yield* TestConsole.errorLines
      strictEqual(errors.length, 1)
      assertTrue(String(errors[0]).startsWith("warning: could not fetch live TLD list"))
    }))
})
