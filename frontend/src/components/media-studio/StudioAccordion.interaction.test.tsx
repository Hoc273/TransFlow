// @vitest-environment jsdom
import { useState } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { StudioAccordion, type StudioPanel } from './StudioAccordion'

afterEach(() => cleanup())

function openState(container: HTMLElement, sectionId: string): string | null | undefined {
  return container.querySelector(`[data-section-id="${sectionId}"]`)?.getAttribute('data-open')
}

function Harness() {
  const [openId, setOpenId] = useState<string | null>('a')
  const panels: StudioPanel[] = [
    { id: 'a', index: 1, title: 'Section A', children: <input data-testid="input-a" /> },
    { id: 'b', index: 2, title: 'Section B', children: <input data-testid="input-b" /> },
    { id: 'c', index: 3, title: 'Section C', children: <div data-testid="body-c">C body</div> },
  ]
  return (
    <StudioAccordion
      panels={panels}
      openId={openId}
      onToggle={(id) => setOpenId((cur) => (cur === id ? null : id))}
    />
  )
}

describe('StudioAccordion â€” real interaction single-open', () => {
  it('clicking B closes A â€” never two top-level sections open', () => {
    const { container } = render(<Harness />)
    expect(openState(container, 'a')).toBe('true')

    fireEvent.click(screen.getByText('Section B'))
    expect(openState(container, 'a')).toBe('false')
    expect(openState(container, 'b')).toBe('true')
  })

  it('A â†’ B â†’ C keeps exactly one section open (B closes when C opens)', () => {
    const { container } = render(<Harness />)

    fireEvent.click(screen.getByText('Section B'))
    fireEvent.click(screen.getByText('Section C'))

    expect(openState(container, 'a')).toBe('false')
    expect(openState(container, 'b')).toBe('false')
    expect(openState(container, 'c')).toBe('true')
  })

  it('typed form state survives switching sections and coming back', () => {
    const { container } = render(<Harness />)

    const inputA = screen.getByTestId('input-a') as HTMLInputElement
    fireEvent.change(inputA, { target: { value: 'hello world' } })
    expect(inputA.value).toBe('hello world')

    fireEvent.click(screen.getByText('Section B'))
    expect(openState(container, 'a')).toBe('false')
    expect(openState(container, 'b')).toBe('true')

    fireEvent.click(screen.getByText('Section A'))
    expect(openState(container, 'a')).toBe('true')
    expect((screen.getByTestId('input-a') as HTMLInputElement).value).toBe('hello world')
  })
})
