import React from 'react';
import type { JobEventRecord } from '../api/client';
import EmptyState from './EmptyState';

export default function JobTimeline({ events }: { events: JobEventRecord[] }) {
  if (events.length === 0) {
    return (
      <EmptyState
        title="No job events yet"
        description="Timeline events will appear here after the job starts reporting progress."
      />
    );
  }

  const sorted = [...events].sort((a, b) => a.sequenceNo - b.sequenceNo);

  return (
    <div className="space-y-2">
      {sorted.map((event) => (
        <div key={event.id} className="rounded-xl border border-border bg-surface-secondary p-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-xs font-medium text-text-primary">{event.eventType}</p>
              {event.message ? (
                <p className="mt-1 text-xs text-text-secondary">{event.message}</p>
              ) : null}
            </div>
            <div className="text-right text-[11px] text-text-tertiary">
              <p>#{event.sequenceNo}</p>
              <p>{new Date(event.createdAt).toLocaleString()}</p>
            </div>
          </div>
          {event.payload && Object.keys(event.payload).length > 0 ? (
            <pre className="mt-2 overflow-x-auto rounded-lg bg-surface px-2 py-1 text-[11px] text-text-tertiary">
              {JSON.stringify(event.payload, null, 2)}
            </pre>
          ) : null}
        </div>
      ))}
    </div>
  );
}
