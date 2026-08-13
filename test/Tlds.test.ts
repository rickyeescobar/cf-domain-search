import { describe, expect, test } from "bun:test"
import { Effect, Layer } from "effect"
import { HttpClient, HttpClientResponse } from "effect/unstable/http"
import { plain, Style } from "../src/Style.ts"
import * as Tlds from "../src/Tlds.ts"

const clientLayer = (body: () => Response) =>
  Layer.succeed(HttpClient.HttpClient)(
    HttpClient.make((request) => Effect.sync(() => HttpClientResponse.fromWeb(request, body())))
  )

describe("tlds", () => {
  test("has no duplicates", () => {
    expect(new Set(Tlds.tlds).size).toBe(Tlds.tlds.length)
  })

  test("is normalized: lowercase, trimmed, no leading dot", () => {
    for (const tld of Tlds.tlds) {
      expect(tld).toBe(tld.trim().toLowerCase())
      expect(tld.startsWith(".")).toBe(false)
    }
  })
})

describe("fetchLive", () => {
  test("returns the feed's keys", async () => {
    const body = new Response(JSON.stringify({ com: {}, dev: {} }), {
      status: 200,
      headers: { "content-type": "application/json" }
    })
    const result = await Effect.runPromise(
      Tlds.fetchLive.pipe(Effect.provide(clientLayer(() => body)))
    )
    expect(result).toEqual(["com", "dev"])
  })

  test("warns and falls back to [] when the feed is unusable", async () => {
    const result = await Effect.runPromise(
      Tlds.fetchLive.pipe(
        Effect.provideService(Style, plain),
        Effect.provide(clientLayer(() => new Response("oops", { status: 200 })))
      )
    )
    expect(result).toEqual([])
  })
})
