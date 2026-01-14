import {
  qualify,
  researchAgent,
  writeEmail
} from '@/lib/services';
import { FormSchema, QualificationSchema } from '@/lib/types';
import { sendReportEmail, isResendConfigured } from '@/lib/email/resend';

/**
 * step to qualify the lead
 */
export const stepQualify = async (data: FormSchema, research: string) => {
  'use step';

  const qualification = await qualify(data, research);
  return qualification;
};

/**
 * step to research the lead
 */
export const stepResearch = async (data: FormSchema) => {
  'use step';

  const { text: research } = await researchAgent.generate({
    prompt: `Research the lead: ${JSON.stringify(data)}`
  });

  return research;
};

/**
 * step to write an email for the lead
 */
export const stepWriteEmail = async (
  research: string,
  qualification: QualificationSchema
) => {
  'use step';

  const email = await writeEmail(research, qualification);
  return email;
};

/**
 * step to send internal report email for inbound form leads
 */
export const stepSendInboundReportEmail = async (
  data: FormSchema,
  qualification: QualificationSchema,
  research: string
): Promise<{ success: boolean; messageId?: string; error?: string }> => {
  'use step';

  if (!isResendConfigured()) {
    console.log('[Inbound Workflow] Resend not configured, skipping email');
    return { success: false, error: 'RESEND_API_KEY not configured' };
  }

  const leadId = `form-${Date.now()}`;
  const isQualified = qualification.category === 'QUALIFIED';
  const tierEmoji = isQualified ? '🔥' : qualification.category === 'FOLLOW_UP' ? '☀️' : '❓';

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #1f2937; max-width: 600px; margin: 0 auto; padding: 20px; }
    .card { background: white; border-radius: 8px; padding: 20px; margin-bottom: 16px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
    .header { text-align: center; border-bottom: 1px solid #e5e7eb; padding-bottom: 16px; margin-bottom: 16px; }
    h1 { margin: 0; font-size: 24px; }
    h2 { margin: 0 0 12px 0; font-size: 18px; color: #374151; }
    .badge { display: inline-block; background: ${isQualified ? '#dc2626' : '#f59e0b'}; color: white; padding: 4px 12px; border-radius: 4px; font-weight: bold; }
    .label { color: #6b7280; font-size: 12px; text-transform: uppercase; }
    .value { font-size: 16px; margin-bottom: 12px; }
  </style>
</head>
<body>
  <div class="card header">
    <h1>${tierEmoji} Form Lead: ${data.name}</h1>
    <span class="badge">${qualification.category}</span>
  </div>
  <div class="card">
    <h2>Contact Information</h2>
    <div class="label">Name</div>
    <div class="value">${data.name}</div>
    <div class="label">Email</div>
    <div class="value"><a href="mailto:${data.email}">${data.email}</a></div>
    ${data.phone ? `<div class="label">Phone</div><div class="value"><a href="tel:${data.phone}">${data.phone}</a></div>` : ''}
    ${data.company ? `<div class="label">Company</div><div class="value">${data.company}</div>` : ''}
    <div class="label">Message</div>
    <div class="value">${data.message}</div>
  </div>
  <div class="card">
    <h2>Qualification</h2>
    <div class="label">Category</div>
    <div class="value">${qualification.category}</div>
    <div class="label">Reason</div>
    <div class="value">${qualification.reason}</div>
  </div>
  <div class="card">
    <h2>Research Summary</h2>
    <div class="value" style="white-space: pre-wrap;">${research.slice(0, 1000)}${research.length > 1000 ? '...' : ''}</div>
  </div>
  <div style="text-align: center; color: #9ca3af; font-size: 12px; margin-top: 20px;">
    Lead ID: ${leadId} | Source: FORM<br>
    Generated at ${new Date().toISOString()}
  </div>
</body>
</html>
  `.trim();

  const text = `
NEW FORM LEAD: ${data.name}
Category: ${qualification.category}

CONTACT:
Name: ${data.name}
Email: ${data.email}
${data.phone ? `Phone: ${data.phone}` : ''}
${data.company ? `Company: ${data.company}` : ''}
Message: ${data.message}

QUALIFICATION:
${qualification.reason}

Lead ID: ${leadId}
  `.trim();

  const result = await sendReportEmail({
    subject: `${tierEmoji} [${qualification.category}] Form Lead: ${data.name}`,
    html,
    text,
    tags: [
      { name: 'lead_id', value: leadId },
      { name: 'category', value: qualification.category },
      { name: 'source', value: 'FORM' },
    ],
  });

  return result;
};
