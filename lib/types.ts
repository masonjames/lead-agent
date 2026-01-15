import { z } from 'zod';

/**
 * Lead schema
 */

export const formSchema = z.object({
  email: z.email('Please enter a valid email address.'),
  name: z
    .string()
    .min(2, 'Name is required')
    .max(50, 'Name must be at most 50 characters.'),
  phone: z
    .string()
    .regex(/^[\d\s\-\+\(\)]+$/, 'Please enter a valid phone number.')
    .min(10, 'Phone number must be at least 10 digits.')
    .optional()
    .or(z.literal('')),
  company: z.string().optional().or(z.literal('')),
  address: z
    .string()
    .min(10, 'Please enter a complete property address.')
    .max(200, 'Address must be less than 200 characters.')
    .optional()
    .or(z.literal('')),
  recipientEmail: z
    .string()
    .email('Please enter a valid email address.')
    .optional()
    .or(z.literal('')),
  message: z
    .string()
    .max(500, 'Message must be less than 500 characters.')
    .optional()
    .or(z.literal(''))
});

export type FormSchema = z.infer<typeof formSchema>;

/**
 * Qualification schema
 */

export const qualificationCategorySchema = z.enum([
  'QUALIFIED',
  'UNQUALIFIED',
  'SUPPORT',
  'FOLLOW_UP'
]);

export const qualificationSchema = z.object({
  category: qualificationCategorySchema,
  reason: z.string()
});

export type QualificationSchema = z.infer<typeof qualificationSchema>;

// ============================================================================
// Lead Report Schemas (for Meta Lead Enrichment)
// ============================================================================

/**
 * Lead source identifier
 */
export const leadSourceSchema = z.enum(['FORM', 'META']);
export type LeadSource = z.infer<typeof leadSourceSchema>;

/**
 * Processing status - tracks workflow progress
 */
export const processingStatusSchema = z.enum([
  'RECEIVED',           // Initial webhook received
  'ENRICHING',          // Enrichment in progress
  'ENRICHED',           // Enrichment complete
  'FAILED_ENRICHMENT',  // Enrichment failed (partial data may exist)
  'NEEDS_MANUAL_REVIEW', // Requires human attention
  'DUPLICATE_IGNORED',  // Duplicate lead, skipped
]);
export type ProcessingStatus = z.infer<typeof processingStatusSchema>;

/**
 * Business status - lead qualification/prioritization
 */
export const businessStatusSchema = z.enum([
  'HOT',            // High priority, ready to contact
  'WARM',           // Good lead, needs nurturing
  'NURTURE',        // Long-term follow-up
  'NOT_LOCAL',      // Outside service area (Manatee County)
  'SPAM_OR_BOT',    // Suspected spam or bot submission
  'DO_NOT_CONTACT', // Opted out or do not contact flag
  'UNKNOWN',        // Not yet classified
]);
export type BusinessStatus = z.infer<typeof businessStatusSchema>;

/**
 * Enrichment status for individual data sources
 */
export const enrichmentStatusSchema = z.enum(['PENDING', 'SUCCESS', 'SKIPPED', 'FAILED']);
export type EnrichmentStatus = z.infer<typeof enrichmentStatusSchema>;

/**
 * Provenance tracking for data fields
 */
export const provenanceSchema = z.object({
  value: z.unknown(),
  sourceUrlOrName: z.string().optional(),
  method: z.string().optional(),
  confidence: z.number().min(0).max(1),
  timestamp: z.string().optional(),
});
export type Provenance = z.infer<typeof provenanceSchema>;

/**
 * Lead score with tier and explanation
 */
export const leadScoreSchema = z.object({
  score: z.number().min(0).max(100),
  tier: businessStatusSchema,
  reasons: z.array(z.string()).default([]),
});
export type LeadScore = z.infer<typeof leadScoreSchema>;

/**
 * Meta lead reference (from webhook)
 */
