import { beforeEach, describe, expect, it, vi } from 'vitest'
import { QueryClient } from '@tanstack/react-query'
import { queryKeys } from '@/lib/queryClient'
import { ApiError } from '@/types/api'

const getJobSubtitleStyleApi = vi.fn()

vi.mock('@/api/subtitleStyle', () => ({
  getJobSubtitleStyleApi: (...a: unknown[]) => getJobSubtitleStyleApi(...a),
  assignJobSubtitleStyleApi: vi.fn(),
  getSubtitleStyleApi: vi.fn(),
  listSubtitleStylePresetsApi: vi.fn(),
}))

const { applyAssignedSubtitleStyle, fetchJobSubtitleStyle, matchAssignedPreset } = await import(
  './useSubtitleStyle'
)

const SNAPSHOT = {
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

const TIKTOK = { ...SNAPSHOT, key: 'style-tiktok', name: 'TikTok', revision: 1 }

const coded = (status: number, code: string) =>
  new ApiError({ status, code, errorCode: code, message: 'server text' })

beforeEach(() => {
  getJobSubtitleStyleApi.mockReset()
})

describe('matchAssignedPreset', () => {
  it('identifies the preset whose full snapshot equals the assigned one', () => {
    expect(matchAssignedPreset(SNAPSHOT, [TIKTOK])?.key).toBe('style-tiktok')
  })

  it('does not expose a preset identity when multiple details reproduce the snapshot', () => {
    const duplicate = { ...TIKTOK, key: 'style-duplicate', name: 'Duplicate' }

    expect(matchAssignedPreset(SNAPSHOT, [TIKTOK, duplicate])).toBeNull()
  })

  it('does not match on partial overlap — one differing field disqualifies', () => {
    expect(matchAssignedPreset({ ...SNAPSHOT, font_size: 44 }, [TIKTOK])).toBeNull()
    expect(matchAssignedPreset({ ...SNAPSHOT, bold: false }, [TIKTOK])).toBeNull()
    expect(matchAssignedPreset({ ...SNAPSHOT, opacity: 80 }, [TIKTOK])).toBeNull()
  })

  it('treats an omitted optional background as equal to an explicit null', () => {
    const withoutBackground = { ...SNAPSHOT }
    delete (withoutBackground as { background?: unknown }).background
    expect(matchAssignedPreset(withoutBackground, [TIKTOK])?.key).toBe('style-tiktok')
  })

  it('returns null when nothing is assigned or nothing matches', () => {
    expect(matchAssignedPreset(null, [TIKTOK])).toBeNull()
    expect(matchAssignedPreset(SNAPSHOT, [])).toBeNull()
  })
})

describe('fetchJobSubtitleStyle', () => {
  it('resolves the assigned snapshot', async () => {
    getJobSubtitleStyleApi.mockResolvedValue(SNAPSHOT)

    await expect(fetchJobSubtitleStyle('job-1')).resolves.toEqual(SNAPSHOT)
    expect(getJobSubtitleStyleApi).toHaveBeenCalledWith('job-1')
  })

  it('treats STYLE_NOT_FOUND as the empty state, not a failure', async () => {
    getJobSubtitleStyleApi.mockRejectedValue(coded(404, 'STYLE_NOT_FOUND'))

    await expect(fetchJobSubtitleStyle('job-1')).resolves.toBeNull()
  })

  it('surfaces a forbidden error so it cannot masquerade as an empty panel', async () => {
    getJobSubtitleStyleApi.mockRejectedValue(coded(403, 'FORBIDDEN'))

    await expect(fetchJobSubtitleStyle('job-1')).rejects.toMatchObject({ code: 'FORBIDDEN' })
  })

  it('surfaces server errors rather than swallowing them', async () => {
    getJobSubtitleStyleApi.mockRejectedValue(coded(500, 'SERVER_ERROR'))

    await expect(fetchJobSubtitleStyle('job-1')).rejects.toMatchObject({ status: 500 })
  })
})

describe('applyAssignedSubtitleStyle', () => {
  it('stores the authoritative response and refreshes only the style key', () => {
    const qc = new QueryClient()
    qc.setQueryData(queryKeys.mediaJob('ws-1', 'job-1'), { voiceId: 'v-1' })
    qc.setQueryData(queryKeys.mediaProposals('ws-1', 'job-1'), [{ id: 'p-1' }])
    const invalidate = vi.spyOn(qc, 'invalidateQueries').mockResolvedValue(undefined)

    applyAssignedSubtitleStyle(qc, 'job-1', SNAPSHOT)

    expect(qc.getQueryData(queryKeys.jobSubtitleStyle('job-1'))).toEqual(SNAPSHOT)
    // Voice, proposals and timeline must survive an assign.
    expect(qc.getQueryData(queryKeys.mediaJob('ws-1', 'job-1'))).toEqual({ voiceId: 'v-1' })
    expect(qc.getQueryData(queryKeys.mediaProposals('ws-1', 'job-1'))).toEqual([{ id: 'p-1' }])
    expect(invalidate).toHaveBeenCalledTimes(1)
    expect(invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.jobSubtitleStyle('job-1') })
  })

  it('stores the server snapshot even when it differs from the requested preset', () => {
    // First-write-wins: the job keeps its existing style and the server says so.
    const qc = new QueryClient()
    const existing = { ...SNAPSHOT, font_size: 44 }

    applyAssignedSubtitleStyle(qc, 'job-1', existing)

    expect(qc.getQueryData(queryKeys.jobSubtitleStyle('job-1'))).toEqual(existing)
  })
})
