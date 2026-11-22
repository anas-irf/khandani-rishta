import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ChangeEvent } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { Alert, AlertDescription, AlertTitle } from '~/components/ui/alert'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '~/components/ui/alert-dialog'
import { Button } from '~/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '~/components/ui/dialog'
import { NativeSelect, NativeSelectOption } from '~/components/ui/native-select'
import { Progress } from '~/components/ui/progress'
import { Skeleton } from '~/components/ui/skeleton'
import { ToggleGroup, ToggleGroupItem } from '~/components/ui/toggle-group'
import { Tooltip, TooltipContent, TooltipTrigger } from '~/components/ui/tooltip'

describe('Button', () => {
  it('defaults to type button and is at least 48px tall', () => {
    render(<Button>Save</Button>)
    const button = screen.getByRole('button', { name: 'Save' })
    expect(button).toHaveAttribute('type', 'button')
    expect(button).toHaveClass('min-h-touch')
  })

  it('makes a main action 56px tall on phones, and only a main action', () => {
    render(
      <>
        <Button>Accept</Button>
        <Button variant="inverse">View</Button>
        <Button size="icon" aria-label="Send" />
        <Button variant="secondary">Decline</Button>
      </>,
    )
    for (const name of ['Accept', 'View']) {
      expect(screen.getByRole('button', { name })).toHaveClass('max-wide:min-h-touch-lg')
    }
    expect(screen.getByRole('button', { name: 'Send' })).toHaveClass('max-wide:size-touch-lg')
    expect(screen.getByRole('button', { name: 'Decline' })).not.toHaveClass(
      'max-wide:min-h-touch-lg',
    )
  })

  it('shows a spinner and is disabled and busy while loading', () => {
    render(<Button loading>Save</Button>)
    const button = screen.getByRole('button', { name: 'Save' })
    expect(button).toBeDisabled()
    expect(button).toHaveAttribute('aria-busy', 'true')
    expect(button.querySelector('svg.animate-spin')).toBeInTheDocument()
  })

  it('does not call onClick while loading', async () => {
    const onClick = vi.fn()
    render(
      <Button loading onClick={onClick}>
        Save
      </Button>,
    )
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(onClick).not.toHaveBeenCalled()
  })

  it('renders the child element with asChild', () => {
    render(
      <Button asChild>
        <a href="/home">Go home</a>
      </Button>,
    )
    const link = screen.getByRole('link', { name: 'Go home' })
    expect(link).toHaveAttribute('href', '/home')
    expect(link).toHaveClass('bg-primary')
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('marks an asChild link as aria-disabled and keeps the spinner while loading', () => {
    render(
      <Button asChild loading>
        <a href="/home">Go home</a>
      </Button>,
    )
    const link = screen.getByRole('link', { name: 'Go home' })
    expect(link).toHaveAttribute('aria-disabled', 'true')
    expect(link).toHaveAttribute('aria-busy', 'true')
    expect(link.querySelector('svg.animate-spin')).toBeInTheDocument()
  })
})

function DialogExample() {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button>Edit profile</Button>
      </DialogTrigger>
      <DialogContent closeLabel="Close dialog">
        <DialogHeader>
          <DialogTitle>Edit your profile</DialogTitle>
          <DialogDescription>Change what other members see.</DialogDescription>
        </DialogHeader>
      </DialogContent>
    </Dialog>
  )
}

describe('Dialog', () => {
  it('opens on trigger click with an accessible name, and closes on Escape', async () => {
    const user = userEvent.setup()
    render(<DialogExample />)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Edit profile' }))
    const dialog = await screen.findByRole('dialog', { name: 'Edit your profile' })
    expect(dialog).toHaveAccessibleDescription('Change what other members see.')
    expect(screen.getByRole('button', { name: 'Close dialog' })).toBeInTheDocument()

    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('closes with the X button', async () => {
    const user = userEvent.setup()
    render(<DialogExample />)
    await user.click(screen.getByRole('button', { name: 'Edit profile' }))
    await user.click(await screen.findByRole('button', { name: 'Close dialog' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})

describe('AlertDialog', () => {
  it('closes when Cancel is pressed and does not run the action', async () => {
    const user = userEvent.setup()
    const onConfirm = vi.fn()
    render(
      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button variant="destructive">Delete account</Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete your account?</AlertDialogTitle>
            <AlertDialogDescription>This cannot be undone.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep account</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={onConfirm}>
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>,
    )

    await user.click(screen.getByRole('button', { name: 'Delete account' }))
    expect(await screen.findByRole('alertdialog', { name: 'Delete your account?' })).toBeVisible()
    expect(screen.getByRole('button', { name: 'Delete' })).toHaveClass('bg-danger')

    await user.click(screen.getByRole('button', { name: 'Keep account' }))
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('runs the action and closes when the action is pressed', async () => {
    const user = userEvent.setup()
    const onConfirm = vi.fn()
    render(
      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button>Open</Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogTitle>Sure?</AlertDialogTitle>
          <AlertDialogDescription>Please confirm.</AlertDialogDescription>
          <AlertDialogCancel>No</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm}>Yes</AlertDialogAction>
        </AlertDialogContent>
      </AlertDialog>,
    )
    await user.click(screen.getByRole('button', { name: 'Open' }))
    await user.click(await screen.findByRole('button', { name: 'Yes' }))
    expect(onConfirm).toHaveBeenCalledOnce()
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  })
})

describe('ToggleGroup', () => {
  it('changes the single selected value', async () => {
    const user = userEvent.setup()
    const onValueChange = vi.fn()
    render(
      <ToggleGroup
        type="single"
        defaultValue="essential"
        onValueChange={onValueChange}
        aria-label="Importance"
      >
        <ToggleGroupItem value="essential">Essential</ToggleGroupItem>
        <ToggleGroupItem value="important">Important</ToggleGroupItem>
        <ToggleGroupItem value="nice">Nice to have</ToggleGroupItem>
      </ToggleGroup>,
    )

    const essential = screen.getByRole('radio', { name: 'Essential' })
    const important = screen.getByRole('radio', { name: 'Important' })
    expect(essential).toBeChecked()
    expect(important).not.toBeChecked()

    await user.click(important)
    expect(onValueChange).toHaveBeenCalledWith('important')
    expect(important).toBeChecked()
    expect(essential).not.toBeChecked()
    expect(important).toHaveClass('min-h-touch')
  })
})

describe('NativeSelect', () => {
  it('fires onChange with the chosen value', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn((event: ChangeEvent<HTMLSelectElement>) => event.target.value)
    render(
      <>
        <label htmlFor="country">Country</label>
        <NativeSelect id="country" defaultValue="" onChange={onChange}>
          <NativeSelectOption value="">Choose</NativeSelectOption>
          <NativeSelectOption value="pk">Pakistan</NativeSelectOption>
          <NativeSelectOption value="gb">United Kingdom</NativeSelectOption>
        </NativeSelect>
      </>,
    )

    const select = screen.getByRole('combobox', { name: 'Country' })
    expect(select).toHaveClass('min-h-touch')
    await user.selectOptions(select, 'gb')
    expect(onChange).toHaveBeenCalledOnce()
    expect(onChange).toHaveReturnedWith('gb')
    expect(select).toHaveValue('gb')
  })
})

describe('Alert', () => {
  it('uses role alert only for the danger variant', () => {
    render(
      <>
        <Alert variant="danger">
          <AlertTitle>Failed</AlertTitle>
          <AlertDescription>Something went wrong.</AlertDescription>
        </Alert>
        <Alert variant="info">
          <AlertTitle>Heads up</AlertTitle>
        </Alert>
      </>,
    )
    expect(screen.getByRole('alert')).toHaveTextContent('Failed')
    expect(screen.getByRole('status')).toHaveTextContent('Heads up')
  })
})

describe('Skeleton and Progress', () => {
  it('hides the skeleton from assistive technology', () => {
    const { container } = render(<Skeleton className="h-4 w-20" />)
    expect(container.firstChild).toHaveAttribute('aria-hidden', 'true')
  })

  it('exposes progress as a progressbar with a value', () => {
    render(<Progress value={40} aria-label="Profile completeness" />)
    const bar = screen.getByRole('progressbar', { name: 'Profile completeness' })
    expect(bar).toHaveAttribute('aria-valuenow', '40')
  })
})

describe('Tooltip', () => {
  it('works without an explicit provider', () => {
    render(
      <Tooltip open>
        <TooltipTrigger asChild>
          <Button size="icon" aria-label="Help">
            ?
          </Button>
        </TooltipTrigger>
        <TooltipContent>Explains the field</TooltipContent>
      </Tooltip>,
    )
    expect(screen.getByRole('tooltip')).toHaveTextContent('Explains the field')
  })
})
