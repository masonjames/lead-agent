/**
 * Lead report rendering
 * Converts LeadReport to HTML email format
 */

import type { ScoreBreakdown } from "../scoring";
import type { BusinessStatus } from "../types";

/**
 * Report data structure for rendering
 * This is a flexible interface that accepts the workflow's internal report format
 */
export interface RenderableReport {
  leadId: string;
  source: "FORM" | "META";
  processingStatus: string;
  businessStatus: string;
  receivedAt?: string;
  contact?: {
    name?: string;
    email?: string;
    phone?: string;
    address?: string;
  };
  property?: {
    parcelId?: string;
    address?: string;
    owner?: string;
    yearBuilt?: number;
    bedrooms?: number;
    bathrooms?: number;
    assessedValue?: number;
    marketValue?: number;
    building?: { livingArea?: number };
    salesHistory?: Array<{
      saleDate?: string;
      salePrice?: number;
      qualified?: boolean;
    }>;
  };
  enrichment?: {
    demographics?: {
      medianIncome?: number;
      medianHomeValue?: number;
      populationDensity?: string;
    };
    publicProfiles?: Array<{
      source: string;
      url: string;
      name?: string;
      headline?: string;
    }>;
    webResearchSummary?: string;
  };
  score?: {
    value: number;
    tier: string;
    reasons: string[];
  };
  flags?: {
    possibleDuplicate?: boolean;
    missingCriticalInfo?: boolean;
    outsideServiceArea?: boolean;
    highValue?: boolean;
    quickResponse?: boolean;
  };
}

interface RenderReportParams {
  report: RenderableReport;
  scoreBreakdown: ScoreBreakdown;
}

/**
 * Get emoji for business status
 */
function statusEmoji(status: string): string {
  switch (status) {
    case "HOT":
      return "🔥";
    case "WARM":
      return "☀️";
    case "NURTURE":
      return "🌱";
    case "NOT_LOCAL":
      return "📍";
    case "SPAM_OR_BOT":
      return "🤖";
    case "DO_NOT_CONTACT":
      return "🚫";
    default:
      return "❓";
  }
}

/**
 * Get color for score tier
 */
function tierColor(tier: ScoreBreakdown["tier"]): string {
  switch (tier) {
    case "HOT":
      return "#dc2626"; // red
    case "WARM":
      return "#f59e0b"; // amber
    case "NURTURE":
      return "#10b981"; // emerald
    case "COLD":
      return "#6b7280"; // gray
  }
}

/**
 * Format currency
 */
function formatCurrency(value: number | undefined): string {
  if (value === undefined || value === null) return "N/A";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value);
}

/**
 * Format date
 */
