/**
 * legal.ts — P0 Compliance: 隱私政策與服務條款靜態路由
 *
 * 提供機器可讀的法律文件端點（JSON 格式）。
 * 正式上線前應由法律顧問審閱文字內容並替換 placeholder。
 */

import type { Express, Request, Response } from 'express';

const LAST_UPDATED = '2026-03-05';
const COMPANY_NAME = 'Pegn-AI';
const CONTACT_EMAIL = 'legal@pegn.ai'; // TODO: replace with actual contact
const DPA_AVAILABLE = true;

export function registerLegalRoutes(app: Express): void {
  /**
   * GET /api/v1/legal/privacy
   * Machine-readable privacy policy summary.
   */
  app.get('/api/v1/legal/privacy', (_req: Request, res: Response) => {
    res.json({
      document: 'privacy_policy',
      company: COMPANY_NAME,
      last_updated: LAST_UPDATED,
      contact: CONTACT_EMAIL,
      summary: {
        data_collected: [
          'Email address and name (account registration)',
          'Usage analytics (GA4, if consent granted)',
          'Document content you create (stored encrypted at rest)',
          'Session tokens (JWT, stored in memory / localStorage)',
          'IP address and user-agent (server logs, 90-day retention)',
        ],
        data_retention: {
          account_data: 'Retained until account deletion request',
          server_logs: '90 days',
          usage_analytics: '14 months (Google Analytics default)',
          deleted_documents: 'Soft-deleted, purged within 30 days',
        },
        user_rights: [
          'Right to access your data (GET /api/v1/auth/me)',
          'Right to delete your account and data (DELETE /api/v1/auth/account)',
          'Right to opt out of analytics (decline cookies)',
          'Right to export your workspace data (GET /api/v1/collections/:id/export)',
        ],
        third_parties: [
          { name: 'Google Gemini', purpose: 'AI generation', data_shared: 'Prompt content (no PII)' },
          { name: 'OpenAI', purpose: 'AI generation (fallback)', data_shared: 'Prompt content (no PII)' },
          { name: 'Anthropic Claude', purpose: 'AI generation (fallback)', data_shared: 'Prompt content (no PII)' },
          { name: 'Google Analytics 4', purpose: 'Usage analytics', data_shared: 'Anonymized usage events (if consented)' },
          { name: 'Google Cloud Platform', purpose: 'Hosting & infrastructure', data_shared: 'All application data (region: asia-east1)' },
          { name: 'Stripe', purpose: 'Payment processing', data_shared: 'Billing contact info only' },
        ],
        cookies: {
          necessary: ['pegn-token (JWT session)', 'pegn-theme (UI preference)'],
          analytics: ['_ga (Google Analytics, only if consented)'],
        },
      },
      // placeholder — replace with link to full legal document
      full_document_url: 'https://pegn.ai/privacy',
    });
  });

  /**
   * GET /api/v1/legal/terms
   * Machine-readable terms of service summary.
   */
  app.get('/api/v1/legal/terms', (_req: Request, res: Response) => {
    res.json({
      document: 'terms_of_service',
      company: COMPANY_NAME,
      last_updated: LAST_UPDATED,
      contact: CONTACT_EMAIL,
      summary: {
        service_description: `${COMPANY_NAME} is an AI-native collaborative knowledge management platform.`,
        acceptable_use: [
          'You must be at least 18 years old to use this service.',
          'You may not use the service to generate or distribute harmful, illegal, or deceptive content.',
          'You may not attempt to reverse-engineer, scrape, or abuse the AI endpoints.',
          'You are responsible for the content you create and share in your workspace.',
        ],
        intellectual_property: [
          'You retain ownership of content you create.',
          `${COMPANY_NAME} retains ownership of the platform, UI, and underlying technology.`,
          'AI-generated content does not carry copyright under most jurisdictions.',
        ],
        limitations_of_liability: `${COMPANY_NAME} provides the service "as-is" without warranties. Liability is limited to the amount paid in the past 12 months.`,
        termination: 'We may suspend accounts that violate these terms. You may delete your account at any time.',
        governing_law: 'Taiwan (Republic of China) law governs these terms.',
      },
      full_document_url: 'https://pegn.ai/terms',
      dpa_available: DPA_AVAILABLE,
      dpa_contact: DPA_AVAILABLE ? CONTACT_EMAIL : null,
    });
  });

  /**
   * GET /api/v1/legal/dpa
   * Data Processing Agreement availability.
   */
  app.get('/api/v1/legal/dpa', (_req: Request, res: Response) => {
    if (!DPA_AVAILABLE) {
      res.status(404).json({
        available: false,
        message: 'DPA is not yet publicly available. Contact legal@pegn.ai for enterprise inquiries.',
      });
      return;
    }
    res.json({
      document: 'data_processing_agreement',
      available: true,
      company: COMPANY_NAME,
      last_updated: LAST_UPDATED,
      contact: CONTACT_EMAIL,
      full_document_url: 'https://pegn.ai/dpa',
      summary: {
        scope: `This DPA governs how ${COMPANY_NAME} processes personal data on behalf of the Customer (data controller) when providing the ${COMPANY_NAME} platform.`,
        roles: {
          data_controller: 'The Customer (organization subscribing to the service)',
          data_processor: COMPANY_NAME,
          sub_processors: [
            { name: 'Google Cloud Platform', purpose: 'Hosting & infrastructure', region: 'asia-east1 (Taiwan)' },
            { name: 'Google Gemini API', purpose: 'AI text generation', data: 'Prompt content submitted by users' },
            { name: 'OpenAI API', purpose: 'AI text generation (fallback)', data: 'Prompt content submitted by users' },
            { name: 'Anthropic Claude API', purpose: 'AI text generation (fallback)', data: 'Prompt content submitted by users' },
            { name: 'Stripe', purpose: 'Payment processing', data: 'Billing contact information only' },
            { name: 'Google Analytics 4', purpose: 'Usage analytics (if consented)', data: 'Anonymized event data' },
          ],
        },
        data_subject_rights: [
          'Access (GET /api/v1/auth/me)',
          'Erasure / Right to be forgotten (DELETE /api/v1/auth/account)',
          'Portability (GET /api/v1/collections/:id/export)',
          'Rectification (PATCH /api/v1/auth/profile)',
          'Restriction of processing (contact legal@pegn.ai)',
        ],
        security_measures: [
          'Data encrypted at rest (AES-256 via Google Cloud)',
          'Data encrypted in transit (TLS 1.2+)',
          'Access controls: JWT authentication + RBAC',
          'Audit logging for sensitive operations',
          'Container vulnerability scanning (Trivy)',
          'Dependency vulnerability scanning (npm audit)',
        ],
        retention_and_deletion: {
          account_data: 'Deleted within 30 days of account deletion request',
          server_logs: '90 days',
          backups: 'Purged within 60 days of deletion',
        },
        breach_notification: 'Controller will be notified within 72 hours of discovering a personal data breach (GDPR Art. 33).',
        governing_law: 'Taiwan Personal Data Protection Act (PDPA) and, where applicable, GDPR.',
      },
    });
  });
}
