/**
 * Inbound Lead Workflow Steps
 * Individual durable steps for the form lead enrichment pipeline
 */

import { enrichPaoByAddress } from "@/lib/enrichment/pao";
import { enrichWithExa } from "@/lib/enrichment/exa";
import { getDemographicInsights } from "@/lib/enrichment/demographics";
import {
  calculateLeadScore,
  tierToBusinessStatus,
  type ScoreBreakdown,
} from "@/lib/scoring";
import { sendReportEmail, isResendConfigured } from "@/lib/email/resend";
import {
  renderReportHtml,
  renderReportText,
  generateEmailSubject,
} from "@/lib/report/render";
import type { FormSchema } from "@/lib/types";

/**
 * Parse income string like "$65,000" or "$65,000 (estimate)" to number
 */
function parseIncomeString(value?: string): number | undefined {
  if (!value) return undefined;
  const match = value.match(/\$?([\d,]+)/);
  if (!match) return undefined;
  return parseInt(match[1].replace(/,/g, ""), 10);
}

// Internal simplified report type for workflow processing
export interface WorkflowReport {
  leadId: string;
  source: "FORM";
  processingStatus: string;
  businessStatus: string;
  receivedAt: string;
  contact?: {
    name?: string;
    email?: string;
    phone?: string;
    address?: string;
  };
  formData?: {
    company?: string;
    message?: string;
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
    calculatedAt: string;
  };
  flags?: {
    possibleDuplicate?: boolean;
    missingCriticalInfo?: boolean;
    outsideServiceArea?: boolean;
    highValue?: boolean;
    quickResponse?: boolean;
  };
  provenance?: Record<string, unknown>;
}

/**
 * Step: Initialize lead report from form data
 */
export const stepInitializeReport = async (
  data: FormSchema,
  leadId: string
): Promise<WorkflowReport> => {
  "use step";

  const report: WorkflowReport = {
    leadId,
    source: "FORM",
    processingStatus: "RECEIVED",
    businessStatus: "UNKNOWN",
    receivedAt: new Date().toISOString(),
    contact: {
      name: data.name,
      email: data.email,
      phone: data.phone || undefined,
      address: data.address || undefined,
    },
    formData: {
      company: data.company || undefined,
      message: data.message,
    },
    provenance: {
      contact: {
        source: "form_submission",
        fetchedAt: new Date().toISOString(),
        confidence: 1,
      },
    },
  };

  console.log(`[Inbound Workflow] Initialized report for lead ${leadId}`);
  return report;
};

/**
 * Step: Enrich with PAO property data
 */
export const stepEnrichPao = async (
  report: WorkflowReport
): Promise<WorkflowReport> => {
  "use step";

  const address = report.contact?.address;

  if (!address) {
    console.log(`[Inbound Workflow] No address provided, skipping PAO enrichment`);
    return {
      ...report,
      provenance: {
        ...report.provenance,
        property: {
          source: "pao_skipped",
          fetchedAt: new Date().toISOString(),
          confidence: 0,
          reason: "No address provided",
        },
      },
    };
  }

  console.log(`[Inbound Workflow] Enriching PAO for address: ${address}`);

  const paoResult = await enrichPaoByAddress({
    address,
    timeoutMs: 60000,
    navTimeoutMs: 30000,
  });

  if (paoResult.status === "SUCCESS" && paoResult.property) {
    // Convert to our workflow property format
    const prop = paoResult.property;
    const workflowProperty: WorkflowReport["property"] = {
      parcelId: prop.parcelId,
      address: prop.address,
      owner: prop.owner,
      yearBuilt: prop.yearBuilt ?? prop.building?.yearBuilt,
      bedrooms: prop.bedrooms ?? prop.building?.bedrooms,
      bathrooms: prop.bathrooms ?? prop.building?.bathrooms,
      assessedValue: prop.assessedValue ?? prop.valuations?.[0]?.assessed?.total,
      marketValue: prop.marketValue ?? prop.valuations?.[0]?.just?.total,
      building: prop.building ? { livingArea: prop.building.livingAreaSqFt } : undefined,
      salesHistory: prop.salesHistory?.map((s) => ({
        saleDate: s.date,
        salePrice: s.price,
        qualified: s.qualified,
      })),
    };

    console.log(`[Inbound Workflow] PAO enrichment successful for ${prop.address}`);

    return {
      ...report,
      property: workflowProperty,
      provenance: {
        ...report.provenance,
        property: paoResult.provenance,
      },
    };
  }

  console.log(`[Inbound Workflow] PAO enrichment failed or skipped: ${paoResult.error || paoResult.status}`);

  return {
    ...report,
    provenance: {
      ...report.provenance,
      property: paoResult.provenance,
    },
  };
};

