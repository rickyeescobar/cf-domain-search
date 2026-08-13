/**
 * Terminal styling as a service.
 *
 * `Style` is a `Context.Reference`: consumers `yield* Style` and get the
 * default — ANSI colors when stdout is a TTY and `NO_COLOR` is unset,
 * plain text otherwise — unless a layer overrides it (e.g.
 * `Layer.succeed(Style)(plain)` in tests or CI).
 */
import { Context } from "effect"

export interface Style {
  readonly green: (text: string) => string
  readonly red: (text: string) => string
  readonly yellow: (text: string) => string
  readonly dim: (text: string) => string
  readonly bold: (text: string) => string
}

const paint = (code: string) => (text: string): string => `\x1b[${code}m${text}\x1b[0m`
const identity = (text: string): string => text

export const colored: Style = {
  green: paint("32"),
  red: paint("31"),
  yellow: paint("33"),
  dim: paint("2"),
  bold: paint("1")
}

export const plain: Style = {
  green: identity,
  red: identity,
  yellow: identity,
  dim: identity,
  bold: identity
}

export const Style = Context.Reference<Style>("cfdom/Style", {
  defaultValue: () =>
    process.stdout.isTTY === true && process.env.NO_COLOR === undefined ? colored : plain
})
