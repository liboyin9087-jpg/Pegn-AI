import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { BottomSheet } from '../BottomSheet';

describe('BottomSheet', () => {
    it('renders correctly when open', () => {
        render(
            <BottomSheet isOpen={true} onClose={() => { }} title="Test Sheet">
                <div data-testid="sheet-content">Hello World</div>
            </BottomSheet>
        );

        expect(screen.getByText('Test Sheet')).toBeInTheDocument();
        expect(screen.getByTestId('sheet-content')).toBeInTheDocument();
    });

    it('does not render when closed', () => {
        const { container } = render(
            <BottomSheet isOpen={false} onClose={() => { }}>
                <div>Hidden Content</div>
            </BottomSheet>
        );
        expect(container.firstChild).toBeNull();
    });

    it('calls onClose when close button is clicked', () => {
        const handleClose = vi.fn();
        render(
            <BottomSheet isOpen={true} onClose={handleClose} title="Test Sheet">
                <div>Content</div>
            </BottomSheet>
        );

        const closeBtn = screen.getByLabelText('Close');
        fireEvent.click(closeBtn);
        expect(handleClose).toHaveBeenCalledTimes(1);
    });
});
