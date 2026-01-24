/**
 * Unit tests for BranchChip component.
 * 
 * Run with: npm test -- BranchChip.test.tsx
 */
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import BranchChip from './BranchChip';

describe('BranchChip', () => {
  const mockOnClick = jest.fn();
  const defaultProps = {
    branchId: 'branch-123',
    selectedText: 'This is the selected text',
    onClick: mockOnClick,
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders with selected text', () => {
    render(<BranchChip {...defaultProps} />);
    expect(screen.getByText(/This is the selected text/)).toBeInTheDocument();
  });

  it('truncates long text', () => {
    const longText = 'This is a very long selected text that should be truncated when it exceeds thirty characters';
    render(
      <BranchChip
        {...defaultProps}
        selectedText={longText}
      />
    );

    const chip = screen.getByRole('button');
    expect(chip.textContent).toContain('...');
    expect(chip.textContent?.length).toBeLessThan(longText.length);
  });

  it('calls onClick when clicked', () => {
    render(<BranchChip {...defaultProps} />);
    const chip = screen.getByRole('button');
    fireEvent.click(chip);
    expect(mockOnClick).toHaveBeenCalledTimes(1);
  });

  it('applies hover styles on mouse enter', () => {
    render(<BranchChip {...defaultProps} />);
    const chip = screen.getByRole('button');
    
    fireEvent.mouseEnter(chip);
    // Styles are applied inline, so we check the style attribute
    expect(chip).toHaveStyle({ background: expect.any(String) });
  });
});
