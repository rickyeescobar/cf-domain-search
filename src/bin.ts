/**
 * Entrypoint: wires the command to the Node platform.
 *
 * `NodeServices.layer` provides FileSystem, Path, Terminal, and Stdio;
 * `FetchHttpClient.layer` provides the HttpClient on Node's global fetch,
 * keeping the published bundle dependency-free.
 */
import { NodeRuntime, NodeServices } from "@effect/platform-node"
import { ConfigProvider, Effect, Layer } from "effect"
import { Command } from "effect/unstable/cli"
import { FetchHttpClient } from "effect/unstable/http"
import { cfDomainSearch } from "./Cli.ts"
import { Cloudflare } from "./Cloudflare.ts"
import { CredentialStore } from "./Credentials.ts"

// Let every Config read (including flag fallbacks) see a `.env` in the
// working directory, with real environment variables taking precedence.
const DotEnvLayer = ConfigProvider.layerAdd(
  ConfigProvider.fromDotEnv().pipe(
    Effect.orElseSucceed(() => ConfigProvider.fromDotEnvContents(""))
  )
)

const MainLayer = Layer.provideMerge(
  Layer.mergeAll(Cloudflare.layer, CredentialStore.layer, DotEnvLayer),
  Layer.mergeAll(NodeServices.layer, FetchHttpClient.layer)
)

cfDomainSearch.pipe(
  Command.run({ version: "0.2.1" }),
  Effect.provide(MainLayer),
  NodeRuntime.runMain
)
