/**
 * A thin client for the Cloudflare v4 API: token verification, account
 * listing, and the Registrar domain-check endpoint.
 *
 * Transient failures (408/429/5xx and transport errors) are retried with
 * exponential backoff; everything else surfaces as a `CloudflareError`
 * carrying the API's own error detail.
 */
import { Context, Effect, Layer, Redacted, Schedule, Schema, SchemaTransformation } from "effect"
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/unstable/http"
import type { Credentials } from "./Credentials.ts"

const API_URL = "https://api.cloudflare.com/client/v4"

/** Cloudflare returns money as strings; be liberal and accept numbers too. */
const Money = Schema.Union([Schema.String, Schema.Finite])

export class Pricing extends Schema.Class<Pricing>("cfdomains/Pricing")({
  currency: Schema.optionalKey(Schema.String),
  registration_cost: Schema.optionalKey(Money),
  renewal_cost: Schema.optionalKey(Money)
}) {}

export class CheckedDomain extends Schema.Class<CheckedDomain>("cfdomains/CheckedDomain")({
  name: Schema.String,
  registrable: Schema.Boolean,
  tier: Schema.optionalKey(Schema.String),
  reason: Schema.optionalKey(Schema.String),
  pricing: Schema.optionalKey(Pricing)
}) {}

export class Account extends Schema.Class<Account>("cfdomains/Account")({
  id: Schema.String,
  name: Schema.String
}) {}

const ApiMessage = Schema.Struct({
  code: Schema.optionalKey(Schema.Finite),
  message: Schema.optionalKey(Schema.String)
})

/** Every Cloudflare response shares this envelope around a `result`. */
const Envelope = <Result extends Schema.Top>(result: Result) =>
  Schema.Struct({
    success: Schema.Boolean,
    errors: Schema.optionalKey(Schema.NullOr(Schema.Array(ApiMessage))),
    result: Schema.optionalKey(Schema.NullOr(result))
  })

const VerifyEnvelope = Envelope(Schema.Unknown)
const AccountsEnvelope = Envelope(Schema.Array(Account))

// The beta API has returned both `{ domains: [...] }` and a bare array here;
// normalize to the bare array at decode time.
const CheckResult = Schema.Union([
  Schema.Array(CheckedDomain),
  Schema.Struct({ domains: Schema.Array(CheckedDomain) })
]).pipe(
  Schema.decodeTo(
    Schema.Array(CheckedDomain),
    SchemaTransformation.transform({
      decode: (input) => ("domains" in input ? input.domains : input),
      encode: (domains) => domains
    })
  )
)
const CheckEnvelope = Envelope(CheckResult)

export class CloudflareError extends Schema.TaggedError<CloudflareError>()("CloudflareError", {
  detail: Schema.String
}) {}

const describe = (error: { readonly message: string }): string => error.message

const describeApiErrors = (
  status: number,
  errors: ReadonlyArray<typeof ApiMessage.Type> | null | undefined
): string => {
  const detail = errors?.map((e) => `${e.code ?? "?"}: ${e.message ?? "unknown"}`).join("; ")
  return detail !== undefined && detail !== "" ? detail : `HTTP ${status}`
}

export class Cloudflare extends Context.Service<Cloudflare, {
  /** Is this token valid and active? */
  verifyToken(token: Redacted.Redacted): Effect.Effect<boolean>
  /** Accounts visible to the token (empty when the token cannot list them). */
  listAccounts(token: Redacted.Redacted): Effect.Effect<ReadonlyArray<Account>>
  /** Registrar availability check — at most 20 domains per call. */
  checkDomains(
    credentials: Credentials,
    domains: ReadonlyArray<string>
  ): Effect.Effect<ReadonlyArray<CheckedDomain>, CloudflareError>
}>()("cfdomains/Cloudflare") {
  static readonly layer = Layer.effect(
    Cloudflare,
    Effect.gen(function*() {
      const client = (yield* HttpClient.HttpClient).pipe(
        HttpClient.mapRequest(HttpClientRequest.prependUrl(API_URL)),
        // The Registrar API rate-limits aggressively on consecutive full
        // sweeps; back off patiently (2s, 4s, 8s, 16s) before giving up.
        HttpClient.retryTransient({
          schedule: Schedule.exponential("2 seconds"),
          times: 4
        })
      )

      const verifyToken = (token: Redacted.Redacted) =>
        HttpClientRequest.get("/user/tokens/verify").pipe(
          HttpClientRequest.bearerToken(Redacted.value(token)),
          client.execute,
          Effect.flatMap(HttpClientResponse.schemaBodyJson(VerifyEnvelope)),
          Effect.map((body) => body.success),
          Effect.orElseSucceed(() => false)
        )

      const listAccounts = (token: Redacted.Redacted) =>
        HttpClientRequest.get("/accounts").pipe(
          HttpClientRequest.bearerToken(Redacted.value(token)),
          client.execute,
          Effect.flatMap(HttpClientResponse.schemaBodyJson(AccountsEnvelope)),
          Effect.map((body) => (body.success ? body.result ?? [] : [])),
          Effect.orElseSucceed((): ReadonlyArray<Account> => [])
        )

      const checkDomains = (credentials: Credentials, domains: ReadonlyArray<string>) =>
        HttpClientRequest.post(`/accounts/${credentials.accountId}/registrar/domain-check`).pipe(
          HttpClientRequest.bearerToken(Redacted.value(credentials.token)),
          HttpClientRequest.bodyJsonUnsafe({ domains }),
          client.execute,
          Effect.mapError((error) => new CloudflareError({ detail: describe(error) })),
          Effect.flatMap((response) =>
            HttpClientResponse.schemaBodyJson(CheckEnvelope)(response).pipe(
              Effect.mapError((error) =>
                new CloudflareError({ detail: `HTTP ${response.status}: ${describe(error)}` })
              ),
              Effect.flatMap((body) => {
                if (!body.success) {
                  return Effect.fail(
                    new CloudflareError({ detail: describeApiErrors(response.status, body.errors) })
                  )
                }
                return Effect.succeed(body.result ?? [])
              })
            )
          )
        )

      return Cloudflare.of({ verifyToken, listAccounts, checkDomains })
    })
  )
}
