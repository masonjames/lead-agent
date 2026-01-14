import { FormSchema } from '@/lib/types';
import {
  stepQualify,
  stepResearch,
  stepWriteEmail,
  stepSendInboundReportEmail
} from './steps';

/**
 * workflow to handle the inbound lead
 * - research the lead
 * - qualify the lead
 * - if the lead is qualified or follow up:
 *   - write an email for the lead
 *   - send internal report email automatically
 * - if the lead is not qualified or follow up:
 *   - take other actions here based on other qualification categories
 */
export const workflowInbound = async (data: FormSchema) => {
  'use workflow';

  const research = await stepResearch(data);
  const qualification = await stepQualify(data, research);

  if (
    qualification.category === 'QUALIFIED' ||
    qualification.category === 'FOLLOW_UP'
  ) {
    const email = await stepWriteEmail(research, qualification);

    // Send internal report email automatically
    const emailResult = await stepSendInboundReportEmail(data, qualification, research);
    console.log('[Inbound Workflow] Report email sent:', emailResult.success ? emailResult.messageId : emailResult.error);
  }

  // take other actions here based on other qualification categories
};
