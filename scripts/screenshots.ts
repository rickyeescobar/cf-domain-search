/**
 * Regenerates the README screenshots (docs/*.png) as ray.so frames.
 *
 * ray.so encodes the entire snippet in the URL fragment, so this drives a
 * local headless Chrome to each URL and screenshots the frame element.
 *
 * Run: bun add -d puppeteer-core && bun scripts/screenshots.ts
 */
import puppeteer from "puppeteer-core"

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"

interface Shot {
  readonly file: string
  readonly title: string
  readonly language: string
  readonly code: string
  /** Frame width in px; set when long lines (the buy URL) must not wrap. */
  readonly width?: number
}

const shots: ReadonlyArray<Shot> = [
  {
    file: "docs/fullsweep.png",
    title: "cfdomains",
    language: "shell",
    width: 1010,
    code: [
      "$ cfdomains malachi",
      "",
      "        ▄▄▄▄▄",
      "    ▄▄█████████▄▄            cfdomains",
      "  ▄███████████████▄▄▄        Cloudflare Registrar domain search",
      " ▟█████████████████████▙",
      " ▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀",
      "",
      "Available (343)",
      "  ✔ malachi.ac                $45.00  renews $45.00/yr",
      "  ✔ malachi.academy           $36.20  renews $36.20/yr",
      "  ✔ malachi.accountant        $20.18  renews $20.18/yr",
      "  ✔ malachi.accountants       $90.20  renews $90.20/yr",
      "  ✔ malachi.actor             $34.20  renews $34.20/yr",
      "  ✔ malachi.adult             $95.20  renews $95.20/yr",
      "  ✔ malachi.agency            $24.20  renews $24.20/yr",
      "  ✔ malachi.airforce          $80.20  renews $80.20/yr",
      "  ✔ malachi.apartments        $44.20  renews $44.20/yr",
      "  … 334 more",
      "",
      "Taken (74)",
      "  ✘ malachi.app  malachi.com  malachi.dev  malachi.io  …",
      "",
      "Not supported via API (6) — may still be purchasable in the dashboard",
      "  · malachi.cc  malachi.giving  malachi.lol  malachi.mom  malachi.new  malachi.sh",
      "",
      "343 available · 74 taken · 6 unsupported · cheapest: malachi.bid at $4.18/yr",
      "buy: https://dash.cloudflare.com/<account-id>/domains/registrations/purchase?query=malachi"
    ].join("\n")
  },
  {
    file: "docs/sweep.png",
    title: "cfdomains",
    language: "shell",
    width: 1010,
    code: [
      "$ cfdomains malachi --tlds com,dev,io,app,day,page,rocks,ninja,haus",
      "",
      "        ▄▄▄▄▄",
      "    ▄▄█████████▄▄            cfdomains",
      "  ▄███████████████▄▄▄        Cloudflare Registrar domain search",
      " ▟█████████████████████▙",
      " ▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀",
      "",
      "Available (5)",
      "  ✔ malachi.day       $10.20  renews $10.20/yr",
      "  ✔ malachi.haus      $26.20  renews $26.20/yr",
      "  ✔ malachi.ninja     $24.20  renews $24.20/yr",
      "  ✔ malachi.page      $10.20  renews $10.20/yr",
      "  ✔ malachi.rocks     $17.20  renews $17.20/yr",
      "",
      "Taken (4)",
      "  ✘ malachi.app  malachi.com  malachi.dev  malachi.io",
      "",
      "5 available · 4 taken · 0 unsupported · cheapest: malachi.day at $10.20/yr",
      "buy: https://dash.cloudflare.com/<account-id>/domains/registrations/purchase?query=malachi"
    ].join("\n")
  },
  {
    file: "docs/help.png",
    title: "cfdomains --help",
    language: "shell",
    code: [
      "$ cfdomains --help",
      "",
      "DESCRIPTION",
      "  Check a name's availability and price across every Cloudflare Registrar TLD",
      "",
      "USAGE",
      "  cfdomains <subcommand> [flags] <name>",
      "",
      "ARGUMENTS",
      "  name string    Name to check across TLDs, or a full domain for an exact check",
      "",
      "FLAGS",
      "  --available, -a        Only show available domains",
      "  --json                 Machine-readable output (with purchase_url per domain)",
      "  --links, -l            Print a purchase link under each available domain",
      "  --tlds string          Restrict to specific TLDs, e.g. com,dev,io",
      "  --live-tlds            Merge in the TLD list from cfdomainpricing.com",
      "  --token string         Cloudflare API token (or CLOUDFLARE_API_TOKEN)",
      "  --account-id string    Cloudflare account ID (or CLOUDFLARE_ACCOUNT_ID)",
      "",
      "GLOBAL FLAGS",
      "  --help, -h                          Show help information",
      "  --version, -v                       Show version information",
      "  --wizard                            Start wizard mode for a command",
      "  --completions <bash|zsh|fish|sh>    Print shell completion script",
      "  --log-level <all|...|none>          Sets the minimum log level",
      "  --no-color                          Disable colored output",
      "",
      "SUBCOMMANDS",
      "  setup     Interactive credential setup",
      "  logout    Delete credentials saved by `cfdomains setup`"
    ].join("\n")
  },
  {
    file: "docs/json.png",
    title: "cfdomains malachi --tlds day,com --json",
    language: "json",
    code: JSON.stringify(
      [
        {
          name: "malachi.day",
          registrable: true,
          tier: "standard",
          pricing: { currency: "USD", registration_cost: "10.20", renewal_cost: "10.20" }
        },
        { name: "malachi.com", registrable: false, reason: "domain_unavailable" }
      ],
      null,
      2
    )
  }
]

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ["--no-first-run", "--hide-scrollbars"]
})

