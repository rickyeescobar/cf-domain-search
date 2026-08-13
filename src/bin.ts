/**
 * Entrypoint: wires the command to the Node platform.
 *
 * `NodeServices.layer` provides FileSystem, Path, Terminal, and Stdio;
 * `FetchHttpClient.layer` provides the HttpClient on Node's global fetch,
 * keeping the published bundle dependency-free.
 */
import { NodeRuntime, NodeServices } from "@effect/platform-node"
import { Effect, Layer } from "effect"
import { Command } from "effect/unstable/cli"
import { FetchHttpClient } from "effect/unstable/http"
import { cfdom } from "./Cli.ts"
import { Cloudflare } from "./Cloudflare.ts"
import { CredentialStore } from "./Credentials.ts"

const MainLayer = Layer.provideMerge(
  Layer.mergeAll(Cloudflare.layer, CredentialStore.layer),
  Layer.mergeAll(NodeServices.layer, FetchHttpClient.layer)
)

cfdom.pipe(
  Command.run({ version: "0.2.0" }),
  Effect.provide(MainLayer),
  NodeRuntime.runMain
)
