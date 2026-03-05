// Ambient module declarations for OpenTelemetry packages that ship CJS-only
// builds without separate TypeScript declaration files bundled.
declare module '@opentelemetry/api' {
  export interface Span {
    setAttributes(attrs: Record<string, string | number | boolean>): void;
    setStatus(status: { code: number; message?: string }): void;
    recordException(err: Error): void;
    end(): void;
  }
  export const SpanStatusCode: { OK: number; ERROR: number; UNSET: number };
  export const trace: {
    getTracer(name: string): {
      startActiveSpan<T>(name: string, fn: (span: Span) => Promise<T>): Promise<T>;
    };
  };
  export const metrics: {
    getMeter(name: string): {
      createCounter(name: string, opts?: object): { add(v: number, attrs?: object): void };
      createHistogram(name: string, opts?: object): { record(v: number, attrs?: object): void };
    };
  };
}
declare module '@opentelemetry/sdk-metrics';

