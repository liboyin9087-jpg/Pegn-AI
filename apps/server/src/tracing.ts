/**
 * tracing.ts — OpenTelemetry SDK 初始化
 *
 * 此檔案必須是 index.ts 中第一個（或第二個，dotenv 之後）的 import，
 * 讓 auto-instrumentation 能在 express/pg/http 載入前完成 monkey-patching。
 *
 * 本地開發：traces 發送至 Jaeger all-in-one (http://localhost:4318)
 * 生產環境：設定 OTEL_EXPORTER_OTLP_ENDPOINT 指向你的 OTel Collector
 */
import { NodeSDK } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http';
import { PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';
import { resourceFromAttributes } from '@opentelemetry/resources';

// ── 設定來源 ───────────────────────────────────────────────────────────────
const OTLP_ENDPOINT  = process.env.OTEL_EXPORTER_OTLP_ENDPOINT ?? 'http://localhost:4318';
const SERVICE_NAME   = process.env.OTEL_SERVICE_NAME            ?? 'pegn-ai-server';
const SERVICE_VERSION = process.env.npm_package_version         ?? '0.0.0';
const DEPLOYMENT_ENV  = process.env.NODE_ENV                    ?? 'development';

// ── Resource (服務身份) ────────────────────────────────────────────────────
const resource = resourceFromAttributes({
  'service.name':           SERVICE_NAME,
  'service.version':        SERVICE_VERSION,
  'deployment.environment': DEPLOYMENT_ENV,
});

// ── Trace Exporter — OTLP/HTTP → Jaeger (or any OTel Collector) ───────────
const traceExporter = new OTLPTraceExporter({
  url: `${OTLP_ENDPOINT}/v1/traces`,
  headers: {},
});

// ── Metric Exporter — OTLP/HTTP ────────────────────────────────────────────
const metricExporter = new OTLPMetricExporter({
  url: `${OTLP_ENDPOINT}/v1/metrics`,
  headers: {},
});

// ── SDK ────────────────────────────────────────────────────────────────────
export const sdk = new NodeSDK({
  resource,
  traceExporter,
  metricReader: new PeriodicExportingMetricReader({
    exporter: metricExporter,
    exportIntervalMillis: 30_000,   // 每 30s 推送一次
  }),
  instrumentations: [
    getNodeAutoInstrumentations({
      // 停用極度噪雜的 fs 追蹤（每次讀檔都產生 span，通常不需要）
      '@opentelemetry/instrumentation-fs': { enabled: false },
      // 保留 HTTP、Express、PostgreSQL 追蹤
      '@opentelemetry/instrumentation-http':    { enabled: true },
      '@opentelemetry/instrumentation-express': { enabled: true },
      '@opentelemetry/instrumentation-pg':      { enabled: true },
    }),
  ],
});

// ── 啟動 ───────────────────────────────────────────────────────────────────
sdk.start();
console.log(
  `[OTel] SDK started  service=${SERVICE_NAME}  env=${DEPLOYMENT_ENV}  endpoint=${OTLP_ENDPOINT}`
);

// ── 優雅關機 ───────────────────────────────────────────────────────────────
process.on('SIGTERM', async () => {
  try {
    await sdk.shutdown();
    console.log('[OTel] SDK shut down cleanly');
  } catch (err) {
    console.error('[OTel] Error during SDK shutdown:', err);
  }
});
