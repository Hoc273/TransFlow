import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { RecipeSelector } from './RecipeSelector'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}))

describe('RecipeSelector', () => {
  it('shows localization first when the backend feature is available', () => {
    const html = renderToStaticMarkup(
      <RecipeSelector
        value="summary.generative"
        generativeAvailable
        onChange={() => undefined}
      />,
    )

    expect(html).toContain('modeGenerative')
    expect(html).toContain('modeTranslateOnly')
    expect(html).not.toContain('modeHybrid')
    expect(html).toContain('aria-checked="true"')
    expect(html.indexOf('modeTranslateOnly')).toBeLessThan(html.indexOf('modeGenerative'))
  })

  it('hides summary.generative after the backend rejects the feature', () => {
    const html = renderToStaticMarkup(
      <RecipeSelector
        value="localization.full"
        generativeAvailable={false}
        onChange={() => undefined}
      />,
    )

    expect(html).not.toContain('modeGenerative')
    expect(html).toContain('modeTranslateOnly')
    // C2 (docs/19 §1.8.2): extractive has no create entry anymore.
    expect(html).not.toContain('modeHybrid')
  })
})
