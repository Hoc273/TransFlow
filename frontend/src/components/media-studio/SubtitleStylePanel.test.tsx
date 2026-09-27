import { describe, expect, it, vi } from 'vitest'
import { ApiError } from '@/types/api'
import type { SubtitleStyleDetail, SubtitleStyleSnapshot } from '@/types/subtitleStyle'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

const presetsQuery = { data: undefined as unknown, isLoading: false, isError: false, refetch: vi.fn() }
const currentQuery = { data: undefined as unknown, isLoading: false, isError: false, refetch: vi.fn() }
const assignMutate = vi.fn()
let details: SubtitleStyleDetail[] = []

vi.mock('@/hooks/useSubtitleStyle', async () => {
  const actual = await vi.importActual<typeof import('@/hooks/useSubtitleStyle')>(
    '@/hooks/useSubtitleStyle',
  )
  return {
    matchAssignedPreset: actual.matchAssignedPreset,
    useSubtitleStylePresets: () => presetsQuery,
    useJobSubtitleStyle: () => currentQuery,
    useSubtitleStyleDetails: () => details,
    useAssignSubtitleStyle: () => ({ mutateAsync: assignMutate }),
  }
})

const { renderToStaticMarkup } = await import('react-dom/server')
const { SubtitleStylePanel, runSubtitleStyleAssign, subtitleStyleErrorKey } = await import(
  './SubtitleStylePanel'
)

const SNAPSHOT: SubtitleStyleSnapshot = {
  font_family: 'Arial',
  font_size: 52,
  primary_color: '#FFFFFF',
  outline_color: '#000000',
  outline_width: 4,
  shadow: false,
  bold: true,
  italic: false,
  alignment: 'CENTER',
  margin_v: 40,
  line_spacing: 0,
  background: null,
  opacity: 100,
}

const TIKTOK: SubtitleStyleDetail = {
  ...SNAPSHOT,
  key: 'style-tiktok',
  name: 'TikTok (bold, centered-bottom)',
  revision: 1,
}

const YOUTUBE: SubtitleStyleDetail = {
  ...SNAPSHOT,
  font_size: 44,
  key: 'style-youtube',
  name: 'YouTube (standard bottom)',
  revision: 2,
}

function setup(overrides: {
  presets?: Partial<typeof presetsQuery>
  current?: Partial<typeof currentQuery>
  details?: SubtitleStyleDetail[]
} = {}) {
  Object.assign(presetsQuery, { data: [], isLoading: false, isError: false }, overrides.presets)
  Object.assign(currentQuery, { data: null, isLoading: false, isError: false }, overrides.current)
  details = overrides.details ?? []
}

function render(canEdit = true, compact = false) {
  return renderToStaticMarkup(
    <SubtitleStylePanel jobId="job-1" canEdit={canEdit} compact={compact} />,
  )
}

describe('SubtitleStylePanel — compact picker (§1.8.2 redesign)', () => {
  it('renders a collapsed group with a status chip and no thumbnails', () => {
    setup({ presets: { data: [{ ...TIKTOK, thumbnail: 'https://cdn/x.png' }] } })

    const html = render(true, true)

    expect(html).toContain('data-testid="subtitle-style-compact"')
    expect(html).toContain('subtitleStyle.compactTitle')
    expect(html).toContain('subtitleStyle.noneShort')
    expect(html).toContain('subtitleStyle.compactHint')
    expect(html).toContain('subtitle-style-preset-style-tiktok')
    // Compact chips never render thumbnails or preview text.
    expect(html).not.toContain('https://cdn/x.png')
    expect(html).not.toContain('subtitle-style-thumb-fallback')
    expect(html).not.toContain('subtitleStyle.noPreviewText')
  })

  it('marks the assigned preset on the status chip and the active chip', () => {
    setup({
      presets: { data: [TIKTOK, YOUTUBE] },
      current: { data: { ...SNAPSHOT, font_size: 44 } },
      details: [TIKTOK, YOUTUBE],
    })

    const html = render(true, true)

    // Status chip shows the assigned preset name (font_size 44 → YouTube)…
    const status = /data-testid="subtitle-style-compact-status"[^>]*>([^<]*)</.exec(html)![1]
    expect(status).toContain('YouTube (standard bottom)')
    // …and the matching chip is aria-checked.
    const chips = html.split('<button').filter((c) => c.includes('subtitle-style-preset-'))
    const tiktok = chips.find((c) => c.includes('subtitle-style-preset-style-tiktok'))!
    const youtube = chips.find((c) => c.includes('subtitle-style-preset-style-youtube'))!
    expect(youtube).toContain('aria-checked="true"')
    expect(tiktok).toContain('aria-checked="false"')
  })
})

