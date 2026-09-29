// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render } from '@testing-library/react'
import { LazyVideo } from './LazyVideo'

type ObserverCallback = (entries: Array<{ isIntersecting: boolean }>) => void
let observerCallbacks: ObserverCallback[] = []

function setVisible(visible: boolean) {
  act(() => observerCallbacks.forEach((cb) => cb([{ isIntersecting: visible }])))
}

describe('LazyVideo', () => {
  beforeEach(() => {
    observerCallbacks = []
    vi.stubGlobal(
      'IntersectionObserver',
      class {
        constructor(cb: ObserverCallback) {
          observerCallbacks.push(cb)
        }
        observe() {}
        disconnect() {}
      },
    )
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined)
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {})
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('does not load the video until it scrolls near the viewport', () => {
    const { container } = render(<LazyVideo src="/v.mp4" />)
    const video = container.querySelector('video')!
    expect(video.getAttribute('src')).toBeNull()
    expect(video.getAttribute('preload')).toBe('none')
    expect(video.muted).toBe(true)

    setVisible(true)
    expect(video.getAttribute('src')).toBe('/v.mp4')
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalled()
  })

  it('pauses off-screen and keeps the source once loaded', () => {
    const { container } = render(<LazyVideo src="/v.mp4" />)
    const video = container.querySelector('video')!
    setVisible(true)
    setVisible(false)
    expect(HTMLMediaElement.prototype.pause).toHaveBeenCalled()
    expect(video.getAttribute('src')).toBe('/v.mp4')
  })

  it('never loads an inactive video even when visible', () => {
    const { container, rerender } = render(<LazyVideo src="/v.mp4" active={false} />)
    const video = container.querySelector('video')!
    setVisible(true)
    expect(video.getAttribute('src')).toBeNull()

    rerender(<LazyVideo src="/v.mp4" active />)
    expect(video.getAttribute('src')).toBe('/v.mp4')
  })

  it('forwards the ref to the video element', () => {
    const ref = { current: null as HTMLVideoElement | null }
    render(<LazyVideo src="/v.mp4" ref={ref} />)
    expect(ref.current).toBeInstanceOf(HTMLVideoElement)
  })
})