/**
 * Step: Enrich with Exa web research
 */
export const stepEnrichExa = async (
  report: WorkflowReport
): Promise<WorkflowReport> => {
  "use step";

  const contact = report.contact;

  console.log(`[Inbound Workflow] Running Exa enrichment for ${contact?.name || "unknown"}`);

  const exaResult = await enrichWithExa({
    name: contact?.name,
    email: contact?.email,
    phone: contact?.phone,
    address: contact?.address,
    location: "Manatee County, Florida",
  });

  if (exaResult.status === "SUCCESS" && exaResult.data) {
    // Convert Exa sources to public profiles format
    const publicProfiles = exaResult.data.sources.map((source) => ({
      source: "exa",
      url: source.url,
      name: source.title,
      headline: source.snippet,
    }));

    console.log(`[Inbound Workflow] Exa enrichment found ${publicProfiles.length} sources`);

    return {
      ...report,
      enrichment: {
        ...report.enrichment,
        publicProfiles,
        webResearchSummary: exaResult.data.summaryMarkdown,
      },
      provenance: {
        ...report.provenance,
        webResearch: exaResult.provenance,
      },
    };
  }

  console.log(`[Inbound Workflow] Exa enrichment failed or skipped: ${exaResult.error || exaResult.status}`);

  return {
    ...report,
    provenance: {
      ...report.provenance,
      webResearch: exaResult.provenance,
    },
  };
};

/**
 * Step: Enrich with demographics data
 */
export const stepEnrichDemographics = async (
  report: WorkflowReport
): Promise<WorkflowReport> => {
  "use step";

  // Extract zip code from address
  const address = report.contact?.address || report.property?.address || "";
  const zipMatch = address.match(/\b(\d{5})(?:-\d{4})?\b/);
  const zipCode = zipMatch?.[1];

  console.log(`[Inbound Workflow] Getting demographics for ZIP: ${zipCode || "unknown"}`);

  const demoResult = await getDemographicInsights({
    zipCode,
    city: "Bradenton",
    state: "FL",
    propertyValue: report.property?.marketValue || report.property?.assessedValue,
  });

  if (demoResult.status === "SUCCESS" && demoResult.data) {
    // Convert DemographicInsights to our enrichment format
    const demographics = {
      medianIncome: parseIncomeString(demoResult.data.medianHouseholdIncome),
      medianHomeValue: parseIncomeString(demoResult.data.medianHomeValue),
      populationDensity: demoResult.data.populationDensity,
    };

    console.log(`[Inbound Workflow] Demographics enrichment successful`);

    return {
      ...report,
      enrichment: {
        ...report.enrichment,
        demographics,
      },
      provenance: {
        ...report.provenance,
        demographics: demoResult.provenance,
      },
    };
  }

  console.log(`[Inbound Workflow] Demographics enrichment failed or skipped`);

  return {
    ...report,
    provenance: {
      ...report.provenance,
      demographics: demoResult.provenance,
    },
  };
};

/**
 * Step: Calculate lead score and assign business status
 */
