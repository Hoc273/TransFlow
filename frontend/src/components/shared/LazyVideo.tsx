import { useEffect, useRef, useState, type Ref, type VideoHTMLAttributes } from 'react'

interface LazyVideoProps extends Omit<VideoHTMLAttributes<HTMLVideoElement>, 'src' | 'autoPlay' | 'preload'> {
  src: string
  /** false = đang bị ẩn (vd. video của theme khác): chưa tải, hoặc tạm dừng nếu đã tải. */
  active?: boolean
  /** Tải trước khi video còn cách viewport khoảng này. */
  rootMargin?: string
  ref?: Ref<HTMLVideoElement>
}

/**
 * Video nền muted/loop chỉ gắn `src` khi sắp vào viewport (và đang active), phát khi nhìn thấy,
 * dừng khi ra khỏi màn hình. Thay cho `<video autoPlay>` để landing không kéo hàng chục MB
 * video ngay lần tải đầu.
 */
export function LazyVideo({ src, active = true, rootMargin = '200px', ref, ...rest }: LazyVideoProps) {
  const innerRef = useRef<HTMLVideoElement | null>(null)
  const [inView, setInView] = useState(() => typeof IntersectionObserver === 'undefined')
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    const el = innerRef.current
    if (!el || typeof IntersectionObserver === 'undefined') return
    const observer = new IntersectionObserver(([entry]) => setInView(entry.isIntersecting), { rootMargin })
    observer.observe(el)
    return () => observer.disconnect()
  }, [rootMargin])

  const shouldPlay = inView && active
  if (shouldPlay && !loaded) setLoaded(true)

  useEffect(() => {
    const el = innerRef.current
    if (!el || !loaded) return
    if (shouldPlay) el.play()?.catch?.(() => {})
    else el.pause()
  }, [shouldPlay, loaded, src])

  const setRefs = (el: HTMLVideoElement | null) => {
    innerRef.current = el
    if (typeof ref === 'function') ref(el)
    else if (ref) ref.current = el
  }

  return (
    <video
      ref={setRefs}
      src={loaded ? src : undefined}
      preload="none"
      loop
      muted
      playsInline
      {...rest}
    />
  )
}
