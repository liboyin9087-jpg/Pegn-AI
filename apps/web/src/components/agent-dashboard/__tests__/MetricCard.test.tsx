import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MetricCard } from '../MetricCard';

describe('MetricCard', () => {
    it('renders correctly with required props', () => {
        render(<MetricCard label="Tokens" value="1.2k" />);

        expect(screen.getByText('Tokens')).toBeInTheDocument();
        expect(screen.getByText('1.2k')).toBeInTheDocument();
    });

    it('renders a skeleton when isLoading is true', () => {
        render(<MetricCard label="Cost" value="$0.04" isLoading={true} />);

        // ARIA label should indicate loading state (matching Chinese output)
        expect(screen.getByLabelText(/Cost, 載入中/i)).toBeInTheDocument();
    });

    it('renders delta values properly', () => {
        render(
            <MetricCard
                label="Latency"
                value="2.4s"
                delta={{ value: 12, trend: 'up' }}
            />
        );

        // Implementation uses absolute value and trend icon
        expect(screen.getByText('12%')).toBeInTheDocument();
    });

    it('calls onClick handler when clicked', () => {
        const handleClick = vi.fn();
        render(<MetricCard label="Cost" value="$0.04" onClick={handleClick} />);

        // Implementation is a button, not a div[role="button"]
        const button = screen.getByRole('button', { name: /Cost/i });
        fireEvent.click(button);

        expect(handleClick).toHaveBeenCalledTimes(1);
    });
});
