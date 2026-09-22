// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { BottomSheet } from './BottomSheet'

afterEach(() => cleanup())

describe('BottomSheet', () => {
  it('renders title and children when isOpen is true', () => {
    render(
      <BottomSheet isOpen={true} onClose={vi.fn()} title="Test Sheet">
        <div>Sheet Content</div>
      </BottomSheet>
    )
    expect(screen.getByText('Test Sheet')).toBeTruthy()
    expect(screen.getByText('Sheet Content')).toBeTruthy()
  })

  it('calls onClose when backdrop or close button is clicked', () => {
    const handleClose = vi.fn()
    render(
      <BottomSheet isOpen={true} onClose={handleClose} title="Test Sheet">
        <div>Sheet Content</div>
      </BottomSheet>
    )
    const closeBtn = screen.getByLabelText('Close sheet')
    fireEvent.click(closeBtn)
    expect(handleClose).toHaveBeenCalledTimes(1)

    const backdrop = screen.getByLabelText('Close backdrop')
    fireEvent.click(backdrop)
    expect(handleClose).toHaveBeenCalledTimes(2)
  })

  it('calls onClose when Escape key is pressed', () => {
    const handleClose = vi.fn()
    render(
      <BottomSheet isOpen={true} onClose={handleClose} title="Test Sheet">
        <div>Sheet Content</div>
      </BottomSheet>
    )
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(handleClose).toHaveBeenCalledTimes(1)
  })

  it('renders nothing when isOpen is false', () => {
    const { container } = render(
      <BottomSheet isOpen={false} onClose={vi.fn()} title="Test Sheet">
        <div>Sheet Content</div>
      </BottomSheet>
    )
    expect(container.firstChild).toBeNull()
  })
})
