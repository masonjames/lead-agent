/**
 * Inbound Lead Workflow
 * Durable workflow for processing form submissions
 *
 * Pipeline:
 * 1. Initialize report from form data
 * 2. Enrich with PAO property data (Manatee County) if address provided
 * 3. Enrich with Exa web research
 * 4. Enrich with demographics
 * 5. Score lead and assign business status
 * 6. Send comprehensive report email
 */

import type { FormSchema } from "@/lib/types";
import {
  stepInitializeReport,
  stepEnrichPao,
  stepEnrichStellarRealist,
  stepEnrichExa,
  stepEnrichDemographics,
  stepScoreLead,
  stepSendReportEmail,
  type WorkflowReport,
} from "./steps";

export interface InboundWorkflowResult {
  success: boolean;
  report: WorkflowReport;
  emailSent: boolean;
  emailMessageId?: string;
  error?: string;
}

/**
 * Main workflow for inbound form lead processing
 *
 * This workflow mirrors the Meta lead workflow to provide
 * the same comprehensive enrichment and reporting.
 */
export const workflowInbound = async (
  data: FormSchema
): Promise<InboundWorkflowResult> => {
  "use workflow";

  const leadId = `form-${Date.now()}`;
  console.log(`[Inbound Workflow] Starting workflow for form lead ${leadId}`);

  try {
    // Step 1: Initialize the lead report from form data
    let report = await stepInitializeReport(data, leadId);

    // Step 2: Update status to enriching
    report = { ...report, processingStatus: "ENRICHING" };

    // Step 3: Enrich with PAO data (property lookup) if address provided
    report = await stepEnrichPao(report);

    // Step 4: Enrich with StellarMLS (Realist)
    report = await stepEnrichStellarRealist(report);

    // Step 5: Enrich with Exa web research
    report = await stepEnrichExa(report);

    // Step 6: Enrich with demographics
    report = await stepEnrichDemographics(report);

    // Step 7: Score and assign business status
    const { report: scoredReport, scoreBreakdown } = await stepScoreLead(report);
    report = scoredReport;

    // Step 7: Send comprehensive report email
    const emailResult = await stepSendReportEmail(report, scoreBreakdown);

    console.log(
      `[Inbound Workflow] Completed workflow for ${report.leadId}, ` +
        `score: ${report.score?.value}, status: ${report.businessStatus}`
    );

    return {
      success: true,
      report,
      emailSent: emailResult.success,
      emailMessageId: emailResult.messageId,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown workflow error";
    console.error(`[Inbound Workflow] Workflow failed:`, message);

    // Return partial result with failure status
    return {
      success: false,
      report: {
        leadId,
        source: "FORM",
        processingStatus: "FAILED_ENRICHMENT",
        businessStatus: "UNKNOWN",
        receivedAt: new Date().toISOString(),
        contact: {
          name: data.name,
          email: data.email,
          phone: data.phone || undefined,
          address: data.address || undefined,
        },
      },
      emailSent: false,
      error: message,
    };
  }
};

// Re-export steps for testing
export {
  stepInitializeReport,
  stepEnrichPao,
  stepEnrichStellarRealist,
  stepEnrichExa,
  stepEnrichDemographics,
  stepScoreLead,
  stepSendReportEmail,
} from "./steps";
