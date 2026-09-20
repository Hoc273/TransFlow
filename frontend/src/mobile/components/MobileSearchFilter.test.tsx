// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { MobileSearchFilter } from './MobileSearchFilter'

afterEach(() => cleanup())

describe('MobileSearchFilter', () => {
  it('renders default Vietnamese placeholder "Tìm kiếm..."', () => {
    render(<MobileSearchFilter value="" onChange={vi.fn()} />)
    expect(screen.getByPlaceholderText('Tìm kiếm...')).toBeTruthy()
  })
})
