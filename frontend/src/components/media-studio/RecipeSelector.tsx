import { useTranslation } from 'react-i18next'
import { IconLanguage, IconSparkles } from '@tabler/icons-react'
import { cn } from '@/lib/cn'
import type { MediaRecipeId } from '@/types/media'

type Props = {
  value: MediaRecipeId
  disabled?: boolean
  generativeAvailable: boolean
  onChange: (recipeId: MediaRecipeId) => void
}

export function RecipeSelector({
  value,
  disabled = false,
  generativeAvailable,
  onChange,
}: Props) {
  const { t } = useTranslation('media')

  // C2 (docs/19 §1.8.2): create offers only localization.full + summary.generative.
  // summary.extractive ("Cắt highlight") is legacy — backend + legacy job
  // rendering stay, the create entry is gone (extractive jobs still run).
  const recipes: Array<{
    id: MediaRecipeId
    title: string
    description: string
    icon: typeof IconLanguage
  }> = [
    ...(generativeAvailable
      ? [{
          id: 'summary.generative' as const,
          title: t('modeGenerative'),
          description: t('modeGenerativeDesc'),
          icon: IconSparkles,
        }]
      : []),
    {
      id: 'localization.full',
      title: t('modeTranslateOnly'),
      description: t('modeTranslateOnlyDesc'),
      icon: IconLanguage,
    },
  ]

  return (
    <div
      className={cn(
        'grid gap-3.5 sm:grid-cols-2',
        recipes.length === 2 && 'lg:grid-cols-2',
      )}
      role="radiogroup"
      aria-label={t('modeLabel')}
    >
      {recipes.map((recipe) => {
        const Icon = recipe.icon
        const isGenerative = recipe.id === 'summary.generative'
        const isSelected = value === recipe.id
        return (
          <button
            key={recipe.id}
            type="button"
            role="radio"
            aria-checked={isSelected}
            className={cn('media-mode-card media-recipe-card text-left', isSelected && 'selected')}
            disabled={disabled}
            onClick={() => onChange(recipe.id)}
          >
            <div className="flex items-start justify-between gap-2 mb-2">
              <div className="flex items-center gap-2">
                <div
                  className={cn(
                    'flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition-colors',
                    isSelected
                      ? 'bg-[var(--color-media)] text-white'
                      : 'bg-[var(--color-media-soft)] text-[var(--color-media)]',
                  )}
                >
                  <Icon size={18} />
                </div>
                <span className="text-sm font-semibold text-[var(--color-text-primary)]">
                  {recipe.title}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <span
                  className={cn(
                    'media-recipe-badge',
                    isGenerative ? 'generative' : 'localization',
                  )}
                >
                  {isGenerative ? (
                    <span className="inline-flex items-center gap-1">
                      <IconSparkles size={11} stroke={2} />
                      <span>AI Tóm tắt</span>
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1">
                      <IconLanguage size={11} stroke={2} />
                      <span>Toàn bộ</span>
                    </span>
                  )}
                </span>
                <span
                  className={cn('media-recipe-radio', isSelected && 'active')}
                  aria-hidden="true"
                />
              </div>
            </div>

            <div className="text-xs text-[var(--color-text-secondary)] leading-relaxed">
              {recipe.description}
            </div>
          </button>
        )
      })}
    </div>
  )
}
