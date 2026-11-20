import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { renderWithProviders } from '~/test/render'
import { describedText, Harness, readValues } from './test-harness'

const SERVER_ERROR = { field: 'value', code: 'server_rule', message: 'Rejected by the server.' }

describe('TextField', () => {
  const schema = z.object({ value: z.string().min(2, 'Enter at least 2 characters.') })

  function setup(required = false, onSubmit = vi.fn()) {
    renderWithProviders(() => (
      <Harness
        initial={{ value: null }}
        schema={schema}
        onSubmit={onSubmit}
        serverErrors={[SERVER_ERROR]}
      >
        {(form) => (
          <form.AppField name="value">
            {(field) => (
              <field.TextField
                label="First name"
                helpText="As on the ID card"
                required={required}
              />
            )}
          </form.AppField>
        )}
      </Harness>
    ))
    return { onSubmit }
  }

  it('marks an optional field with "(optional)" and a required one with aria-required', async () => {
    setup(false)
    expect(await screen.findByLabelText('First name (optional)')).not.toHaveAttribute(
      'aria-required',
    )
  })

  it('sets aria-required and leaves out "(optional)" when required', async () => {
    setup(true)
    const input = await screen.findByLabelText('First name')
    expect(input).toHaveAttribute('aria-required', 'true')
    expect(input).toHaveAttribute('name', 'value')
    expect(describedText(input)).toContain('As on the ID card')
  })

  it('stores typed text, and null when emptied', async () => {
    const user = userEvent.setup()
    setup(true)
    const input = await screen.findByLabelText('First name')
    await user.type(input, 'Ayesha')
    expect(readValues().value).toBe('Ayesha')
    await user.clear(input)
    expect(readValues().value).toBeNull()
  })

  it('shows the Zod error after submit and links it with aria-describedby', async () => {
    const user = userEvent.setup()
    const { onSubmit } = setup(true)
    const input = await screen.findByLabelText('First name')
    await user.type(input, 'A')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByText('Enter at least 2 characters.')).toBeInTheDocument()
    expect(input).toHaveAttribute('aria-invalid', 'true')
    expect(describedText(input)).toContain('Enter at least 2 characters.')
    expect(screen.getByRole('alert')).toHaveTextContent('Please check the highlighted fields.')
    expect(onSubmit).not.toHaveBeenCalled()
    await waitFor(() => expect(input).toHaveFocus())

    await user.type(input, 'yesha')
    expect(screen.queryByText('Enter at least 2 characters.')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith({ value: 'Ayesha' }))
  })

  it('shows a server error and clears it on change', async () => {
    const user = userEvent.setup()
    setup(true)
    const input = await screen.findByLabelText('First name')
    await user.click(screen.getByRole('button', { name: 'Apply server errors' }))
    expect(await screen.findByText('Rejected by the server.')).toBeInTheDocument()
    expect(describedText(input)).toContain('Rejected by the server.')
    await user.type(input, 'B')
    expect(screen.queryByText('Rejected by the server.')).not.toBeInTheDocument()
    expect(input).not.toHaveAttribute('aria-invalid')
  })
})

describe('TextAreaField', () => {
  const schema = z.object({
    value: z.string().max(10, 'Keep it under 10 characters.').nullable(),
  })

  function setup() {
    renderWithProviders(() => (
      <Harness initial={{ value: null }} schema={schema} serverErrors={[SERVER_ERROR]}>
        {(form) => (
          <form.AppField name="value">
            {(field) => <field.TextAreaField label="About me" maxLength={10} />}
          </form.AppField>
        )}
      </Harness>
    ))
  }

  it('renders "(optional)", dir="auto" and a counter', async () => {
    const user = userEvent.setup()
    setup()
    const textarea = await screen.findByLabelText('About me (optional)')
    expect(textarea).toHaveAttribute('dir', 'auto')
    expect(screen.getByText('0 / 10')).toBeInTheDocument()
    await user.type(textarea, 'Hello')
    expect(screen.getByText('5 / 10')).toBeInTheDocument()
    expect(describedText(textarea)).toContain('5 of 10 characters used')
    expect(readValues().value).toBe('Hello')
  })

  it('shows the Zod error after submit and a server error that clears on change', async () => {
    const user = userEvent.setup()
    setup()
    const textarea = await screen.findByLabelText('About me (optional)')
    await user.type(textarea, 'Hello there, world')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByText('Keep it under 10 characters.')).toBeInTheDocument()
    expect(describedText(textarea)).toContain('Keep it under 10 characters.')

    await user.clear(textarea)
    await user.click(screen.getByRole('button', { name: 'Apply server errors' }))
    expect(await screen.findByText('Rejected by the server.')).toBeInTheDocument()
    await user.type(textarea, 'x')
    expect(screen.queryByText('Rejected by the server.')).not.toBeInTheDocument()
  })
})

describe('NumberField', () => {
  const schema = z.object({
    value: z.number({ error: 'Enter a number.' }).int().min(1).max(15, 'Enter 1 to 15.'),
  })

  function setup() {
    renderWithProviders(() => (
      <Harness initial={{ value: null }} schema={schema} serverErrors={[SERVER_ERROR]}>
        {(form) => (
          <form.AppField name="value">
            {(field) => (
              <field.NumberField label="How many children?" required min={1} max={15} stepper />
            )}
          </form.AppField>
        )}
      </Harness>
    ))
  }

  it('keeps digits only and stores a number', async () => {
    const user = userEvent.setup()
    setup()
    const input = await screen.findByLabelText('How many children?')
    expect(input).toHaveAttribute('inputmode', 'numeric')
    await user.type(input, '1a2')
    expect(input).toHaveValue('12')
    expect(readValues().value).toBe(12)
    await user.clear(input)
    expect(readValues().value).toBeNull()
  })

  it('steps with the buttons within min and max', async () => {
    const user = userEvent.setup()
    setup()
    await screen.findByLabelText('How many children?')
    await user.click(screen.getByRole('button', { name: 'Increase How many children?' }))
    expect(readValues().value).toBe(1)
    await user.click(screen.getByRole('button', { name: 'Increase How many children?' }))
    expect(readValues().value).toBe(2)
    await user.click(screen.getByRole('button', { name: 'Decrease How many children?' }))
    await user.click(screen.getByRole('button', { name: 'Decrease How many children?' }))
    expect(readValues().value).toBe(1)
    expect(screen.getByRole('button', { name: 'Decrease How many children?' })).toBeDisabled()
  })

  it('shows the Zod error after submit and a server error that clears on change', async () => {
    const user = userEvent.setup()
    setup()
    const input = await screen.findByLabelText('How many children?')
    await user.type(input, '20')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByText('Enter 1 to 15.')).toBeInTheDocument()
    expect(describedText(input)).toContain('Enter 1 to 15.')

    await user.click(screen.getByRole('button', { name: 'Apply server errors' }))
    expect(await screen.findByText('Rejected by the server.')).toBeInTheDocument()
    await user.clear(input)
    await user.type(input, '3')
    expect(screen.queryByText('Rejected by the server.')).not.toBeInTheDocument()
  })
})
