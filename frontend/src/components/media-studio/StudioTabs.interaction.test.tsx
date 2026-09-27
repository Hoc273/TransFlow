// @vitest-environment jsdom
import { useState } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { StudioTabs, type StudioPanel } from './StudioTabs'

afterEach(() => cleanup())

function openState(container: HTMLElement, sectionId: string): string | null | undefined {
  return container.querySelector(`[data-section-id="${sectionId}"]`)?.getAttribute('data-open')
}

function Harness() {
  const [activeId, setActiveId] = useState<string>('a')
  const panels: StudioPanel[] = [
    { id: 'a', index: 1, title: 'Section A', children: <input data-testid="input-a" /> },
    { id: 'b', index: 2, title: 'Section B', children: <input data-testid="input-b" /> },
    { id: 'c', index: 3, title: 'Section C', children: <div data-testid="body-c">C body</div> },
  ]
  return <StudioTabs panels={panels} activeId={activeId} onSelect={setActiveId} />
}

describe('StudioTabs — real interaction', () => {
  it('clicking tab B hides A — exactly one panel visible', () => {
    const { container } = render(<Harness />)
    expect(openState(container, 'a')).toBe('true')

    fireEvent.click(screen.getByRole('tab', { name: /Section B/ }))
    expect(openState(container, 'a')).toBe('false')
    expect(openState(container, 'b')).toBe('true')
  })

  it('clicking the active tab keeps it open (tabs never collapse)', () => {
    const { container } = render(<Harness />)
    fireEvent.click(screen.getByRole('tab', { name: /Section A/ }))
    expect(openState(container, 'a')).toBe('true')
  })

  it('arrow keys move between tabs and wrap around', () => {
    const { container } = render(<Harness />)
    const tabA = screen.getByRole('tab', { name: /Section A/ })

    fireEvent.keyDown(tabA, { key: 'ArrowRight' })
    expect(openState(container, 'b')).toBe('true')

    fireEvent.keyDown(screen.getByRole('tab', { name: /Section B/ }), { key: 'End' })
    expect(openState(container, 'c')).toBe('true')

    fireEvent.keyDown(screen.getByRole('tab', { name: /Section C/ }), { key: 'ArrowRight' })
    expect(openState(container, 'a')).toBe('true')
  })

  it('typed form state survives switching tabs and coming back', () => {
    const { container } = render(<Harness />)

    const inputA = screen.getByTestId('input-a') as HTMLInputElement
    fireEvent.change(inputA, { target: { value: 'hello world' } })

    fireEvent.click(screen.getByRole('tab', { name: /Section B/ }))
    expect(openState(container, 'b')).toBe('true')

    fireEvent.click(screen.getByRole('tab', { name: /Section A/ }))
    expect(openState(container, 'a')).toBe('true')
    expect((screen.getByTestId('input-a') as HTMLInputElement).value).toBe('hello world')
  })
})
