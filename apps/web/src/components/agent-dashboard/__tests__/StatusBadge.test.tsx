import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { StatusBadge } from '../StatusBadge';

describe('StatusBadge', () => {
    it('renders default labels correctly based on status', () => {
        render(<StatusBadge status="COMPLETED" />);
        expect(screen.getByText('Completed')).toBeInTheDocument();

        render(<StatusBadge status="RUNNING" />);
        expect(screen.getByText('Running')).toBeInTheDocument();

        render(<StatusBadge status="FAILED" />);
        expect(screen.getByText('Failed')).toBeInTheDocument();
    });

    it('renders custom labels correctly', () => {
        render(<StatusBadge status="WAITING" label="Pending Approval" />);
        expect(screen.getByText('Pending Approval')).toBeInTheDocument();
    });

    it('renders correctly for QUEUED status', () => {
        render(<StatusBadge status="QUEUED" />);
        expect(screen.getByText('Queued')).toBeInTheDocument();
    });
});
