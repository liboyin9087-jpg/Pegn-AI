import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import SearchFilterBar from '../SearchFilterBar';

describe('SearchFilterBar', () => {
  it('updates type, source, time preset, and clear actions', () => {
    const onTypeChange = vi.fn();
    const onSourceChange = vi.fn();
    const onTimePresetChange = vi.fn();
    const onClear = vi.fn();

    render(
      <SearchFilterBar
        type=""
        source=""
        timePreset="all"
        typeOptions={[{ value: 'spec', count: 2 }]}
        sourceOptions={[{ value: 'manual', count: 3 }]}
        onTypeChange={onTypeChange}
        onSourceChange={onSourceChange}
        onTimePresetChange={onTimePresetChange}
        onClear={onClear}
      />
    );

    fireEvent.change(screen.getByLabelText('Type filter'), { target: { value: 'spec' } });
    fireEvent.change(screen.getByLabelText('Source filter'), { target: { value: 'manual' } });
    fireEvent.change(screen.getByLabelText('Updated time filter'), { target: { value: '7d' } });
    fireEvent.click(screen.getByText('Clear filters'));

    expect(onTypeChange).toHaveBeenCalledWith('spec');
    expect(onSourceChange).toHaveBeenCalledWith('manual');
    expect(onTimePresetChange).toHaveBeenCalledWith('7d');
    expect(onClear).toHaveBeenCalled();
  });
});
