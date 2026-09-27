// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { MediaStudioNav } from './MediaStudioNav'

describe('MediaStudioNav — Media Studio Tabbed Navigation', () => {
  afterEach(() => {
    cleanup()
  })

  const renderNav = (initialPath: string) =>
    render(
      <MemoryRouter initialEntries={[initialPath]}>
        <Routes>
          <Route path="/w/:workspaceId/media" element={<MediaStudioNav />} />
          <Route path="/w/:workspaceId/media/presets" element={<MediaStudioNav />} />
        </Routes>
      </MemoryRouter>,
    )

  it('renders both navigation links with correct paths', () => {
    renderNav('/w/ws-123/media')

    const jobsLink = screen.getByRole('link', { name: /dự án video/i })
    const presetsLink = screen.getByRole('link', { name: /preset quy trình/i })

    expect(jobsLink).toBeTruthy()
    expect(presetsLink).toBeTruthy()

    expect(jobsLink.getAttribute('href')).toBe('/w/ws-123/media')
    expect(presetsLink.getAttribute('href')).toBe('/w/ws-123/media/presets')
  })

  it('marks jobs link active when on /media', () => {
    renderNav('/w/ws-123/media')

    const jobsLink = screen.getByRole('link', { name: /dự án video/i })
    const presetsLink = screen.getByRole('link', { name: /preset quy trình/i })

    expect(jobsLink.className).toContain('border-[var(--color-media)]')
    expect(presetsLink.className).toContain('border-transparent')
  })

  it('marks presets link active when on /media/presets', () => {
    renderNav('/w/ws-123/media/presets')

    const jobsLink = screen.getByRole('link', { name: /dự án video/i })
    const presetsLink = screen.getByRole('link', { name: /preset quy trình/i })

    expect(presetsLink.className).toContain('border-[var(--color-media)]')
    expect(jobsLink.className).toContain('border-transparent')
  })
})
