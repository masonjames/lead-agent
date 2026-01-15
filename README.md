# Lead Agent

<img width="1819" height="1738" alt="hero" src="https://github.com/user-attachments/assets/347757fd-ad00-487d-bdd8-97113f13878b" />

An inbound lead qualification and research agent built with [Next.js](http://nextjs.org/), [AI SDK](https://ai-sdk.dev/), and [Workflow DevKit](https://useworkflow.dev/). Supports Facebook Lead Ads webhooks with automatic enrichment and email reports. Hosted on the [Vercel AI Cloud](https://vercel.com/blog/the-ai-cloud-a-unified-platform-for-ai-workloads).

**_This is meant to serve as a reference architecture to be adapted to the needs of your specific organization._**

## Overview

Lead agent app that captures leads from contact forms and Facebook Lead Ads, then kicks off enrichment workflows with automatic email reporting.

### Lead Sources

1. **Contact Form** - Web form submission triggers qualification workflow
2. **Facebook Lead Ads** - Meta webhook integration for lead ad campaigns

### Features

- **Immediate Response** - Returns a success response to the user upon submission
- **Durable Workflows** - Uses Workflow DevKit for background task execution
- **Lead Enrichment Pipeline**:
  - **PAO Property Lookup** - Manatee County Property Appraiser data
  - **Exa Web Research** - Public profile and web presence discovery
  - **Demographics** - ZIP-based demographic insights
  - **Lead Scoring** - 0-100 score with tier assignment (HOT/WARM/NURTURE)
- **Email Reports** - Automatic internal reports via Resend (no Slack required)

## Architecture

```
Lead Sources:
├── Contact Form (POST /api/submit)
│   └── workflowInbound
│       ├── stepResearch (AI agent)
│       ├── stepQualify (generateObject)
│       ├── stepWriteEmail
│       └── stepSendInboundReportEmail
│
└── Facebook Lead Ads (POST /api/meta/webhook)
    └── workflowMetaLead
        ├── stepInitializeReport
        ├── stepEnrichPao (property lookup)
        ├── stepEnrichExa (web research)
        ├── stepEnrichDemographics
        ├── stepScoreLead (0-100 scoring)
        └── stepSendReportEmail
```

## Tech Stack

- **Framework**: [Next.js 16](https://nextjs.org)
- **Durable execution**: [Workflow DevKit](http://useworkflow.dev/)
- **AI**: [Vercel AI SDK](https://ai-sdk.dev/) with [AI Gateway](https://vercel.com/ai-gateway)
- **Email**: [Resend](https://resend.com)
- **Web Search**: [Exa.ai](https://exa.ai/)
- **Property Data**: Manatee County PAO scraper (Playwright)

## Deploy with Vercel

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fmasonjames%2Flead-agent&env=AI_GATEWAY_API_KEY,EXA_API_KEY,RESEND_API_KEY,REPORT_TO_EMAIL&project-name=lead-agent&repository-name=lead-agent)

## Getting Started

### Prerequisites

- Node.js 20+
- pnpm (recommended) or npm
- [Vercel AI Gateway API Key](https://vercel.com/d?to=%2F%5Bteam%5D%2F%7E%2Fai%2Fapi-keys)
- [Exa API key](https://exa.ai/)
- [Resend API key](https://resend.com)

### Optional (for Facebook Lead Ads)

- Meta App with Lead Ads webhook configured
- META_APP_SECRET, META_ACCESS_TOKEN, META_VERIFY_TOKEN

### Installation

1. Clone the repository:

```bash
git clone https://github.com/masonjames/lead-agent.git
cd lead-agent
```

2. Install dependencies:

```bash
pnpm install
```

3. Set up environment variables:

```bash
cp .env.example .env.local
```

Configure the following variables:

```bash
# Required
AI_GATEWAY_API_KEY=your-ai-gateway-key
EXA_API_KEY=your-exa-key
RESEND_API_KEY=your-resend-key
REPORT_TO_EMAIL=your-email@example.com

# Optional - Facebook Lead Ads
META_APP_SECRET=your-meta-app-secret
META_ACCESS_TOKEN=your-meta-access-token
META_VERIFY_TOKEN=your-webhook-verify-token

# Optional - Stealth CDP browser for PAO scraping
PLAYWRIGHT_MODE=stealth
PLAYWRIGHT_CDP_ENDPOINT=http://127.0.0.1:9222
# Set PLAYWRIGHT_MODE=local to use a local Chromium browser in development
# (Legacy alias still supported)
# PLAYWRIGHT_WS_ENDPOINT=wss://your-browser-service
```

4. Run the development server:

```bash
pnpm dev
```

5. Open [http://localhost:3000](http://localhost:3000) to see the application and submit a test lead.

## Project Structure

```
lead-agent/
├── app/
│   ├── api/
│   │   ├── submit/       # Form submission endpoint
│   │   └── meta/
│   │       └── webhook/  # Facebook Lead Ads webhook
│   └── page.tsx          # Home page
├── lib/
│   ├── services.ts       # Core business logic
│   ├── types.ts          # TypeScript schemas and types
│   ├── scoring.ts        # Lead scoring logic
│   ├── email/
│   │   └── resend.ts     # Resend email service
│   ├── report/
│   │   └── render.ts     # Email report rendering
│   ├── meta/
│   │   ├── signature.ts  # Webhook signature verification
│   │   ├── graph.ts      # Meta Graph API client
│   │   └── normalize-leadgen.ts  # Lead data normalization
│   ├── enrichment/
│   │   ├── pao.ts        # Property Appraiser enrichment
│   │   ├── exa.ts        # Exa web research
│   │   └── demographics.ts  # Demographic data
│   └── realestate/
│       ├── property-types.ts
│       ├── address/      # Address normalization
│       ├── playwright/   # Browser management
│       └── pao/          # PAO scraper
├── components/
│   └── lead-form.tsx     # Main form component
└── workflows/
    ├── inbound/          # Form submission workflow
    │   ├── index.ts
    │   └── steps.ts
    └── meta/             # Facebook Lead Ads workflow
        ├── index.ts
        └── steps.ts
```

## Facebook Lead Ads Setup

### 1. Create a Meta App

1. Go to [Meta for Developers](https://developers.facebook.com)
2. Create a new app or use an existing one
3. Add the "Leads Retrieval" product
4. Get your App Secret from Settings > Basic

### 2. Configure Webhook

1. In your Meta App, go to Webhooks
2. Subscribe to the `leadgen` topic
3. Set the callback URL to `https://your-domain.com/api/meta/webhook`
4. Use a custom verify token (set as META_VERIFY_TOKEN)

### 3. Get Access Token

1. Generate a Page Access Token with `leads_retrieval` permission
2. Or use a System User token for production

### 4. Subscribe to Page Events

```bash
curl -X POST "https://graph.facebook.com/v19.0/{page-id}/subscribed_apps" \
  -H "Authorization: Bearer {access-token}" \
  -d "subscribed_fields=leadgen"
```

## Lead Scoring

Leads are scored 0-100 based on:

| Component | Max Points | Factors |
|-----------|------------|---------|
| Contact Quality | 25 | Email, phone, name, address |
| Property Match | 30 | PAO data found, assessed value, age, size |
| Financial Signals | 25 | Home value, ZIP income, sale history |
| Engagement | 20 | Form completeness, local area, public profile |

### Score Tiers

- **HOT** (70-100): High priority, ready to contact
- **WARM** (50-69): Good lead, needs nurturing
- **NURTURE** (30-49): Long-term follow-up
- **COLD** (0-29): Low priority

## Customization

### Extend Enrichment

Add new enrichment sources in `lib/enrichment/`:

```typescript
export async function enrichFromMySource(params: {...}): Promise<MyEnrichmentResult> {
  // Your enrichment logic
}
```

### Modify Scoring

Edit `lib/scoring.ts` to adjust scoring weights and rules.

### Custom Email Templates

Modify `lib/report/render.ts` to customize email report templates.

### Add Workflow Steps

Follow [Workflow DevKit docs](https://useworkflow.dev) to add new steps.

## License

MIT
