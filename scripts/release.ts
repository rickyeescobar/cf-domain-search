/**
 * One-command release: bump → verify → npm publish (interactive OTP) →
 * git tag → GitHub release.
 *
 *   bun run release              # patch bump
 *   bun run release minor        # or major
 *   bun run release --dry-run    # show what would happen, change nothing
 *
 * Safe to re-run after a failure at any step (a wrong OTP, a network blip):
 * when package.json is already ahead of npm, that version is resumed instead
 * of bumping again, and completed steps (commit, tag, release) are skipped.
 */
import { $ } from "bun"

const args = Bun.argv.slice(2)
const dryRun = args.includes("--dry-run")
const bump = args.find((arg) => !arg.startsWith("--")) ?? "patch"
if (!["patch", "minor", "major"].includes(bump)) {
  console.error(`✘ unknown bump kind "${bump}" — expected patch, minor, or major`)
  process.exit(1)
}

const die = (message: string): never => {
  console.error(`✘ ${message}`)
  process.exit(1)
}
const step = (message: string) => console.log(`\n▶ ${message}`)

// Interactive commands (OTP prompts) need inherited stdio.
const run = (command: Array<string>) => {
  const result = Bun.spawnSync(command, { stdio: ["inherit", "inherit", "inherit"] })
  if (result.exitCode !== 0) die(`${command.join(" ")} failed (exit ${result.exitCode})`)
}

// -- preconditions ----------------------------------------------------------
const branch = (await $`git rev-parse --abbrev-ref HEAD`.text()).trim()
if (branch !== "main") die(`releases happen from main — currently on ${branch}`)

const pkg = await Bun.file("package.json").json()
const published = (await $`npm view ${pkg.name} version`.text()).trim()
const dirty = (await $`git status --porcelain`.text()).trim()

// -- determine the target version ------------------------------------------
let target: string
if (pkg.version !== published) {
  console.log(`package.json (${pkg.version}) is already ahead of npm (${published}) — resuming that release`)
  target = pkg.version
} else {
  const [major, minor, patch] = pkg.version.split(".").map(Number)
  target = bump === "major"
    ? `${major + 1}.0.0`
    : bump === "minor"
    ? `${major}.${minor + 1}.0`
    : `${major}.${minor}.${patch + 1}`
  if (dryRun) {
    if (dirty !== "") console.log("note: working tree is dirty — a real run would stop here")
    console.log(`dry run: would release v${target} (${bump} bump from ${pkg.version}), then publish, tag, and create the GitHub release`)
    process.exit(0)
  }
  if (dirty !== "") die("working tree is not clean — commit or stash first")
  await $`git pull --ff-only`.quiet()
  step(`bumping ${pkg.version} → ${target}`)
  await $`npm version ${target} --no-git-tag-version`.quiet()
}
if (dryRun) {
  console.log(`dry run: would resume the v${target} release (publish, tag, GitHub release as needed)`)
  process.exit(0)
}

// -- verify before anything leaves the machine ------------------------------
step("typecheck + tests")
run(["bun", "run", "check"])
run(["bun", "run", "test"])

// -- commit and push the bump -----------------------------------------------
const committed = (await $`git log -1 --format=%s`.text()).trim() === `v${target}`
if (committed) {
  console.log(`bump commit v${target} already exists — skipping`)
} else {
  step(`committing and pushing v${target}`)
  await $`git add package.json`
  await $`git commit -m ${"v" + target}`
  await $`git push`
}

// -- publish (prepack re-runs check + test + build) -------------------------
step(`npm publish ${pkg.name}@${target} — have your OTP ready`)
run(["npm", "publish"])

const live = (await $`npm view ${pkg.name} version`.text()).trim()
if (live !== target) die(`npm reports ${live}, expected ${target}`)
console.log(`✔ ${pkg.name}@${target} is live`)

// -- tag and GitHub release --------------------------------------------------
const tag = `v${target}`
const tagExists = (await $`git tag -l ${tag}`.text()).trim() !== ""
if (!tagExists) {
  step(`tagging ${tag}`)
  await $`git tag ${tag}`
}
await $`git push origin ${tag}`

const releaseExists = await $`gh release view ${tag}`.quiet().nothrow().then((r) => r.exitCode === 0)
if (releaseExists) {
  console.log(`GitHub release ${tag} already exists — skipping`)
} else {
  step(`creating GitHub release ${tag}`)
  run(["gh", "release", "create", tag, "--title", tag, "--generate-notes"])
}

console.log(`\n✔ released ${pkg.name}@${target}`)
console.log(`  npm      https://www.npmjs.com/package/${pkg.name}`)
console.log(`  release  https://github.com/rickyeescobar/${pkg.name}/releases/tag/${tag}`)
console.log(`  smoke    npx --yes ${pkg.name}@${target} --version`)
