import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import AgentFailureState from '../AgentFailureState';

describe('AgentFailureState', () => {
  it('renders read-only state for viewers', () => {
    render(
      <AgentFailureState
        errorSummary="Model unavailable"
        jobId="job-1"
        canRerun={false}
        onOpenJob={vi.fn()}
        readOnlyReason="You do not have permission to rerun this run."
      />
    );

    expect(screen.getByText('Model unavailable')).toBeInTheDocument();
    expect(screen.getByText('View job trace')).toBeInTheDocument();
    expect(screen.queryByText('Rerun')).not.toBeInTheDocument();
    expect(screen.getByText(/do not have permission/i)).toBeInTheDocument();
  });

  it('renders rerun action for editors and admins', () => {
    const onRerun = vi.fn();
    render(
      <AgentFailureState
        errorSummary="Model unavailable"
        jobId="job-1"
        canRerun={true}
        onRerun={onRerun}
        onOpenJob={vi.fn()}
      />
    );

    fireEvent.click(screen.getByText('Rerun'));
    expect(onRerun).toHaveBeenCalledTimes(1);
  });
});
