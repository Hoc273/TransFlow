import { useEffect, useRef, useState, type FormEvent } from 'react'
import {
  IconAlertCircle,
  IconCheck,
  IconDeviceFloppy,
  IconLoader2,
  IconLock,
  IconUpload,
  IconUser,
} from '@tabler/icons-react'
import { useTranslation } from 'react-i18next'
import { useAuthStore } from '@/store/authStore'
import { useUpdateProfile, useDeleteAvatar } from '@/hooks/useAuth'
import { initialsFromName } from '@/lib/format'

/**
 * Profile Section — Sleek, High-end SaaS profile layout.
 */
export function ProfileSection() {
  const { t } = useTranslation(['account', 'common'])
  const user = useAuthStore((s) => s.user)
  const updateProfile = useUpdateProfile()
  const deleteAvatar = useDeleteAvatar()
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [fullName, setFullName] = useState(user?.fullName ?? '')
  const [error, setError] = useState<string | null>(null)
  const [banner, setBanner] = useState<'success' | 'info' | null>(null)
  const [avatarLoading, setAvatarLoading] = useState(false)
  const [avatarError, setAvatarError] = useState<string | null>(null)
  const [avatarSuccess, setAvatarSuccess] = useState<string | null>(null)
  const [previewAvatar, setPreviewAvatar] = useState<string | null>(() => user?.avatarUrl ?? null)

  useEffect(() => {
    setFullName(user?.fullName ?? '')
  }, [user?.fullName])

  useEffect(() => {
    if (user?.avatarUrl !== undefined) {
      setPreviewAvatar(user.avatarUrl)
    }
  }, [user?.avatarUrl])

  const initials = user ? initialsFromName(user.fullName) : 'TF'
  const email = user?.email ?? ''

  const onUploadClick = () => {
    setAvatarError(null)
    setAvatarSuccess(null)
    fileInputRef.current?.click()
  }

  const onFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return

    setAvatarError(null)
    setAvatarSuccess(null)

    if (file.size > 2 * 1024 * 1024) {
      setAvatarError(
        t('account:profile.avatarSizeError', {
          defaultValue: 'Dung lượng ảnh vượt quá 2MB. Vui lòng chọn ảnh nhỏ hơn.',
        }),
      )
      return
    }

    if (!file.type.startsWith('image/')) {
      setAvatarError(
        t('account:profile.avatarTypeError', {
          defaultValue: 'Chỉ chấp nhận định dạng JPG, PNG hoặc GIF.',
        }),
      )
      return
    }

    setAvatarLoading(true)
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(reader.result as string)
        reader.onerror = reject
        reader.readAsDataURL(file)
      })

      const optimizedUrl = await new Promise<string>((resolve) => {
        const img = new Image()
        img.onload = () => {
          const MAX = 400
          let w = img.width
          let h = img.height
          if (w > h) {
            if (w > MAX) {
              h = Math.round((h * MAX) / w)
              w = MAX
            }
          } else {
            if (h > MAX) {
              w = Math.round((w * MAX) / h)
              h = MAX
            }
          }
          const canvas = document.createElement('canvas')
          canvas.width = w
          canvas.height = h
          const ctx = canvas.getContext('2d')
          if (ctx) {
            ctx.drawImage(img, 0, 0, w, h)
            resolve(canvas.toDataURL(file.type === 'image/png' ? 'image/png' : 'image/jpeg', 0.88))
          } else {
            resolve(dataUrl)
          }
        }
        img.onerror = () => resolve(dataUrl)
        img.src = dataUrl
      })

      setPreviewAvatar(optimizedUrl)
      await updateProfile.mutateAsync({
        fullName: fullName.trim() || user?.fullName || '',
        avatarUrl: optimizedUrl,
      })
      setAvatarSuccess(
        t('account:profile.avatarUploadSuccess', {
          defaultValue: 'Đã cập nhật ảnh đại diện thành công.',
        }),
      )
      window.setTimeout(() => setAvatarSuccess(null), 4000)
    } catch (err: unknown) {
      setPreviewAvatar(user?.avatarUrl ?? null)
      const msg =
        err instanceof Error
          ? err.message
          : t('account:profile.updateFailed', { defaultValue: 'Cập nhật ảnh đại diện thất bại' })
      setAvatarError(msg)
    } finally {
      setAvatarLoading(false)
    }
  }

  const onRemoveAvatar = async () => {
    if (!previewAvatar && !user?.avatarUrl) return
    setAvatarError(null)
    setAvatarSuccess(null)
    setAvatarLoading(true)
    try {
      setPreviewAvatar(null)
      await deleteAvatar.mutateAsync()
      setAvatarSuccess(
        t('account:profile.avatarRemoveSuccess', {
          defaultValue: 'Đã xóa ảnh đại diện thành công.',
        }),
      )
      window.setTimeout(() => setAvatarSuccess(null), 4000)
    } catch (err: unknown) {
      const msg =
        err instanceof Error
          ? err.message
          : t('account:profile.updateFailed', { defaultValue: 'Xóa ảnh đại diện thất bại' })
      setAvatarError(msg)
    } finally {
      setAvatarLoading(false)
    }
  }

  const onReset = () => {
    setFullName(user?.fullName ?? '')
    setError(null)
    setBanner(null)
  }

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    setBanner(null)
    const trimmed = fullName.trim()
    if (!trimmed) {
      setError(t('account:profile.fullNameRequired'))
      return
    }

    try {
      await updateProfile.mutateAsync({ fullName: trimmed })
      setBanner('success')
      window.setTimeout(() => setBanner(null), 4000)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : t('account:profile.updateFailed', { defaultValue: 'Cập nhật hồ sơ thất bại' })
      setError(msg)
    }
  }

  return (
    <div className="space-y-6">
      {/* Avatar & Identity Banner Card */}
      <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-surface)] p-6 shadow-xs">
        <input
          ref={fileInputRef}
          type="file"
          accept="image/jpeg,image/png,image/gif,image/webp"
          className="hidden"
          onChange={onFileChange}
        />
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-5">
          <div className="flex items-center gap-4">
            <div className="relative group">
              <div className="flex h-16 w-16 items-center justify-center overflow-hidden rounded-2xl bg-linear-to-tr from-[#714ffc] to-[#a855f7] text-xl font-bold text-white shadow-md shadow-[#714ffc]/20 ring-2 ring-[var(--color-bg-surface)]">
                {avatarLoading ? (
                  <IconLoader2 size={24} className="animate-spin text-white" />
                ) : (previewAvatar ?? user?.avatarUrl) ? (
                  <img
                    src={(previewAvatar ?? user?.avatarUrl)!}
                    alt={user?.fullName || ''}
                    className="h-full w-full rounded-2xl object-cover"
                  />
                ) : (
                  initials
                )}
              </div>
              <button
                type="button"
                onClick={onUploadClick}
                disabled={avatarLoading}
                className="absolute -bottom-1 -right-1 flex h-6 w-6 items-center justify-center rounded-full bg-[var(--color-bg-surface-3)] text-[var(--color-text-primary)] shadow-sm hover:bg-[var(--color-accent)] hover:text-white transition disabled:opacity-50 cursor-pointer"
                title={t('account:profile.avatarUpload')}
              >
                <IconUpload size={12} />
              </button>
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-base font-semibold text-[var(--color-text-primary)]">
                  {user?.fullName || t('common:user.demoName')}
                </h3>
                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[11px] font-medium text-emerald-400">
                  <IconCheck size={10} stroke={2.5} />
                  <span>Active</span>
                </span>
              </div>
              <p className="text-xs text-[var(--color-text-secondary)] mt-0.5">{email}</p>
              <p className="text-[11px] text-[var(--color-text-tertiary)] mt-1">{t('account:profile.avatarHint')}</p>
            </div>
          </div>

          <div className="flex items-center gap-2 self-start sm:self-center">
            <button
              type="button"
              className="btn-secondary btn-sm flex items-center gap-1.5 cursor-pointer"
              onClick={onUploadClick}
              disabled={avatarLoading}
            >
              {avatarLoading ? (
                <IconLoader2 size={13} className="animate-spin" />
              ) : (
                <IconUpload size={13} />
              )}
              <span>{t('account:profile.avatarUpload')}</span>
            </button>
            <button
              type="button"
              className="btn-ghost btn-sm text-[var(--color-text-tertiary)] hover:text-[var(--color-error)] disabled:opacity-40 disabled:hover:text-[var(--color-text-tertiary)] cursor-pointer"
              onClick={onRemoveAvatar}
              disabled={avatarLoading || !(previewAvatar ?? user?.avatarUrl)}
            >
              <span>{t('account:profile.avatarRemove')}</span>
            </button>
          </div>
        </div>

        {avatarError && (
          <div className="mt-4 flex items-center gap-2 rounded-lg border border-[var(--color-error)]/25 bg-[var(--color-error)]/10 px-3.5 py-2.5 text-xs text-[var(--color-error)] animate-in fade-in">
            <IconAlertCircle size={15} className="shrink-0" />
            <span>{avatarError}</span>
          </div>
        )}

        {avatarSuccess && (
          <div className="mt-4 flex items-center gap-2 rounded-lg border border-emerald-500/25 bg-emerald-500/10 px-3.5 py-2.5 text-xs text-emerald-400 animate-in fade-in">
            <IconCheck size={15} className="shrink-0" />
            <span>{avatarSuccess}</span>
          </div>
        )}
      </div>

      {/* Main Profile Form Card */}
      <form onSubmit={onSubmit} className="rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-surface)] p-6 shadow-xs">
        <div className="border-b border-[var(--color-border)] pb-4 mb-6">
          <h2 className="text-sm font-semibold text-[var(--color-text-primary)] flex items-center gap-2">
            <IconUser size={16} className="text-[var(--color-accent)]" />
            {t('account:profile.title')}
          </h2>
          <p className="text-xs text-[var(--color-text-secondary)] mt-1">
            {t('account:profile.desc')}
          </p>
        </div>

        {banner === 'success' && (
          <div className="mb-6 flex items-center gap-2.5 rounded-lg border border-emerald-500/25 bg-emerald-500/10 px-4 py-3 text-xs text-emerald-400 animate-in fade-in">
            <IconCheck size={16} className="shrink-0" />
            <div>
              <div className="font-semibold">{t('account:profile.saveSuccess')}</div>
              <div className="opacity-80 text-[11px] mt-0.5">{t('account:profile.saveLocal')}</div>
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          {/* Full Name */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-[var(--color-text-secondary)] flex items-center gap-1" htmlFor="profile-fullName">
              <span>{t('account:profile.fullName')}</span>
              <span className="text-[var(--color-error)]">*</span>
            </label>
            <input
              id="profile-fullName"
              type="text"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder={t('account:profile.fullNamePh')}
              className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-surface-2)] px-3 py-2 text-xs text-[var(--color-text-primary)] placeholder:text-[var(--color-text-tertiary)] focus:border-[var(--color-accent)] focus:outline-hidden transition"
              autoComplete="name"
            />
            {error && (
              <div className="flex items-center gap-1 text-[11px] text-[var(--color-error)] mt-1">
                <IconAlertCircle size={12} />
                <span>{error}</span>
              </div>
            )}
          </div>

          {/* Email (Read-only) */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-[var(--color-text-secondary)] flex items-center gap-1.5" htmlFor="profile-email">
              <IconLock size={12} className="text-[var(--color-text-tertiary)]" />
              <span>{t('account:profile.email')}</span>
            </label>
            <input
              id="profile-email"
              type="email"
              value={email}
              readOnly
              className="w-full cursor-not-allowed rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-surface-3)] px-3 py-2 text-xs text-[var(--color-text-secondary)] opacity-80"
            />
            <p className="text-[11px] text-[var(--color-text-tertiary)]">{t('account:profile.emailHelp')}</p>
          </div>
        </div>

        {/* Action Bar */}
        <div className="mt-8 flex items-center justify-end gap-3 border-t border-[var(--color-border)] pt-5">
          <button
            type="button"
            className="btn-ghost btn-sm text-xs"
            onClick={onReset}
          >
            {t('account:common.cancel')}
          </button>
          <button
            type="submit"
            disabled={updateProfile.isPending}
            className="btn-primary btn-sm flex items-center gap-1.5 text-xs shadow-xs"
          >
            <IconDeviceFloppy size={14} />
            <span>{updateProfile.isPending ? t('account:common.saving', { defaultValue: 'Đang lưu...' }) : t('account:common.save')}</span>
          </button>
        </div>
      </form>
    </div>
  )
}