describe('SubtitleStylePanel — preset list rendering', () => {
  it('renders every preset by stable key and never exposes a UUID', () => {
    setup({ presets: { data: [TIKTOK, { ...YOUTUBE, preview_text: 'Xin chào' }] } })

    const html = render()

    expect(html).toContain('style-tiktok')
    expect(html).toContain('style-youtube')
    expect(html).toContain('TikTok (bold, centered-bottom)')
    expect(html).toContain('Xin chào')
    expect(html).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i)
  })

  it('marks the assigned preset active by matching the snapshot, not an id', () => {
    setup({
      presets: { data: [TIKTOK, YOUTUBE] },
      current: { data: { ...SNAPSHOT, font_size: 44 } },
      details: [TIKTOK, YOUTUBE],
    })

    const html = render()

    // Only the YouTube card (font_size 44) is active.
    expect(html).toContain('subtitleStyle.activeBadge')
    const cards = html.split('<button').filter((c) => c.includes('subtitle-style-preset-'))
    const tiktok = cards.find((c) => c.includes('subtitle-style-preset-style-tiktok'))!
    const youtube = cards.find((c) => c.includes('subtitle-style-preset-style-youtube'))!
    expect(youtube).toContain('aria-checked="true"')
    expect(tiktok).toContain('aria-checked="false"')
  })
})

describe('SubtitleStylePanel — current style', () => {
  it('shows the empty message when no style is assigned', () => {
    setup({ presets: { data: [TIKTOK] } })

    expect(render()).toContain('subtitleStyle.none')
  })

  it('shows name, key and revision of the assigned preset', () => {
    setup({
      presets: { data: [TIKTOK] },
      current: { data: SNAPSHOT },
      details: [TIKTOK],
    })

    const current = render()
    expect(current).toContain('TikTok (bold, centered-bottom)')
    expect(current).toContain('subtitleStyle.revision')
    expect(current).not.toContain('subtitleStyle.none')
  })

  it('falls back to raw attributes when the snapshot matches no live preset', () => {
    setup({
      presets: { data: [TIKTOK] },
      current: { data: { ...SNAPSHOT, font_family: 'Roboto' } },
      details: [TIKTOK],
    })

    const html = render()
    expect(html).toContain('subtitleStyle.presetUnavailable')
    expect(html).toContain('subtitleStyle.unknownPreset')
    expect(html).toContain('Roboto')
  })
})

describe('SubtitleStylePanel — UI states', () => {
  it('renders a loading state while presets load', () => {
    setup({ presets: { isLoading: true } })

    expect(render()).toContain('subtitle-style-loading')
  })

  it('renders a loading state while the current style loads', () => {
    setup({ presets: { data: [TIKTOK] }, current: { isLoading: true } })

    expect(render()).toContain('subtitle-style-loading')
  })

  it('renders an error state with retry when loading fails', () => {
    setup({ presets: { isError: true } })

    const html = render()
    expect(html).toContain('subtitle-style-error')
    expect(html).toContain('subtitleStyle.loadError')
  })

  it('renders an empty state when the deployment has no active presets', () => {
    setup({ presets: { data: [] } })

    const html = render()
    expect(html).toContain('subtitleStyle.emptyTitle')
    expect(html).not.toContain('subtitle-style-list')
  })

  it('disables selection for users without edit permission', () => {
    setup({ presets: { data: [TIKTOK] } })

    expect(render(false)).toContain('disabled=""')
  })
})

describe('SubtitleStylePanel — descriptor fallback', () => {
  it('renders the thumbnail when the descriptor provides one', () => {
    setup({ presets: { data: [{ ...TIKTOK, thumbnail: 'https://cdn/x.png' }] } })

    const html = render()
    expect(html).toContain('https://cdn/x.png')
    expect(html).not.toContain('subtitle-style-thumb-fallback')
  })

  it('falls back to a placeholder when thumbnail and previewText are null', () => {
    setup({ presets: { data: [{ ...TIKTOK, thumbnail: null, preview_text: null }] } })

    const html = render()
    expect(html).toContain('subtitle-style-thumb-fallback')
    expect(html).toContain('subtitleStyle.noPreviewText')
  })

  it('renders the optional language only when present', () => {
    setup({ presets: { data: [{ ...TIKTOK, language: 'vi' }] } })
    expect(render()).toContain('vi')
  })
})

