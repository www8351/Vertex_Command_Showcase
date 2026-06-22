# Vertex Command

Full-stack **trade-execution & copy-trading SaaS** for proprietary-firm and
multi-broker futures traders. A low-latency routing engine ingests broker
WebSocket streams, applies per-strategy risk rules, and mirrors fills across
linked accounts in real time — fronted by an animated React/WebGL control
center for monitoring, journaling, billing, and analytics.

> **About this repository.** Sanitized public **code showcase** of a private
> production codebase. No secrets exist in source or in Git history — every
> credential (broker API keys, Stripe, OpenAI, session/encryption keys, DB
> passwords) is injected at runtime from environment variables; see
> [`.env.example`](./.env.example). This mirror is for engineering review, not
> a hosted deployment.

---

## What it does

- **Copy trading** — a routing engine (`server/copy-trading-engine.ts`) mirrors
  a leader account's executions onto follower accounts, sized and gated by a
  dedicated **risk engine** (`copy-trading-risk-engine.ts`) and a configurable
  **rule engine** (`rule-engine.ts`, `broker-rules.ts`).
- **Real-time broker integration** — live order/fill streams over WebSockets
  (`tradovate-websocket.ts`) against TopstepX and Tradovate; equity-tick
  processing and latency monitoring with p95-style SLO tracking.
- **Trader workflow** — dashboards, daily/weekly journaling, drawdown
  evaluation, strategy management, reports, and public/shareable performance
  reports.
- **Monetization** — Stripe subscriptions, billing portal, affiliate/partner
  program, tiered account access.
- **3D control center** — a WebGL (`three` / react-three-fiber) interface layer
  for an immersive monitoring view.

---

## Stack

| Layer        | Technology |
|--------------|------------|
| Client       | React 19, Vite 7, TypeScript, Wouter routing |
| 3D / motion  | Three.js, @react-three/fiber, @react-three/drei, Framer Motion |
| UI           | Radix UI primitives, Tailwind CSS, shadcn-style components |
| Client state | TanStack Query, Zustand stores |
| Server       | Node.js, Express 5, TypeScript (ESM), `tsx` runtime |
| Realtime     | `ws` WebSocket server + broker stream clients |
| Database     | PostgreSQL via Drizzle ORM (typed schema + migrations) |
| Auth         | Passport, bcrypt, session cookies, Google OAuth |
| Payments     | Stripe (subscriptions, webhooks, billing portal) |
| AI           | OpenAI (auto-tagging / assistive features) |
| Infra        | Docker, docker-compose, nginx + certbot (TLS), entrypoint orchestration |
| Validation   | Zod (shared client/server schemas) |

---

## Architecture

```
                         ┌────────────────────────────────────────────┐
                         │  Client (React + Vite + Three.js/WebGL)     │
                         │  26 pages: Dashboard · CopyTrading ·         │
                         │  TradingMonitor · Billing · Journal · Admin  │
                         │  TanStack Query · Zustand · Radix/Tailwind   │
                         └───────────────┬───────────────▲─────────────┘
                            REST + WS     │               │ live updates
                         ┌───────────────▼───────────────┴─────────────┐
                         │  Express API (server/, 57 modules)           │
                         │  ┌─────────────┐  ┌──────────────────────┐   │
   Broker feeds  ──WS──▶ │  │ copy-trading │  │ rule / risk engines  │   │
   (Tradovate /          │  │   engine     │─▶│ broker-rules         │   │
    TopstepX)            │  └─────────────┘  └──────────────────────┘   │
                         │  billing(Stripe) · affiliates · journal ·    │
                         │  signals/webhooks · admin · monitoring       │
                         └───────────────┬──────────────────────────────┘
                                         │ Drizzle ORM (typed)
                         ┌───────────────▼──────────────────────────────┐
                         │  PostgreSQL  (shared/ schemas + migrations/)  │
                         │  billing · copy-trading · integrations ·      │
                         │  journal · core                               │
                         └───────────────────────────────────────────────┘

   Edge:  nginx (TLS via certbot) ──▶ Express  |  Packaged with Docker / compose
```

### Layout

```
client/          React + Vite SPA
  src/pages/     26 route pages (Dashboard, CopyTrading, Billing, Admin, WebGL3D…)
  src/components/ UI + feature components (Radix/Tailwind, three.js scenes)
  src/stores/    Zustand state
  src/lib/       API client, query hooks, helpers
  src/locales/   i18n strings
server/          Express API — 57 modules
  copy-trading-engine.ts / copy-trading-risk-engine.ts / rule-engine.ts
  tradovate-websocket.ts / equity-tick-processor.ts   (realtime broker I/O)
  billing-routes.ts / stripeClient.ts                 (payments)
  encryption.ts                                        (at-rest credential crypto)
  admin / affiliate / journal / signal / monitor routes
shared/          Drizzle schemas + Zod models shared by client and server
migrations/      SQL migrations (drizzle-kit)
infra/ · nginx/ · Dockerfile · docker-compose*.yml    deployment & TLS
```

### Engineering principles applied

- **Code/config separation** — zero hardcoded credentials anywhere in source.
  All secrets come from `process.env`; `.env*` and `*.key` are gitignored and
  only `.env.example` is tracked. Production injects via the host secret store
  (Docker/compose env, CI/CD secrets, or a vault), never a committed file.
- **Encrypted broker credentials** — third-party API credentials are encrypted
  at rest (`server/encryption.ts`) using a runtime-provided key, never stored
  in plaintext.
- **Typed end-to-end** — Drizzle schemas + Zod models are shared between client
  and server, so DB rows and API payloads are typed at compile time.
- **Realtime, latency-aware** — broker fills propagate over WebSockets with
  latency monitoring and SLO tracking; the copy engine is decoupled from the
  risk/rule engines for testability.
- **Defense in depth** — session auth (Passport + bcrypt), per-route rate
  limiting (Postgres-backed), webhook signature verification, CORS origin
  allow-listing, nginx TLS termination.

---

## Running it (for reviewers)

This is a code showcase; to run it you supply your own backing services.

```bash
# 1. Install
npm install

# 2. Configure — copy the template and fill in your own values
cp .env.example .env        # Postgres, Stripe (test), broker creds, keys

# 3. Database
npm run db:push             # apply Drizzle schema to your Postgres

# 4. Dev
npm run dev                 # Express + Vite (API + client)

# Or full stack via Docker
docker compose -f docker-compose.dev.yml up
```

Requires Node.js 20+ and a PostgreSQL instance. Stripe/broker/OpenAI features
are optional and degrade gracefully when their env vars are unset.

---

## Security & secret handling

| Concern                  | Approach |
|--------------------------|----------|
| Secrets in source        | None — `process.env` only. |
| Secrets in Git history   | None — public mirror initialized clean; private history not exposed. |
| `.env`, `*.key`, key JSON | Gitignored; only `.env.example` is tracked. |
| Broker/API credentials   | Encrypted at rest with a runtime key (`server/encryption.ts`). |
| Stripe                   | Server-side secret key + webhook signature verification. |
| Production injection      | Host env / Docker secrets / CI/CD secrets — not files. |

## License

MIT — see [`LICENSE`](./LICENSE).
