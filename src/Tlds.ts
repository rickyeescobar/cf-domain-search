/**
 * The set of TLDs Cloudflare Registrar supports.
 *
 * Embedded from https://www.cloudflare.com/tld-policies/ (2026-08); the
 * `--live-tlds` flag unions in the current list from cfdomainpricing.com.
 */
import { Console, Effect, Schema } from "effect"
import { HttpClient, HttpClientResponse } from "effect/unstable/http"
import { Style } from "./Style.ts"

const PRICING_FEED = "https://cfdomainpricing.com/prices.json"

const PricingFeed = Schema.Record(Schema.String, Schema.Unknown)

/** The community pricing feed, keyed by TLD. Warns and yields [] on failure. */
export const fetchLive: Effect.Effect<
  ReadonlyArray<string>,
  never,
  HttpClient.HttpClient
> = Effect.gen(function*() {
  const client = yield* HttpClient.HttpClient
  const response = yield* client.get(PRICING_FEED)
  const feed = yield* HttpClientResponse.schemaBodyJson(PricingFeed)(response)
  return Object.keys(feed)
}).pipe(
  Effect.catch((error) =>
    Effect.gen(function*() {
      const { yellow } = yield* Style
      yield* Console.error(
        yellow(`warning: could not fetch live TLD list (${error}); using built-in list`)
      )
      return []
    })
  )
)

export const tlds: ReadonlyArray<string> = [
  "ab.ca", "ac", "academy", "accountant", "accountants", "actor", "adult", "agency", "ai",
  "airforce", "apartments", "app", "army", "associates", "attorney", "auction", "audio",
  "baby", "band", "bar", "bargains", "bc.ca", "beer", "bet", "bid", "bike", "bingo", "biz",
  "black", "blog", "blue", "boo", "boston", "boutique", "broker", "build", "builders",
  "business", "ca", "cab", "cafe", "cam", "camera", "camp", "capital", "cards", "care",
  "careers", "casa", "cash", "casino", "catering", "cc", "center", "ceo", "charity", "chat",
  "cheap", "christmas", "church", "city", "claims", "cleaning", "clinic", "clothing",
  "cloud", "club", "co", "co.nz", "co.uk", "coach", "codes", "coffee", "college", "com",
  "com.ai", "com.co", "com.mx", "community", "company", "compare", "computer", "condos",
  "construction", "consulting", "contact", "contractors", "cooking", "cool", "coupons",
  "credit", "creditcard", "cricket", "cruises", "dad", "dance", "date", "dating", "day",
  "dealer", "deals", "degree", "delivery", "democrat", "dental", "dentist", "design",
  "dev", "diamonds", "diet", "digital", "direct", "directory", "discount", "doctor",
  "dog", "domains", "download", "education", "email", "energy", "engineer", "engineering",
  "enterprises", "equipment", "esq", "estate", "events", "exchange", "expert", "exposed",
  "express", "fail", "faith", "family", "fan", "fans", "farm", "fashion", "feedback",
  "finance", "financial", "fish", "fishing", "fit", "fitness", "flights", "florist",
  "flowers", "fm", "foo", "football", "forex", "forsale", "forum", "foundation", "fun",
  "fund", "furniture", "futbol", "fyi", "gallery", "game", "games", "garden", "geek.nz",
  "gifts", "gives", "giving", "glass", "global", "gmbh", "gold", "golf", "graphics",
  "gratis", "green", "gripe", "group", "guide", "guitars", "guru", "haus", "health",
  "healthcare", "help", "hockey", "holdings", "holiday", "horse", "hospital", "host",
  "hosting", "house", "how", "icu", "immo", "immobilien", "inc", "industries", "info",
  "ing", "ink", "institute", "insure", "international", "investments", "io", "irish",
  "jetzt", "jewelry", "kaufen", "kim", "kitchen", "land", "lawyer", "lease", "legal",
  "lgbt", "life", "lighting", "limited", "limo", "link", "live", "loan", "loans", "lol",
  "love", "ltd", "luxe", "maison", "management", "market", "marketing", "markets",
  "mb.ca", "mba", "me", "me.uk", "media", "meme", "memorial", "men", "miami", "mobi",
  "moda", "mom", "money", "monster", "mortgage", "mov", "movie", "mx", "navy", "nb.ca",
  "net", "net.ai", "net.co", "net.nz", "net.uk", "network", "new", "news", "nexus",
  "ngo", "ninja", "nl.ca", "nom.co", "ns.ca", "nt.ca", "nu.ca", "nz", "observer",
  "off.ai", "on.ca", "ong", "online", "org", "org.ai", "org.mx", "org.nz", "org.uk",
  "organic", "page", "partners", "parts", "party", "pe.ca", "pet", "phd", "photography",
  "photos", "pics", "pictures", "pink", "pizza", "place", "plumbing", "plus", "porn",
  "press", "pro", "productions", "prof", "promo", "properties", "protection", "pub",
  "qc.ca", "racing", "realty", "recipes", "red", "rehab", "reise", "reisen", "rent",
  "rentals", "repair", "report", "republican", "rest", "restaurant", "review", "reviews",
  "rip", "rocks", "rodeo", "rsvp", "run", "sale", "salon", "sarl", "school", "schule",
  "science", "security", "select", "services", "sex", "sh", "shoes", "shop", "shopping",
  "show", "singles", "site", "sk.ca", "ski", "soccer", "social", "software", "solar",
  "solutions", "soy", "space", "storage", "store", "stream", "studio", "style",
  "supplies", "supply", "support", "surf", "surgery", "systems", "tax", "taxi", "team",
  "tech", "technology", "tennis", "theater", "theatre", "tienda", "tips", "tires",
  "today", "tools", "toronto.on.ca", "tours", "town", "toys", "trade", "trading",
  "training", "travel", "tv", "uk", "university", "uno", "us", "vacations", "ventures",
  "vet", "viajes", "video", "villas", "vin", "vip", "vision", "vodka", "vote", "voyage",
  "watch", "webcam", "website", "wedding", "wiki", "win", "wine", "work", "works",
  "world", "wtf", "xxx", "xyz", "yk.ca", "yoga", "yt.ca", "zone",
]
