import { Request, Response } from 'express';
import { trace, metrics, SpanStatusCode, Span } from '@opentelemetry/api';

// ── OTel instruments ───────────────────────────────────────────────────────
const tracer = trace.getTracer('pegn-ai-server');
const meter  = metrics.getMeter('pegn-ai-server');

const httpRequestCounter  = meter.createCounter('http_requests_total',      { description: 'Total HTTP requests' });
const httpDurationHist    = meter.createHistogram('http_request_duration_ms', { description: 'HTTP request duration in ms', unit: 'ms' });
const dbQueryCounter      = meter.createCounter('db_queries_total',          { description: 'Total DB queries' });
const dbDurationHist      = meter.createHistogram('db_query_duration_ms',    { description: 'DB query duration in ms', unit: 'ms' });
const searchDurationHist  = meter.createHistogram('search_duration_ms',      { description: 'Search operation duration in ms', unit: 'ms' });

export interface MetricData {
  name: string;
  value: number;
  timestamp: Date;
  tags?: Record<string, string>;
}

export interface LogEntry {
  level: 'info' | 'warn' | 'error' | 'debug';
  message: string;
  timestamp: Date;
  context?: Record<string, any>;
  userId?: string;
  requestId?: string;
}

export class ObservabilityService {
  private metrics: Map<string, MetricData[]> = new Map();
  private logs: LogEntry[] = [];
  private maxMetricsRetention = 1000; // Keep last 1000 metrics per type
  private maxLogsRetention = 5000; // Keep last 5000 log entries

  // Metrics collection
  recordMetric(name: string, value: number, tags?: Record<string, string>): void {
    const metric: MetricData = {
      name,
      value,
      timestamp: new Date(),
      tags
    };

    if (!this.metrics.has(name)) {
      this.metrics.set(name, []);
    }

    const metrics = this.metrics.get(name)!;
    metrics.push(metric);

    // Keep only recent metrics
    if (metrics.length > this.maxMetricsRetention) {
      metrics.splice(0, metrics.length - this.maxMetricsRetention);
    }
  }

  // ── OTel span utility ──────────────────────────────────────────────────
  async withSpan<T>(
    spanName: string,
    fn: (span: Span) => Promise<T>,
    attributes?: Record<string, string | number | boolean>,
  ): Promise<T> {
    return tracer.startActiveSpan(spanName, async (span: Span) => {
      if (attributes) {
        span.setAttributes(attributes);
      }
      try {
        const result = await fn(span);
        span.setStatus({ code: SpanStatusCode.OK });
        return result;
      } catch (err) {
        span.setStatus({ code: SpanStatusCode.ERROR, message: String(err) });
        span.recordException(err as Error);
        throw err;
      } finally {
        span.end();
      }
    });
  }

  // Performance monitoring
  recordRequestDuration(path: string, duration: number, statusCode: number, method = 'UNKNOWN'): void {
    this.recordMetric('http_request_duration', duration, {
      path,
      method,
      status_code: statusCode.toString()
    });

    this.recordMetric('http_requests_total', 1, {
      path,
      method,
      status_code: statusCode.toString()
    });

    // OTel instruments
    const attrs = { 'http.method': method, 'http.route': path, 'http.status_code': statusCode };
    httpRequestCounter.add(1, attrs);
    httpDurationHist.record(duration, attrs);
  }

  recordDatabaseQuery(query: string, duration: number, success: boolean): void {
    const queryType = this.getQueryType(query);
    this.recordMetric('database_query_duration', duration, {
      query_type: queryType,
      success: success.toString()
    });

    this.recordMetric('database_queries_total', 1, {
      query_type: queryType,
      success: success.toString()
    });

    // OTel instruments
    const attrs = { 'db.operation': queryType, 'db.success': success };
    dbQueryCounter.add(1, attrs);
    dbDurationHist.record(duration, attrs);
  }

  recordCRDTSync(documentId: string, duration: number, success: boolean): void {
    this.recordMetric('crdt_sync_duration', duration, {
      success: success.toString()
    });

    this.recordMetric('crdt_sync_operations_total', 1, {
      success: success.toString()
    });
  }

