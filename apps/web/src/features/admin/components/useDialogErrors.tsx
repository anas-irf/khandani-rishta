import { TriangleAlert } from 'lucide-react'
import { useState } from 'react'
import { Alert, AlertDescription } from '~/components/ui/alert'
import { type FieldMessages, serverFieldErrors } from '../forms'

/**
 * Field errors of a dialog form: local validation messages and the `validation_failed` fields
 * of a failed request (`rest` holds the ones that match no input, for a summary box).
 */
export function useDialogErrors(fields: readonly string[], aliases: Record<string, string> = {}) {
  const [errors, setErrors] = useState<FieldMessages>({})
  const [rest, setRest] = useState<string[]>([])

  return {
    errors,
    rest,
    /** Shows local validation messages. */
    setErrors: (next: FieldMessages) => {
      setErrors(next)
      setRest([])
    },
    clear: () => {
      setErrors({})
      setRest([])
    },
    /** Shows the field errors of a failed request. Other errors are toasted globally. */
    fail: (error: unknown) => {
      const mapped = serverFieldErrors(error, fields, aliases)
      setErrors(mapped.fields)
      setRest(mapped.rest)
    },
  }
}

/** The server errors that match no input of the form. */
export function ErrorSummary({ messages }: { messages: string[] }) {
  if (messages.length === 0) return null
  return (
    <Alert variant="danger">
      <TriangleAlert aria-hidden="true" />
      <AlertDescription>
        <ul className="list-disc ps-4">
          {messages.map((message) => (
            <li key={message}>{message}</li>
          ))}
        </ul>
      </AlertDescription>
    </Alert>
  )
}