function formatDate(date: string | Date | undefined): string {
  if (!date) return "N/A";
  return new Date(date).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

/**
 * Simple markdown to HTML converter for email rendering
 * Handles: bold, links, lists, line breaks
 */
function markdownToHtml(markdown: string): string {
  if (!markdown) return "";

  return markdown
    // Escape HTML entities first
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    // Convert **bold** to <strong>
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    // Convert [text](url) to links
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" style="color: #2563eb;">$1</a>')
    // Convert - list items to bullet points
    .replace(/^- (.+)$/gm, "• $1")
    // Convert double newlines to paragraphs
    .replace(/\n\n/g, "</p><p style=\"margin: 8px 0;\">")
    // Convert single newlines to line breaks
    .replace(/\n/g, "<br>")
    // Wrap in paragraph
    .replace(/^(.+)$/, "<p style=\"margin: 8px 0;\">$1</p>");
}

/**
 * Render lead report as HTML email
 */
export function renderReportHtml(params: RenderReportParams): string {
  const { report, scoreBreakdown } = params;
  const { contact, property, enrichment, flags } = report;

  const tierColorValue = tierColor(scoreBreakdown.tier);
  const emoji = statusEmoji(report.businessStatus);

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Lead Report: ${contact?.name || "Unknown"}</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
      line-height: 1.6;
      color: #1f2937;
      max-width: 600px;
      margin: 0 auto;
      padding: 20px;
      background-color: #f9fafb;
    }
    .card {
      background: white;
      border-radius: 8px;
      padding: 20px;
      margin-bottom: 16px;
      box-shadow: 0 1px 3px rgba(0,0,0,0.1);
    }
    .header {
      text-align: center;
      padding-bottom: 16px;
      border-bottom: 1px solid #e5e7eb;
      margin-bottom: 16px;
    }
    .score-badge {
      display: inline-block;
      background: ${tierColorValue};
      color: white;
      font-size: 24px;
      font-weight: bold;
      padding: 8px 16px;
      border-radius: 8px;
      margin: 8px 0;
    }
    .tier-label {
      color: ${tierColorValue};
      font-weight: 600;
      font-size: 14px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    h1 { margin: 0 0 8px 0; font-size: 24px; }
    h2 { margin: 0 0 12px 0; font-size: 18px; color: #374151; }
    h3 { margin: 0 0 8px 0; font-size: 14px; color: #6b7280; text-transform: uppercase; letter-spacing: 0.5px; }
    .label { color: #6b7280; font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px; }
    .value { font-size: 16px; margin-bottom: 12px; }
    .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
    .flag { display: inline-block; background: #fee2e2; color: #991b1b; padding: 2px 8px; border-radius: 4px; font-size: 12px; margin: 2px; }
    .flag.positive { background: #d1fae5; color: #065f46; }
    .reason { padding: 4px 0; border-bottom: 1px solid #f3f4f6; font-size: 14px; }
    .reason:last-child { border-bottom: none; }
    .component { display: flex; justify-content: space-between; padding: 4px 0; }
    .component-bar { height: 8px; background: #e5e7eb; border-radius: 4px; margin-top: 4px; }
    .component-fill { height: 100%; background: ${tierColorValue}; border-radius: 4px; }
    .provenance { font-size: 11px; color: #9ca3af; font-style: italic; }
    a { color: #2563eb; }
  </style>
</head>
<body>
  <div class="card header">
    <h1>${emoji} New Lead: ${contact?.name || "Unknown"}</h1>
    <div class="score-badge">${scoreBreakdown.score}</div>
    <div class="tier-label">${scoreBreakdown.tier} LEAD</div>
    <div style="margin-top: 8px; color: #6b7280; font-size: 14px;">
      Status: ${report.businessStatus} | Source: ${report.source}
    </div>
  </div>

  <div class="card">
    <h2>📇 Contact Information</h2>
    <div class="grid">
      <div>
        <div class="label">Name</div>
        <div class="value">${contact?.name || "Not provided"}</div>
      </div>
      <div>
        <div class="label">Email</div>
        <div class="value">${contact?.email ? `<a href="mailto:${contact.email}">${contact.email}</a>` : "Not provided"}</div>
      </div>
      <div>
        <div class="label">Phone</div>
        <div class="value">${contact?.phone ? `<a href="tel:${contact.phone}">${contact.phone}</a>` : "Not provided"}</div>
      </div>
      <div>
        <div class="label">Address</div>
        <div class="value">${contact?.address || "Not provided"}</div>
      </div>
    </div>
  </div>

  ${property ? `
  <div class="card">
    <h2>🏠 Property Details</h2>
    <div class="value" style="font-weight: 600;">${property.address || "Address not found"}</div>
    ${property.parcelId ? `<div class="provenance">Parcel ID: ${property.parcelId}</div>` : ""}
    <div class="grid" style="margin-top: 12px;">
      <div>
        <div class="label">Assessed Value</div>
        <div class="value">${formatCurrency(property.assessedValue)}</div>
      </div>
      <div>
        <div class="label">Market Value</div>
        <div class="value">${formatCurrency(property.marketValue)}</div>
      </div>
      <div>
        <div class="label">Year Built</div>
        <div class="value">${property.yearBuilt || "N/A"}</div>
      </div>
      <div>
        <div class="label">Bed / Bath</div>
        <div class="value">${property.bedrooms || "?"} / ${property.bathrooms || "?"}</div>
      </div>
      <div>
        <div class="label">Owner</div>
        <div class="value">${property.owner || "N/A"}</div>
      </div>
      <div>
        <div class="label">Sq Ft</div>
        <div class="value">${property.building?.livingArea ? property.building.livingArea.toLocaleString() : "N/A"}</div>
      </div>
    </div>
    ${property.salesHistory?.length ? `
    <h3 style="margin-top: 16px;">Sales History</h3>
    ${property.salesHistory.slice(0, 3).map((sale) => `
      <div style="padding: 4px 0; font-size: 14px;">
        ${formatDate(sale.saleDate)} - ${formatCurrency(sale.salePrice)} ${sale.qualified ? "(Qualified)" : ""}
      </div>
    `).join("")}
    ` : ""}
  </div>
  ` : `
  <div class="card">
    <h2>🏠 Property Details</h2>
    <div style="color: #6b7280;">No property data found</div>
  </div>
  `}

  ${enrichment ? `
  <div class="card">
    <h2>🔍 Enrichment Data</h2>
    ${enrichment.demographics ? `
    <h3>Demographics</h3>
    <div class="grid">
      <div>
        <div class="label">Median Income (ZIP)</div>
        <div class="value">${formatCurrency(enrichment.demographics.medianIncome)}</div>
      </div>
      <div>
        <div class="label">Median Home Value</div>
        <div class="value">${formatCurrency(enrichment.demographics.medianHomeValue)}</div>
      </div>
    </div>
    ` : ""}
    ${enrichment.publicProfiles?.length ? `
    <h3 style="margin-top: 12px;">Public Profiles</h3>
    ${enrichment.publicProfiles.map((profile) => `
      <div style="padding: 4px 0; font-size: 14px;">
        <a href="${profile.url}" target="_blank">${profile.source}: ${profile.name || "Profile"}</a>
        ${profile.headline ? `<div style="color: #6b7280; font-size: 12px;">${profile.headline}</div>` : ""}
      </div>
    `).join("")}
    ` : ""}
    ${enrichment.webResearchSummary ? `
    <h3 style="margin-top: 12px;">Web Research</h3>
    <div style="font-size: 14px; color: #4b5563;">${markdownToHtml(enrichment.webResearchSummary)}</div>
    ` : ""}
  </div>
  ` : ""}

  <div class="card">
    <h2>📊 Score Breakdown</h2>
    <div class="component">
      <span>Contact Quality</span>
      <span>${scoreBreakdown.components.contactQuality}/25</span>
    </div>
    <div class="component-bar"><div class="component-fill" style="width: ${(scoreBreakdown.components.contactQuality / 25) * 100}%"></div></div>

    <div class="component" style="margin-top: 8px;">
      <span>Property Match</span>
      <span>${scoreBreakdown.components.propertyMatch}/30</span>
    </div>
    <div class="component-bar"><div class="component-fill" style="width: ${(scoreBreakdown.components.propertyMatch / 30) * 100}%"></div></div>

    <div class="component" style="margin-top: 8px;">
      <span>Financial Signals</span>
      <span>${scoreBreakdown.components.financialSignals}/25</span>
    </div>
    <div class="component-bar"><div class="component-fill" style="width: ${(scoreBreakdown.components.financialSignals / 25) * 100}%"></div></div>

    <div class="component" style="margin-top: 8px;">
      <span>Engagement Signals</span>
      <span>${scoreBreakdown.components.engagementSignals}/20</span>
    </div>
    <div class="component-bar"><div class="component-fill" style="width: ${(scoreBreakdown.components.engagementSignals / 20) * 100}%"></div></div>

    <h3 style="margin-top: 16px;">Scoring Reasons</h3>
    ${scoreBreakdown.reasons.map((reason) => `<div class="reason">✓ ${reason}</div>`).join("")}
  </div>

  ${flags && (flags.possibleDuplicate || flags.missingCriticalInfo || flags.outsideServiceArea || flags.highValue || flags.quickResponse) ? `
  <div class="card">
    <h2>🚩 Flags</h2>
    ${flags.possibleDuplicate ? '<span class="flag">Possible Duplicate</span>' : ""}
    ${flags.missingCriticalInfo ? '<span class="flag">Missing Critical Info</span>' : ""}
    ${flags.outsideServiceArea ? '<span class="flag">Outside Service Area</span>' : ""}
    ${flags.highValue ? '<span class="flag positive">High Value</span>' : ""}
    ${flags.quickResponse ? '<span class="flag positive">Quick Response Needed</span>' : ""}
  </div>
  ` : ""}

  <div style="text-align: center; color: #9ca3af; font-size: 12px; margin-top: 20px;">
    Lead ID: ${report.leadId}<br>
    Generated at ${new Date().toISOString()}
  </div>
</body>
</html>
  `.trim();
}

/**
 * Render lead report as plain text (fallback)
 */
export function renderReportText(params: RenderReportParams): string {
  const { report, scoreBreakdown } = params;
  const { contact, property, enrichment } = report;

  const lines: string[] = [
    `=== NEW LEAD REPORT ===`,
    ``,
    `Score: ${scoreBreakdown.score}/100 (${scoreBreakdown.tier})`,
    `Status: ${report.businessStatus}`,
    `Source: ${report.source}`,
    ``,
    `--- CONTACT ---`,
    `Name: ${contact?.name || "N/A"}`,
    `Email: ${contact?.email || "N/A"}`,
    `Phone: ${contact?.phone || "N/A"}`,
    `Address: ${contact?.address || "N/A"}`,
  ];

  if (property) {
    lines.push(
      ``,
      `--- PROPERTY ---`,
      `Address: ${property.address || "N/A"}`,
      `Parcel ID: ${property.parcelId || "N/A"}`,
      `Assessed Value: ${formatCurrency(property.assessedValue)}`,
      `Market Value: ${formatCurrency(property.marketValue)}`,
      `Year Built: ${property.yearBuilt || "N/A"}`,
      `Bed/Bath: ${property.bedrooms || "?"}/${property.bathrooms || "?"}`
    );
  }

  if (enrichment?.demographics) {
    lines.push(
      ``,
      `--- DEMOGRAPHICS ---`,
      `Median Income: ${formatCurrency(enrichment.demographics.medianIncome)}`,
      `Median Home Value: ${formatCurrency(enrichment.demographics.medianHomeValue)}`
    );
  }

  lines.push(
    ``,
    `--- SCORE BREAKDOWN ---`,
    `Contact Quality: ${scoreBreakdown.components.contactQuality}/25`,
    `Property Match: ${scoreBreakdown.components.propertyMatch}/30`,
    `Financial Signals: ${scoreBreakdown.components.financialSignals}/25`,
    `Engagement Signals: ${scoreBreakdown.components.engagementSignals}/20`,
    ``,
    `Reasons:`,
    ...scoreBreakdown.reasons.map((r) => `  - ${r}`),
    ``,
    `Lead ID: ${report.leadId}`,
    `Generated: ${new Date().toISOString()}`
  );

  return lines.join("\n");
}

/**
 * Generate email subject line
 */
export function generateEmailSubject(report: RenderableReport, scoreBreakdown: ScoreBreakdown): string {
  const emoji = statusEmoji(report.businessStatus);
  const name = report.contact?.name || "Unknown Lead";
  return `${emoji} [${scoreBreakdown.tier}] New Lead: ${name} (Score: ${scoreBreakdown.score})`;
}
