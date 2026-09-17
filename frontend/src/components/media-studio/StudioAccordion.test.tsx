import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { StudioAccordion, type StudioPanel } from './StudioAccordion'

const panels: StudioPanel[] = [
  { id: 'a', index: 1, title: 'Section A', children: <input data-testid="input-a" defaultValue="keep-a" /> },
  { id: 'b', index: 2, title: 'Section B', children: <input data-testid="input-b" defaultValue="keep-b" /> },
  { id: 'c', index: 3, title: 'Section C', children: <div data-testid="body-c">C body</div> },
]

describe('StudioAccordion single-open', () => {
  it('opens only the openId section', () => {
    const html = renderToStaticMarkup(
      <StudioAccordion panels={panels} openId="a" onToggle={() => undefined} />,
    )
    expect(html).toContain('data-section-id="a"')
    expect(html).toMatch(/data-section-id="a"[^>]*data-open="true"/)
    expect(html).toMatch(/data-section-id="b"[^>]*data-open="false"/)
    expect(html).toMatch(/data-section-id="c"[^>]*data-open="false"/)
  })

  it('opening B (via openId) closes A', () => {
    const html = renderToStaticMarkup(
      <StudioAccordion panels={panels} openId="b" onToggle={() => undefined} />,
    )
    expect(html).toMatch(/data-section-id="a"[^>]*data-open="false"/)
    expect(html).toMatch(/data-section-id="b"[^>]*data-open="true"/)
  })

  it('null openId closes all sections', () => {
    const html = renderToStaticMarkup(
      <StudioAccordion panels={panels} openId={null} onToggle={() => undefined} />,
    )
    expect(html).toMatch(/data-section-id="a"[^>]*data-open="false"/)
    expect(html).toMatch(/data-section-id="b"[^>]*data-open="false"/)
    expect(html).toMatch(/data-section-id="c"[^>]*data-open="false"/)
  })

  it('mounts the open section body and leaves unopened bodies unmounted on first paint', () => {
    const html = renderToStaticMarkup(
      <StudioAccordion panels={panels} openId="a" onToggle={() => undefined} />,
    )
    expect(html).toContain('data-testid="input-a"')
    expect(html).toContain('id="studio-section-body-a"')
    // First paint: only openId is in the mounted set (useEffect does not run in SSR).
    expect(html).not.toContain('data-testid="input-b"')
    expect(html).not.toContain('id="studio-section-body-b"')
  })

  it('exposes section anchors for auto-scroll targets', () => {
    const html = renderToStaticMarkup(
      <StudioAccordion panels={panels} openId="a" onToggle={() => undefined} />,
    )
    expect(html).toContain('id="studio-section-a"')
    expect(html).toContain('id="studio-section-b"')
    expect(html).toContain('data-testid="studio-accordion"')
  })
})
