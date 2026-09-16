import { create } from 'zustand'

/** Editor-local state (09b E.1 / E.4) — not persisted. */
interface EditorState {
  activeSegmentId: string | null
  streamingTokens: string
  pipelineStage: string | null
  unsavedSegmentIds: Set<string>
  draftTargets: Record<string, string>
  lastSavedAt: Record<string, number>
  savingSegmentIds: Set<string>
  editing: boolean
  setActiveSegmentId: (id: string | null) => void
  setPipelineStage: (stage: string | null) => void
  setStreamingTokens: (tokens: string) => void
  appendStreamingTokens: (tokens: string) => void
  setEditing: (editing: boolean) => void
  setDraftTarget: (segmentId: string, text: string) => void
  clearDraft: (segmentId: string) => void
  markUnsaved: (segmentId: string) => void
  markSaving: (segmentId: string) => void
  markSaved: (segmentId: string) => void
  markSaveFailed: (segmentId: string) => void
  reset: () => void
}

const empty = {
  activeSegmentId: null as string | null,
  streamingTokens: '',
  pipelineStage: null as string | null,
  unsavedSegmentIds: new Set<string>(),
  draftTargets: {} as Record<string, string>,
  lastSavedAt: {} as Record<string, number>,
  savingSegmentIds: new Set<string>(),
  editing: false,
}

export const useEditorStore = create<EditorState>((set) => ({
  ...empty,
  setActiveSegmentId: (id) => set({ activeSegmentId: id }),
  setPipelineStage: (stage) => set({ pipelineStage: stage }),
  setStreamingTokens: (tokens) => set({ streamingTokens: tokens }),
  appendStreamingTokens: (tokens) =>
    set((s) => ({ streamingTokens: s.streamingTokens + tokens })),
  setEditing: (editing) => set({ editing }),
  setDraftTarget: (segmentId, text) =>
    set((s) => ({
      draftTargets: { ...s.draftTargets, [segmentId]: text },
    })),
  clearDraft: (segmentId) =>
    set((s) => {
      const draftTargets = { ...s.draftTargets }
      delete draftTargets[segmentId]
      return { draftTargets }
    }),
  markUnsaved: (segmentId) =>
    set((s) => {
      const unsaved = new Set(s.unsavedSegmentIds)
      unsaved.add(segmentId)
      const saving = new Set(s.savingSegmentIds)
      saving.delete(segmentId)
      return { unsavedSegmentIds: unsaved, savingSegmentIds: saving }
    }),
  markSaving: (segmentId) =>
    set((s) => {
      const saving = new Set(s.savingSegmentIds)
      saving.add(segmentId)
      return { savingSegmentIds: saving }
    }),
  markSaved: (segmentId) =>
    set((s) => {
      const unsaved = new Set(s.unsavedSegmentIds)
      unsaved.delete(segmentId)
      const saving = new Set(s.savingSegmentIds)
      saving.delete(segmentId)
      const draftTargets = { ...s.draftTargets }
      delete draftTargets[segmentId]
      return {
        unsavedSegmentIds: unsaved,
        savingSegmentIds: saving,
        draftTargets,
        lastSavedAt: { ...s.lastSavedAt, [segmentId]: Date.now() },
      }
    }),
  markSaveFailed: (segmentId) =>
    set((s) => {
      const saving = new Set(s.savingSegmentIds)
      saving.delete(segmentId)
      const unsaved = new Set(s.unsavedSegmentIds)
      unsaved.add(segmentId)
      return { savingSegmentIds: saving, unsavedSegmentIds: unsaved }
    }),
  reset: () =>
    set({
      ...empty,
      unsavedSegmentIds: new Set(),
      draftTargets: {},
      lastSavedAt: {},
      savingSegmentIds: new Set(),
    }),
}))