export const metaLeadRefSchema = z.object({
  leadgenId: z.string(),
  formId: z.string().optional(),
  pageId: z.string().optional(),
  adId: z.string().optional(),
  createdTime: z.number().optional(),
});
export type MetaLeadRef = z.infer<typeof metaLeadRefSchema>;

/**
 * Contact information
 */
export const contactSchema = z.object({
  name: z.string().optional(),
  email: z.string().optional(),
  phone: z.string().optional(),
});
export type Contact = z.infer<typeof contactSchema>;

/**
 * Property context from lead
 */
export const propertyContextSchema = z.object({
  address: z.string().optional(),
  city: z.string().optional(),
  state: z.string().optional(),
  zipCode: z.string().optional(),
});
export type PropertyContext = z.infer<typeof propertyContextSchema>;

/**
 * Enrichment section for each data source
 */
export const enrichmentSectionSchema = z.object({
  status: enrichmentStatusSchema,
  data: z.unknown().optional(),
  error: z.string().optional(),
  provenance: provenanceSchema.optional(),
});
export type EnrichmentSection = z.infer<typeof enrichmentSectionSchema>;

/**
 * Complete enrichment data
 */
export const enrichmentDataSchema = z.object({
  pao: enrichmentSectionSchema.default({ status: 'PENDING' }),
  exa: enrichmentSectionSchema.default({ status: 'PENDING' }),
  demographics: enrichmentSectionSchema.default({ status: 'PENDING' }),
  stellarRealist: enrichmentSectionSchema.default({ status: 'PENDING' }),
});
export type EnrichmentData = z.infer<typeof enrichmentDataSchema>;

/**
 * Rendered report content
 */
export const reportContentSchema = z.object({
  markdown: z.string().optional(),
  html: z.string().optional(),
  json: z.unknown().optional(),
});
export type ReportContent = z.infer<typeof reportContentSchema>;

/**
 * Complete Lead Report schema
 */
export const leadReportSchema = z.object({
  // Identification
  leadId: z.string(),
  source: leadSourceSchema,
  
  // Status tracking
  processingStatus: processingStatusSchema,
  businessStatus: businessStatusSchema.default('UNKNOWN'),
  
  // Timestamps
  receivedAt: z.string(),
  updatedAt: z.string(),
  
  // Raw ingestion data
  meta: metaLeadRefSchema.optional(),
  rawWebhook: z.unknown().optional(),
  
  // Normalized lead info
  contact: contactSchema.default({}),
  property: propertyContextSchema.default({}),
  
  // Enrichment results
  enrichment: enrichmentDataSchema.default({
    pao: { status: 'PENDING' },
    exa: { status: 'PENDING' },
    demographics: { status: 'PENDING' },
    stellarRealist: { status: 'PENDING' },
  }),
  
  // Scoring
  score: leadScoreSchema.optional(),
  
  // Final report
  report: reportContentSchema.default({}),
  
  // Flags
  flags: z.object({
    isDuplicate: z.boolean().default(false),
    needsManualReview: z.boolean().default(false),
    missingCriticalData: z.boolean().default(false),
    doNotContact: z.boolean().default(false),
    spamLikelihood: z.number().min(0).max(1).default(0),
  }).optional(),
});

export type LeadReport = z.infer<typeof leadReportSchema>;

/**
 * Meta Lead Workflow Input
 */
export const metaLeadWorkflowInputSchema = z.object({
  leadgenId: z.string(),
  formId: z.string().optional(),
  pageId: z.string().optional(),
  adId: z.string().optional(),
  createdTime: z.number().optional(),
  rawWebhook: z.unknown().optional(),
  // Normalized contact info from Meta leadgen
  name: z.string().optional(),
  email: z.string().optional(),
  phone: z.string().optional(),
  address: z.string().optional(),
});

export type MetaLeadWorkflowInput = z.infer<typeof metaLeadWorkflowInputSchema>;