  recordSearchOperation(query: string, duration: number, resultCount: number): void {
    this.recordMetric('search_duration', duration, {
      query_length: query.length.toString()
    });

    this.recordMetric('search_results_count', resultCount);

    // OTel instruments
    searchDurationHist.record(duration, { 'search.result_count': resultCount });
  }

  // Logging
  log(level: LogEntry['level'], message: string, context?: Record<string, any>, userId?: string, requestId?: string): void {
    const logEntry: LogEntry = {
      level,
      message,
      timestamp: new Date(),
      context,
      userId,
      requestId
    };

    this.logs.push(logEntry);

    // Keep only recent logs
    if (this.logs.length > this.maxLogsRetention) {
      this.logs.splice(0, this.logs.length - this.maxLogsRetention);
    }

    // Also log to console with structured format
    const consoleMessage = {
      timestamp: logEntry.timestamp.toISOString(),
      level,
      message,
      context,
      userId,
      requestId
    };

    switch (level) {
      case 'error':
        console.error('[OBSERVABILITY]', consoleMessage);
        break;
      case 'warn':
        console.warn('[OBSERVABILITY]', consoleMessage);
        break;
      case 'info':
        console.info('[OBSERVABILITY]', consoleMessage);
        break;
      case 'debug':
        console.debug('[OBSERVABILITY]', consoleMessage);
        break;
    }
  }

  info(message: string, context?: Record<string, any>, userId?: string, requestId?: string): void {
    this.log('info', message, context, userId, requestId);
  }

  warn(message: string, context?: Record<string, any>, userId?: string, requestId?: string): void {
    this.log('warn', message, context, userId, requestId);
  }

  error(message: string, context?: Record<string, any>, userId?: string, requestId?: string): void {
    this.log('error', message, context, userId, requestId);
  }

  debug(message: string, context?: Record<string, any>, userId?: string, requestId?: string): void {
    this.log('debug', message, context, userId, requestId);
  }

  // Health checks
  async getHealthStatus(): Promise<{
    status: 'healthy' | 'degraded' | 'unhealthy';
    checks: Record<string, any>;
    timestamp: Date;
  }> {
    const checks: Record<string, any> = {};
    let overallStatus: 'healthy' | 'degraded' | 'unhealthy' = 'healthy';

    // Database health check
    try {
      const { pool } = await import('../db/client.js');
      if (pool) {
        const start = Date.now();
        await pool.query('SELECT 1');
        checks.database = {
          status: 'healthy',
          latency: Date.now() - start,
          pool: {
            total: pool.totalCount,
            idle: pool.idleCount,
            waiting: pool.waitingCount,
          },
        };
      } else {
        checks.database = {
          status: 'unhealthy',
          message: 'Database not available'
        };
        overallStatus = 'degraded';
      }
    } catch (error) {
      checks.database = {
        status: 'unhealthy',
        error: error instanceof Error ? error.message : 'Unknown error'
      };
      overallStatus = 'unhealthy';
    }

    // Memory usage check
    const memUsage = process.memoryUsage();
    checks.memory = {
      status: 'healthy',
      rss: memUsage.rss,
      heapUsed: memUsage.heapUsed,
      heapTotal: memUsage.heapTotal,
      external: memUsage.external
    };

    // Check if memory usage is high
    const memoryUsagePercent = (memUsage.heapUsed / memUsage.heapTotal) * 100;
    if (memoryUsagePercent > 90) {
      checks.memory.status = 'unhealthy';
      overallStatus = 'unhealthy';
    } else if (memoryUsagePercent > 80) {
      checks.memory.status = 'degraded';
      if (overallStatus === 'healthy') overallStatus = 'degraded';
    }

    // Uptime check
    checks.uptime = {
      status: 'healthy',
      seconds: process.uptime()
    };

    return {
      status: overallStatus,
      checks,
      timestamp: new Date()
    };
  }

