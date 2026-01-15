# Lead Agent

An inbound lead qualification and property research app built with Next.js and Workflow DevKit. It collects leads, enriches them with public data (PAO, demographics, web research), scores them, and emails a report.

## What this repo contains

- Contact-form lead capture (API + UI)
- Optional Meta/Facebook Lead Ads webhook ingestion
- Property Appraiser (PAO) scraping for Manatee/Sarasota counties
- StellarMLS (Realist) enrichment via Playwright SSO
- Web research via Exa
- ZIP-based demographics enrichment
- Lead scoring and report email delivery

## Tech stack

- Next.js 16
- Workflow DevKit
- Vercel AI SDK
- Resend (email)
- Exa (web research)
- Playwright (stealth CDP for scraping)

## Architecture (high level)

```
Lead Sources
├─ Contact Form (POST /api/submit)
│  └─ workflowInbound
│     ├─ stepInitializeReport
│     ├─ stepEnrichPao
│     ├─ stepEnrichStellarRealist
│     ├─ stepEnrichExa
│     ├─ stepEnrichDemographics
│     ├─ stepScoreLead
│     └─ stepSendReportEmail
│
└─ Meta Lead Ads (POST /api/meta/webhook)
   └─ workflowMetaLead
      ├─ stepInitializeReport
      ├─ stepEnrichPao
      ├─ stepEnrichStellarRealist
      ├─ stepEnrichExa
      ├─ stepEnrichDemographics
      ├─ stepScoreLead
      └─ stepSendReportEmail
```

## Getting started

### Prerequisites

- Node.js 20+
- pnpm (recommended) or npm

### Install

```bash
pnpm install
```

### Configure environment

Copy `.env.example` to `.env.local` and set the required variables.

Required:
```bash
AI_GATEWAY_API_KEY=...
EXA_API_KEY=...
RESEND_API_KEY=...
REPORT_TO_EMAIL=you@example.com
```

Optional (Meta Lead Ads):
```bash
META_APP_SECRET=...
META_ACCESS_TOKEN=...
META_VERIFY_TOKEN=...
```

Playwright (PAO scraping):
```bash
# Stealth CDP (recommended, default)
PLAYWRIGHT_MODE=stealth
PLAYWRIGHT_CDP_ENDPOINT=wss://<your-cdp-endpoint>

# Local dev escape hatch (not for production)
# PLAYWRIGHT_MODE=local
```

StellarMLS / Realist (SSO session reuse):
```bash
STELLARMLS_PING_AUTHORIZE_URL=...
STELLARMLS_USERNAME=...
STELLARMLS_PASSWORD=...

# Provide storageState to reuse sessions in serverless
STELLARMLS_STORAGE_STATE_JSON=...
# or
STELLARMLS_STORAGE_STATE_B64=...

# Optional: pull session state from a service
STELLARMLS_SESSION_INFO_URL=...
STELLARMLS_SESSION_INFO_JWT=...

# Optional: persist refreshed session in Neon
STELLARMLS_SESSION_DB_ENABLED=false
STELLARMLS_SESSION_ACCOUNT_KEY=
```

Database (parcel ingestion):
```bash
DATABASE_URL=...
PARCEL_INGESTION_ENABLED=false
PARCEL_DEFAULT_SOURCE=fl-manatee-pa
```

### Run locally

```bash
pnpm dev
```

Open http://localhost:3000 and submit a test lead.

## Useful scripts

- `pnpm pao:test` — live PAO scraper test runner
- `pnpm pao:test --county=sarasota --debug` — capture screenshots/HTML for debugging
- `pnpm stellar:session` — generate StellarMLS storageState (use `--json` for raw JSON)

## Project structure

```
lead-agent/
├─ app/                 # Next.js app + API routes
├─ components/          # UI components
├─ lib/                 # Enrichment, scraping, scoring, and services
├─ workflows/           # Workflow DevKit steps
├─ scripts/             # CLI utilities
└─ public/              # Static assets
```

## Notes on Playwright stealth CDP

All scraping runs through a shared browser manager that defaults to stealth CDP mode. Set `PLAYWRIGHT_CDP_ENDPOINT` to your CDP provider (e.g., Browserless, SeleniumBase CDP). In local development, you can set `PLAYWRIGHT_MODE=local` to launch Chromium directly.

## StellarMLS session reuse

StellarMLS enrichment uses Playwright storageState for session reuse. Provide `STELLARMLS_STORAGE_STATE_JSON` or `STELLARMLS_STORAGE_STATE_B64` to avoid interactive login in serverless, or supply `STELLARMLS_SESSION_INFO_URL` with a JWT to fetch session state from another service. If `STELLARMLS_SESSION_DB_ENABLED=true` and `DATABASE_URL` is set, refreshed sessions are stored in Neon for automatic reuse. Treat storageState values as secrets.

## License

MIT