describe('subtitleStyleErrorKey', () => {  const coded = (code: string) =>
    new ApiError({ status: 400, code, errorCode: code, message: 'server text' })

  it.each(['INVALID_STYLE_KEY', 'STYLE_NOT_FOUND', 'STYLE_NOT_ACTIVE'])(
    'maps %s to its own message',
    (code) => {
      expect(subtitleStyleErrorKey(coded(code))).toBe(`media:subtitleStyle.error.${code}`)
    },
  )

  it('falls back to a generic message for uncoded failures', () => {
    expect(subtitleStyleErrorKey(coded('SERVER_ERROR'))).toBe('common:error.generic')
    expect(subtitleStyleErrorKey(new Error('boom'))).toBe('common:error.generic')
  })

  it('never derives the message from the server text', () => {
    const key = subtitleStyleErrorKey(coded('STYLE_NOT_ACTIVE'))
    expect(key).not.toContain('server text')
  })
})

describe('runSubtitleStyleAssign', () => {
  const coded = (status: number, code: string) =>
    new ApiError({ status, code, errorCode: code, message: 'server text' })

  function harness(assign: (key: string) => Promise<unknown>, over: { busy?: boolean; canEdit?: boolean } = {}) {
    const pending: (string | null)[] = []
    const notices: (string | null)[] = []
    return {
      pending,
      notices,
      deps: {
        busy: over.busy ?? false,
        canEdit: over.canEdit ?? true,
        assign,
        onPending: (k: string | null) => pending.push(k),
        onNotice: (k: string | null) => notices.push(k),
      },
    }
  }

  it('assigns successfully, clears any stale notice and releases the pending flag', async () => {
    const assign = vi.fn().mockResolvedValue(SNAPSHOT)
    const h = harness(assign)

    await expect(runSubtitleStyleAssign('style-tiktok', h.deps)).resolves.toBeNull()

    expect(assign).toHaveBeenCalledWith('style-tiktok')
    expect(h.pending).toEqual(['style-tiktok', null])
    expect(h.notices).toEqual([null])
  })

  it('surfaces a generic message when the assign fails without a known code', async () => {
    const h = harness(vi.fn().mockRejectedValue(coded(500, 'SERVER_ERROR')))

    await expect(runSubtitleStyleAssign('style-tiktok', h.deps)).resolves.toBe(
      'common:error.generic',
    )
    expect(h.notices).toEqual([null, 'common:error.generic'])
    // The pending flag is released so the panel is usable again after a failure.
    expect(h.pending.at(-1)).toBeNull()
  })

  it('surfaces STYLE_NOT_ACTIVE when the preset was retired', async () => {
    const h = harness(vi.fn().mockRejectedValue(coded(404, 'STYLE_NOT_ACTIVE')))

    await expect(runSubtitleStyleAssign('style-old', h.deps)).resolves.toBe(
      'media:subtitleStyle.error.STYLE_NOT_ACTIVE',
    )
  })

  it('surfaces INVALID_STYLE_KEY when the key is malformed', async () => {
    const h = harness(vi.fn().mockRejectedValue(coded(400, 'INVALID_STYLE_KEY')))

    await expect(runSubtitleStyleAssign('Style TikTok!', h.deps)).resolves.toBe(
      'media:subtitleStyle.error.INVALID_STYLE_KEY',
    )
  })

  it('surfaces STYLE_NOT_FOUND when the preset does not exist', async () => {
    const h = harness(vi.fn().mockRejectedValue(coded(404, 'STYLE_NOT_FOUND')))

    await expect(runSubtitleStyleAssign('style-ghost', h.deps)).resolves.toBe(
      'media:subtitleStyle.error.STYLE_NOT_FOUND',
    )
  })

  it('ignores a second submit while one is in flight', async () => {
    const assign = vi.fn().mockResolvedValue(SNAPSHOT)
    const h = harness(assign, { busy: true })

    await runSubtitleStyleAssign('style-youtube', h.deps)

    expect(assign).not.toHaveBeenCalled()
    expect(h.pending).toEqual([])
  })

  it('ignores a submit from a viewer without edit permission', async () => {
    const assign = vi.fn().mockResolvedValue(SNAPSHOT)
    const h = harness(assign, { canEdit: false })

    await runSubtitleStyleAssign('style-youtube', h.deps)

    expect(assign).not.toHaveBeenCalled()
  })
})
