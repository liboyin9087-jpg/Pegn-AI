import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ProgressBar } from '../ProgressBar';

describe('ProgressBar', () => {
    it('renders correctly with given progress', () => {
        const { container } = render(<ProgressBar progress={50} status="RUNNING" />);

        // Test for style width
        const innerBar = container.querySelector('.transition-all');
        expect(innerBar).toBeInTheDocument();
        expect(innerBar).toHaveStyle('width: 50%');
    });

    it('renders indeterminate state correctly', () => {
        const { container } = render(<ProgressBar indeterminate={true} status="RUNNING" />);

        // Should have animate-pulse class and 100% width
        const pulseBar = container.querySelector('.animate-pulse');
        expect(pulseBar).toBeInTheDocument();
        expect(pulseBar).toHaveStyle('width: 100%');
    });

    it('applies correct color classes based on status', () => {
        const { container: errorContainer } = render(<ProgressBar progress={10} status="FAILED" />);
        expect(errorContainer.querySelector('.bg-red-500')).toBeInTheDocument();

        const { container: successContainer } = render(<ProgressBar progress={100} status="COMPLETED" />);
        expect(successContainer.querySelector('.bg-green-500')).toBeInTheDocument();

        const { container: runningContainer } = render(<ProgressBar progress={50} status="RUNNING" />);
        expect(runningContainer.querySelector('.bg-blue-500')).toBeInTheDocument();
    });
});
