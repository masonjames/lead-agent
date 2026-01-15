/**
 * Meta Lead Workflow
 * Durable workflow for processing Facebook Lead Ads
 *
 * Pipeline:
 * 1. Initialize report from Meta leadgen data
 * 2. Enrich with PAO property data (Manatee County)
 * 3. Enrich with Exa web research
 * 4. Enrich with demographics
 * 5. Score lead and assign business status
 * 6. Send report email
 */

import type { MetaLeadWorkflowInput } from "@/lib/types";
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

export interface MetaLeadWorkflowResult {
  success: boolean;
  report: WorkflowReport;
  emailSent: boolean;
  emailMessageId?: string;
  error?: string;
}

/**
 * Main workflow for Meta (Facebook) lead processing
 *
 * This workflow is designed to be durable - each step is checkpointed
 * and can resume from the last successful step on retry.
 */
export const workflowMetaLead = async (
  input: MetaLeadWorkflowInput
): Promise<MetaLeadWorkflowResult> => {
  "use workflow";

  console.log(`[Meta Workflow] Starting workflow for leadgen ${input.leadgenId}`);

  try {
    // Step 1: Initialize the lead report
    let report = await stepInitializeReport(input);

    // Step 2: Update status to enriching
    report = { ...report, processingStatus: "ENRICHING" };

    // Step 3: Enrich with PAO data (property lookup)
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

    // Step 7: Send report email
    const emailResult = await stepSendReportEmail(report, scoreBreakdown);

    console.log(
      `[Meta Workflow] Completed workflow for ${report.leadId}, ` +
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
    console.error(`[Meta Workflow] Workflow failed:`, message);

    // Return partial result with failure status
    return {
      success: false,
      report: {
        leadId: `meta-${input.leadgenId}-failed`,
        source: "META",
        processingStatus: "FAILED_ENRICHMENT",
        businessStatus: "UNKNOWN",
        receivedAt: new Date().toISOString(),
        contact: {
          name: input.name,
          email: input.email,
          phone: input.phone,
          address: input.address,
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
