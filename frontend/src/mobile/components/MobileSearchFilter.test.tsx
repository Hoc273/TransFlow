// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeAll } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { MobileSearchFilter } from './MobileSearchFilter'
import i18n from '@/i18n'

afterEach(() => cleanup())

beforeAll(async () => {
  await i18n.changeLanguage('vi')
})

describe('MobileSearchFilter', () => {
  it('renders default Vietnamese placeholder "Tìm kiếm..."', () => {
    render(<MobileSearchFilter value="" onChange={vi.fn()} />)
    expect(screen.getByPlaceholderText('Tìm kiếm...')).toBeTruthy()
  })
})
