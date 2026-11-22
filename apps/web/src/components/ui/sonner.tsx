import { Toaster as Sonner, type ToasterProps } from 'sonner'

// Every toast is the inverse surface and its type is told by its icon and words (DESIGN.md 6.20).
// `src/styles/app.css` points Sonner's colour, radius and type variables at the design tokens.

/**
 * Mount once at the app root, then call `toast(...)` from 'sonner'. Sonner announces toasts
 * through a polite live region. Do not put the only copy of important information in a toast.
 * A toast that carries an Undo passes `duration: 5000`.
 */
function Toaster({ toastOptions, ...props }: ToasterProps) {
  return (
    <Sonner
      theme="light"
      position="top-center"
      duration={4000}
      closeButton
      toastOptions={{
        ...toastOptions,
        classNames: {
          // Sonner's close button is 20px: the pseudo-element grows the tap area to 48px.
          closeButton: "after:absolute after:-inset-[14px] after:content-['']",
          ...toastOptions?.classNames,
        },
      }}
      {...props}
    />
  )
}

export { Toaster }
