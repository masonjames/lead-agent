/**
 * Meta Graph API Client
 * 
 * Fetches lead details from Meta's Graph API using the leadgen_id.
 */

export interface MetaLeadFieldData {
  name: string;
  values?: string[];
}

export interface MetaLeadgenResponse {
  id: string;
  created_time?: string;
  ad_id?: string;
  form_id?: string;
  page_id?: string;
  field_data?: MetaLeadFieldData[];
  is_organic?: boolean;
  campaign_id?: string;
  adset_id?: string;
}

export interface MetaGraphError {
  message: string;
  type: string;
  code: number;
  error_subcode?: number;
  fbtrace_id?: string;
}

/**
 * Fetch lead details from Meta Graph API
 * 
 * Requires META_ACCESS_TOKEN environment variable (Page Access Token)
 * 
 * @param leadgenId - The leadgen_id from the webhook
 * @returns Lead data including field_data with form responses
 */
export async function fetchMetaLeadgen(leadgenId: string): Promise<MetaLeadgenResponse> {
  const accessToken = process.env.META_ACCESS_TOKEN;
  
  if (!accessToken) {
    throw new Error("META_ACCESS_TOKEN environment variable is not set");
  }

  const url = new URL(`https://graph.facebook.com/v19.0/${leadgenId}`);
  url.searchParams.set("access_token", accessToken);
  url.searchParams.set(
    "fields",
    "id,created_time,ad_id,form_id,page_id,field_data,is_organic,campaign_id,adset_id"
  );

  console.log(`[Meta Graph] Fetching lead ${leadgenId}...`);

  const response = await fetch(url.toString(), {
    method: "GET",
    headers: {
      "Accept": "application/json",
    },
  });

  const data = await response.json();

  if (!response.ok) {
    const error = data.error as MetaGraphError;
    console.error(`[Meta Graph] Error fetching lead ${leadgenId}:`, error);
    throw new Error(
      `Meta Graph API error: ${error?.message || "Unknown error"} (code: ${error?.code || "unknown"})`
    );
  }

  console.log(`[Meta Graph] Successfully fetched lead ${leadgenId} with ${data.field_data?.length || 0} fields`);

  return data as MetaLeadgenResponse;
}

/**
 * Fetch form details to understand field labels
 * 
 * @param formId - The form_id from the lead
 * @returns Form data including questions
 */
export async function fetchMetaLeadForm(formId: string): Promise<{
  id: string;
  name?: string;
  questions?: Array<{
    key: string;
    label: string;
    type: string;
  }>;
}> {
  const accessToken = process.env.META_ACCESS_TOKEN;
  
  if (!accessToken) {
    throw new Error("META_ACCESS_TOKEN environment variable is not set");
  }

  const url = new URL(`https://graph.facebook.com/v19.0/${formId}`);
  url.searchParams.set("access_token", accessToken);
  url.searchParams.set("fields", "id,name,questions");

  const response = await fetch(url.toString(), {
    method: "GET",
    headers: {
      "Accept": "application/json",
    },
  });

  const data = await response.json();

  if (!response.ok) {
    const error = data.error as MetaGraphError;
    console.error(`[Meta Graph] Error fetching form ${formId}:`, error);
    throw new Error(
      `Meta Graph API error: ${error?.message || "Unknown error"} (code: ${error?.code || "unknown"})`
    );
  }

  return data;
}
