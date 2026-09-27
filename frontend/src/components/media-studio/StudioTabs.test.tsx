import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { StudioTabs, type StudioPanel } from './StudioTabs'

const panels: StudioPanel[] = [
  { id: 'a', index: 1, title: 'Section A', subtitle: 'About A', children: <input data-testid="input-a" defaultValue="keep-a" /> },
  { id: 'b', index: 2, title: 'Section B', children: <input data-testid="input-b" defaultValue="keep-b" /> },
  { id: 'c', index: 3, title: 'Section C', children: <div data-testid="body-c">C body</div> },
]

describe('StudioTabs single-active', () => {
  it('shows only the active tab panel', () => {
    const html = renderToStaticMarkup(
      <StudioTabs panels={panels} activeId="a" onSelect={() => undefined} />,
    )
    expect(html).toMatch(/data-section-id="a"[^>]*data-open="true"/)
    expect(html).toMatch(/data-section-id="b"[^>]*data-open="false"/)
    expect(html).toMatch(/data-section-id="c"[^>]*data-open="false"/)
  })

  it('renders one tab per panel with aria-selected on the active one', () => {
    const html = renderToStaticMarkup(
      <StudioTabs panels={panels} activeId="b" onSelect={() => undefined} />,
    )
    expect(html).toContain('role="tablist"')
    expect(html).toMatch(/id="studio-tab-a"[^>]*aria-selected="false"/)
    expect(html).toMatch(/id="studio-tab-b"[^>]*aria-selected="true"/)
  })

  it('falls back to the first panel when activeId is unknown', () => {
    const html = renderToStaticMarkup(
      <StudioTabs panels={panels} activeId="missing" onSelect={() => undefined} />,
    )
    expect(html).toMatch(/data-section-id="a"[^>]*data-open="true"/)
  })

  it('mounts only the active panel body on first paint and shows its subtitle', () => {
    const html = renderToStaticMarkup(
      <StudioTabs panels={panels} activeId="a" onSelect={() => undefined} />,
    )
    expect(html).toContain('data-testid="input-a"')
    expect(html).toContain('id="studio-section-body-a"')
    expect(html).toContain('About A')
    expect(html).not.toContain('data-testid="input-b"')
    expect(html).not.toContain('id="studio-section-body-b"')
  })

  it('marks tab step state (done / attention) on the index chip', () => {
    const html = renderToStaticMarkup(
      <StudioTabs
        panels={[
          { ...panels[0], status: 'done' },
          { ...panels[1], status: 'attention' },
          panels[2],
        ]}
        activeId="a"
        onSelect={() => undefined}
      />,
    )
    expect(html).toMatch(/media-tab-index is-done" data-status="done"/)
    expect(html).toMatch(/media-tab-index is-attention" data-status="attention"/)
  })

  it('exposes section anchors for auto-scroll targets', () => {
    const html = renderToStaticMarkup(
      <StudioTabs panels={panels} activeId="a" onSelect={() => undefined} />,
    )
    expect(html).toContain('id="studio-section-a"')
    expect(html).toContain('id="studio-section-b"')
    expect(html).toContain('data-testid="studio-tabs"')
  })
})
