import type * as React from 'react'
import { Toaster as Sonner, type ToasterProps } from 'sonner'

// Sonner reads these CSS variables for its colours. They point at the design tokens, so toasts
// follow any token change. `richColors` makes success, error, warning and info toasts use the
// `--success-*`, `--error-*`, `--warning-*` and `--info-*` sets.
const toastStyle = {
  '--normal-bg': 'var(--color-surface)',
  '--normal-text': 'var(--color-foreground)',
  '--normal-border': 'var(--color-border)',
  '--success-bg': 'var(--color-success-soft)',
  '--success-text': 'var(--color-foreground)',
  '--success-border': 'var(--color-success)',
  '--error-bg': 'var(--color-danger-soft)',
  '--error-text': 'var(--color-foreground)',
  '--error-border': 'var(--color-danger)',
  '--warning-bg': 'var(--color-warning-soft)',
  '--warning-text': 'var(--color-foreground)',
  '--warning-border': 'var(--color-warning)',
  '--info-bg': 'var(--color-primary-soft)',
  '--info-text': 'var(--color-foreground)',
  '--info-border': 'var(--color-primary)',
  '--border-radius': 'var(--radius-card)',
} as React.CSSProperties

/**
 * Mount once at the app root, then call `toast(...)` from 'sonner'. Sonner announces toasts
 * through a polite live region. Do not put the only copy of important information in a toast.
 */
function Toaster({ toastOptions, ...props }: ToasterProps) {
  return (
    <Sonner
      theme="light"
      position="top-center"
      duration={4000}
      richColors
      closeButton
      style={toastStyle}
      toastOptions={{
        ...toastOptions,
        classNames: {
          // Sonner's close button is 20px: the pseudo-element grows the tap area to 44px.
          closeButton: "after:absolute after:-inset-3 after:content-['']",
          title: 'text-base font-medium',
          description: 'text-sm',
          ...toastOptions?.classNames,
        },
      }}
      {...props}
    />
  )
}

export { Toaster }
