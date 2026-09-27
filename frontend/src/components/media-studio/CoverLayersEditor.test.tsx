// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { defaultCoverLayer } from '@/lib/media/coverLayers'
import type { PresentationLayer } from '@/types/media'
import { CoverLayersEditor } from './CoverLayersEditor'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

afterEach(cleanup)

function Harness({ initiallyEnabled = false }: { initiallyEnabled?: boolean }) {
  const [enabled, setEnabled] = useState(initiallyEnabled)
  const [layers, setLayers] = useState<PresentationLayer[]>([defaultCoverLayer([])])

  return (
    <CoverLayersEditor
      enabled={enabled}
      layers={layers}
      locked={false}
      testidPrefix="mask"
      onChange={(next) => {
        setEnabled(next.enabled)
        setLayers(next.layers)
      }}
    />
  )
}

describe('CoverLayersEditor', () => {
  it('adds the first cover independently from the subtitle style surface', () => {
    render(<Harness />)

    fireEvent.click(screen.getByTestId('mask-layer-add'))

    expect((screen.getByTestId('mask-enable') as HTMLInputElement).checked).toBe(true)
    expect(screen.getByTestId('mask-layer-0-anchor')).toBeTruthy()
  })

  it('selects the newly added layer in the inspector', () => {
    render(<Harness initiallyEnabled />)

    fireEvent.click(screen.getByTestId('mask-layer-add'))

    expect(screen.getByTestId('mask-layer-1-select').getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByTestId('mask-layer-1-anchor')).toBeTruthy()

    fireEvent.click(screen.getByTestId('mask-layer-0-select'))
    expect(screen.getByTestId('mask-layer-0-anchor')).toBeTruthy()
  })

  it('edits independent horizontal and vertical center coordinates', () => {
    render(<Harness initiallyEnabled />)

    fireEvent.change(screen.getByTestId('mask-layer-0-x'), { target: { value: '35' } })
    fireEvent.change(screen.getByTestId('mask-layer-0-y'), { target: { value: '62' } })

    expect((screen.getByTestId('mask-layer-0-x') as HTMLInputElement).value).toBe('35')
    expect((screen.getByTestId('mask-layer-0-y') as HTMLInputElement).value).toBe('62')
  })
})
