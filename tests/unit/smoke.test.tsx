import { render, screen } from '@testing-library/react'
import { describe, expect, test } from 'vitest'
import { App } from '@client/App'

describe('App root', () => {
  test('renders the application root heading', () => {
    render(<App />)
    expect(screen.getByRole('heading', { name: /sudowork webui/i })).toBeTruthy()
  })
})
