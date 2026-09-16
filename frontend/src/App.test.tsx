import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import App from './App'

describe('App Smoke Test', () => {
  it('renders application title', () => {
    render(<App />)
    expect(screen.getByText(/TransFlow UI 2.0/i)).toBeDefined()
  })
})
