/**
 * Resend email service
 */

import { Resend } from "resend";

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const REPORT_TO_EMAIL = process.env.REPORT_TO_EMAIL || "masonjames@gmail.com";
const REPORT_FROM_EMAIL = process.env.REPORT_FROM_EMAIL || "leads@notifications.example.com";

let resendClient: Resend | null = null;

function getResendClient(): Resend {
  if (!resendClient) {
    if (!RESEND_API_KEY) {
      throw new Error("RESEND_API_KEY environment variable is not set");
    }
    resendClient = new Resend(RESEND_API_KEY);
  }
  return resendClient;
}

export interface SendReportEmailParams {
  subject: string;
  html: string;
  text?: string;
  to?: string | string[];
  from?: string;
  replyTo?: string;
  tags?: Array<{ name: string; value: string }>;
}

export interface SendReportEmailResult {
  success: boolean;
  messageId?: string;
  error?: string;
}

/**
 * Send a lead report email via Resend
 */
export async function sendReportEmail(
  params: SendReportEmailParams
): Promise<SendReportEmailResult> {
  const {
    subject,
    html,
    text,
    to = REPORT_TO_EMAIL,
    from = REPORT_FROM_EMAIL,
    replyTo,
    tags,
  } = params;

  // Normalize recipients to array and filter out empty strings
  const recipients = (Array.isArray(to) ? to : [to]).filter(email => email && email.trim() !== '');

  if (recipients.length === 0) {
    return {
      success: false,
      error: "No valid recipients provided",
    };
  }

  try {
    const client = getResendClient();

    const response = await client.emails.send({
      from,
      to: recipients,
      subject,
      html,
      text,
      replyTo,
      tags,
    });

    if (response.error) {
      return {
        success: false,
        error: response.error.message,
      };
    }

    return {
      success: true,
      messageId: response.data?.id,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error sending email";
    console.error("[Resend] Error sending email:", message);
    return {
      success: false,
      error: message,
    };
  }
}

/**
 * Check if Resend is configured
 */
export function isResendConfigured(): boolean {
  return !!RESEND_API_KEY;
}

/**
 * Get the configured report recipient email
 */
export function getReportRecipient(): string {
  return REPORT_TO_EMAIL;
}