try {
  for (const shot of shots) {
    // A fresh page per shot: ray.so only reads the hash on load, so
    // navigating an existing page to a new fragment keeps the old snippet.
    const page = await browser.newPage()
    await page.setViewport({ width: 1600, height: 1400, deviceScaleFactor: 2 })
    const params = new URLSearchParams({
      title: shot.title,
      theme: "raindrop",
      padding: "64",
      background: "true",
      darkMode: "true",
      language: shot.language,
      code: Buffer.from(shot.code, "utf8").toString("base64")
    })
    // The frame is otherwise capped at 920px by ray.so's outerFrame CSS.
    if (shot.width !== undefined) params.set("width", String(shot.width))
    console.log(`→ ${shot.file}`)
    await page.goto(`https://ray.so/#${params.toString()}`, {
      waitUntil: "networkidle2",
      timeout: 60000
    })
    await new Promise((resolve) => setTimeout(resolve, 1500))
    // Hide the resize drag handles so they don't appear at the image edges.
    // ray.so's JetBrains Mono webfont subset lacks box-drawing/block glyphs
    // (╭─│▁▂█…), which would fall back to a wider font and break alignment —
    // serve just that range from local Menlo, whose advance width matches.
    await page.addStyleTag({
      content: [
        '[class*="windowSizeDragPoint"] { display: none !important }',
        "@font-face { font-family: BoxFix; src: local('Menlo'); unicode-range: U+2500-25FF; }",
        '[class*="Frame"] pre, [class*="Frame"] code, [class*="Frame"] textarea {',
        "  font-family: BoxFix, 'JetBrains Mono', monospace !important;",
        "}",
        '[class*="outerFrame"] { max-width: none !important; width: 100% !important }'
      ].join("\n")
    })
    await new Promise((resolve) => setTimeout(resolve, 500))
    const frame = await page.$('[class*="DefaultFrame-module"]')
    if (frame === null) throw new Error(`${shot.file}: ray.so frame element not found`)
    await frame.screenshot({ path: shot.file as `${string}.png` })
    await page.close()
  }
} finally {
  await browser.close()
}
console.log("done")