export const stepScoreLead = async (
  report: WorkflowReport
): Promise<{ report: WorkflowReport; scoreBreakdown: ScoreBreakdown }> => {
  "use step";

  console.log(`[Inbound Workflow] Scoring lead ${report.leadId}`);

  // Build scoring input from report
  const contact = report.contact;
  const property = report.property;
  const enrichment = report.enrichment;

  // Check for recent sale in property history
  const hasRecentSale = property?.salesHistory?.some((sale) => {
    if (!sale.saleDate) return false;
    const saleDate = new Date(sale.saleDate);
    const twoYearsAgo = new Date();
    twoYearsAgo.setFullYear(twoYearsAgo.getFullYear() - 2);
    return saleDate > twoYearsAgo;
  });

  // Calculate years owned from earliest sale
  let yearsOwned: number | undefined;
  if (property?.salesHistory?.length) {
    const sortedSales = [...property.salesHistory]
      .filter((s) => s.saleDate)
      .sort((a, b) => new Date(a.saleDate!).getTime() - new Date(b.saleDate!).getTime());
    if (sortedSales.length > 0) {
      const firstSale = new Date(sortedSales[sortedSales.length - 1].saleDate!);
      yearsOwned = (Date.now() - firstSale.getTime()) / (1000 * 60 * 60 * 24 * 365);
    }
  }

  // Determine if in target area (Manatee County)
  const isLocalArea =
    contact?.address?.toLowerCase().includes("manatee") ||
    contact?.address?.toLowerCase().includes("bradenton") ||
    contact?.address?.toLowerCase().includes("palmetto") ||
    contact?.address?.toLowerCase().includes("lakewood ranch") ||
    property?.address?.toLowerCase().includes("manatee") ||
    property?.address?.toLowerCase().includes("fl 34") ||
    // Also check message for location mentions
    report.formData?.message?.toLowerCase().includes("manatee") ||
    report.formData?.message?.toLowerCase().includes("bradenton");

  // Count filled fields for form completeness
  const totalFields = 6; // email, name, phone, company, address, message
  let filledFields = 0;
  if (contact?.name) filledFields++;
  if (contact?.email) filledFields++;
  if (contact?.phone) filledFields++;
  if (contact?.address) filledFields++;
  if (report.formData?.company) filledFields++;
  if (report.formData?.message) filledFields++;

  const scoringInput = {
    hasEmail: !!contact?.email,
    hasPhone: !!contact?.phone,
    hasAddress: !!contact?.address || !!property?.address,
    hasFullName: !!contact?.name && contact.name.includes(" "),
    property: property,
    propertyInTargetArea: isLocalArea,
    estimatedHomeValue: property?.marketValue || property?.assessedValue,
    medianIncomeZip: enrichment?.demographics?.medianIncome,
    hasRecentSale,
    yearsOwned,
    formCompleteness: filledFields / totalFields,
    isLocalArea,
    hasPublicProfile: !!enrichment?.publicProfiles?.length,
  };

  const scoreBreakdown = calculateLeadScore(scoringInput);

  // Determine business status
  const businessStatus = tierToBusinessStatus(scoreBreakdown.tier, isLocalArea ?? false);

  // Set flags based on score and data
  const flags = {
    possibleDuplicate: false,
    missingCriticalInfo: !contact?.email && !contact?.phone,
    outsideServiceArea: !isLocalArea,
    highValue: scoreBreakdown.score >= 70,
    quickResponse: scoreBreakdown.tier === "HOT",
  };

  const updatedReport: WorkflowReport = {
    ...report,
    processingStatus: "ENRICHED",
    businessStatus,
    score: {
      value: scoreBreakdown.score,
      tier: scoreBreakdown.tier,
      reasons: scoreBreakdown.reasons,
      calculatedAt: new Date().toISOString(),
    },
    flags,
  };

  console.log(
    `[Inbound Workflow] Lead scored: ${scoreBreakdown.score} (${scoreBreakdown.tier}), status: ${businessStatus}`
  );

  return { report: updatedReport, scoreBreakdown };
};

/**
 * Step: Send comprehensive report email
 */
export const stepSendReportEmail = async (
  report: WorkflowReport,
  scoreBreakdown: ScoreBreakdown
): Promise<{ success: boolean; messageId?: string; error?: string }> => {
  "use step";

  if (!isResendConfigured()) {
    console.log(`[Inbound Workflow] Resend not configured, skipping email`);
    return { success: false, error: "RESEND_API_KEY not configured" };
  }

  console.log(`[Inbound Workflow] Sending report email for lead ${report.leadId}`);

  // Convert to LeadReport format for rendering
  const renderReport = {
    leadId: report.leadId,
    source: report.source as "FORM",
    processingStatus: report.processingStatus as "ENRICHED",
    businessStatus: report.businessStatus as "HOT" | "WARM" | "NURTURE" | "NOT_LOCAL" | "UNKNOWN",
    receivedAt: report.receivedAt,
    contact: report.contact,
    property: report.property,
    enrichment: report.enrichment,
    score: report.score ? {
      value: report.score.value,
      tier: report.score.tier as "HOT" | "WARM" | "NURTURE" | "COLD",
      reasons: report.score.reasons,
    } : undefined,
    flags: report.flags,
  };

  const subject = generateEmailSubject(renderReport as any, scoreBreakdown);
  const html = renderReportHtml({ report: renderReport as any, scoreBreakdown });
  const text = renderReportText({ report: renderReport as any, scoreBreakdown });

  const result = await sendReportEmail({
    subject,
    html,
    text,
    tags: [
      { name: "lead_id", value: report.leadId },
      { name: "tier", value: scoreBreakdown.tier },
      { name: "source", value: report.source },
    ],
  });

  if (result.success) {
    console.log(`[Inbound Workflow] Email sent successfully: ${result.messageId}`);
  } else {
    console.error(`[Inbound Workflow] Email failed: ${result.error}`);
  }

  return result;
};
