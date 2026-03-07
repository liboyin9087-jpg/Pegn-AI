import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import JobTimeline from '../JobTimeline';

describe('JobTimeline', () => {
  it('sorts events by sequence number and renders payload safely', () => {
    render(
      <JobTimeline
        events={[
          {
            id: 'evt-2',
            jobId: 'job-1',
            sequenceNo: 2,
            eventType: 'completed',
            message: 'Completed',
            payload: { result: 'ok' },
            createdAt: '2026-03-07T10:00:02.000Z',
          },
          {
            id: 'evt-1',
            jobId: 'job-1',
            sequenceNo: 1,
            eventType: 'started',
            message: 'Started',
            payload: {},
            createdAt: '2026-03-07T10:00:01.000Z',
          },
        ]}
      />
    );

    const started = screen.getByText('started');
    const completed = screen.getByText('completed');
    expect(started.compareDocumentPosition(completed) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByText(/"result": "ok"/)).toBeInTheDocument();
  });

  it('shows empty state when there are no events', () => {
    render(<JobTimeline events={[]} />);
    expect(screen.getByText('No job events yet')).toBeInTheDocument();
  });
});