  // Metrics retrieval
  getMetrics(name?: string, since?: Date): MetricData[] {
    if (name) {
      const metrics = this.metrics.get(name) || [];
      return since ? metrics.filter(m => m.timestamp >= since) : metrics;
    }

    // Return all metrics
    const allMetrics: MetricData[] = [];
    for (const metrics of this.metrics.values()) {
      allMetrics.push(...metrics);
    }
    return since ? allMetrics.filter(m => m.timestamp >= since) : allMetrics;
  }

  getLogs(level?: LogEntry['level'], since?: Date, limit = 100): LogEntry[] {
    let filteredLogs = this.logs;

    if (level) {
      filteredLogs = filteredLogs.filter(log => log.level === level);
    }

    if (since) {
      filteredLogs = filteredLogs.filter(log => log.timestamp >= since);
    }

    return filteredLogs.slice(-limit);
  }

  // Utility methods
  private getQueryType(query: string): string {
    const trimmed = query.trim().toLowerCase();
    if (trimmed.startsWith('select')) return 'select';
    if (trimmed.startsWith('insert')) return 'insert';
    if (trimmed.startsWith('update')) return 'update';
    if (trimmed.startsWith('delete')) return 'delete';
    if (trimmed.startsWith('create')) return 'create';
    if (trimmed.startsWith('drop')) return 'drop';
    if (trimmed.startsWith('alter')) return 'alter';
    return 'other';
  }

  // Export metrics for external monitoring systems
  exportPrometheusMetrics(): string {
    const lines: string[] = [];

    for (const [metricName, metrics] of this.metrics) {
      const latestMetrics = metrics.slice(-100); // Last 100 metrics
      const sum = latestMetrics.reduce((acc, m) => acc + m.value, 0);
      const avg = sum / latestMetrics.length;

      lines.push(`# HELP ${metricName} ${metricName} metric`);
      lines.push(`# TYPE ${metricName} gauge`);
      lines.push(`${metricName} ${avg}`);

      // Add tags as separate metrics if present
      const tagGroups = new Map<string, Map<string, number[]>>();
      for (const metric of latestMetrics) {
        if (metric.tags) {
          for (const [tagKey, tagValue] of Object.entries(metric.tags)) {
            if (!tagGroups.has(tagKey)) {
              tagGroups.set(tagKey, new Map());
            }
            const tagGroup = tagGroups.get(tagKey)!;
            if (!tagGroup.has(tagValue)) {
              tagGroup.set(tagValue, []);
            }
            tagGroup.get(tagValue)!.push(metric.value);
          }
        }
      }

      for (const [tagKey, tagGroup] of tagGroups) {
        for (const [tagValue, values] of tagGroup) {
          const avg = values.reduce((acc, v) => acc + v, 0) / values.length;
          lines.push(`${metricName}_${tagKey}{${tagKey}="${tagValue}"} ${avg}`);
        }
      }
    }

    return lines.join('\n') + '\n';
  }

  // Cleanup old data
  cleanup(): void {
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000); // 24 hours ago

    for (const [name, metrics] of this.metrics) {
      const filtered = metrics.filter(m => m.timestamp >= cutoff);
      this.metrics.set(name, filtered);
    }

    this.logs = this.logs.filter(log => log.timestamp >= cutoff);
  }
}

export const observability = new ObservabilityService();

// Express middleware for request tracking
export function requestTracker(req: Request, res: Response, next: Function) {
  const startTime = Date.now();
  const requestId = req.headers['x-request-id'] as string || Math.random().toString(36).substr(2, 9);

  // Add request ID to response headers
  res.setHeader('X-Request-ID', requestId);

  // Log request
  observability.info('Request started', {
    method: req.method,
    path: req.path,
    userAgent: req.headers['user-agent'],
    ip: req.ip
  }, undefined, requestId);

  // Track response
  res.on('finish', () => {
    const duration = Date.now() - startTime;
    observability.recordRequestDuration(req.path, duration, res.statusCode, req.method);

    observability.info('Request completed', {
      method: req.method,
      path: req.path,
      statusCode: res.statusCode,
      duration
    }, undefined, requestId);
  });

  next();
}

// Cleanup old data periodically
setInterval(() => {
  observability.cleanup();
}, 60 * 60 * 1000); // Every hour
