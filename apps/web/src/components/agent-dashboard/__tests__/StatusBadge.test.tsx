import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { StatusBadge } from '../StatusBadge';

describe('StatusBadge', () => {
    it('renders default labels correctly based on status', () => {
        render(<StatusBadge status="COMPLETED" />);
        expect(screen.getByText('已完成')).toBeInTheDocument();

        render(<StatusBadge status="RUNNING" />);
        expect(screen.getByText('執行中')).toBeInTheDocument();

        render(<StatusBadge status="FAILED" />);
        expect(screen.getByText('失敗')).toBeInTheDocument();
    });

    it('renders custom labels correctly', () => {
        render(<StatusBadge status="WAITING" label="Pending Approval" />);
        expect(screen.getByText('Pending Approval')).toBeInTheDocument();
    });

    it('renders correctly for QUEUED status', () => {
        render(<StatusBadge status="QUEUED" />);
        expect(screen.getByText('排隊中')).toBeInTheDocument();
    });
});
