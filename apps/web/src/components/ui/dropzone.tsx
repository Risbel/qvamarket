"use client"

import * as React from "react"
import { cn } from "cn"

/**
 * Does the file match an `accept` list ("image/png", "image/*" or ".png")? An empty list
 * accepts everything. Only a first filter: the server must still check the real file type.
 */
function matchesAccept(file: File, accept: readonly string[]) {
  if (accept.length === 0) return true
  const name = file.name.toLowerCase()
  const type = file.type.toLowerCase()
  return accept.some((rule) => {
    const value = rule.trim().toLowerCase()
    if (value.startsWith(".")) return name.endsWith(value)
    if (value.endsWith("/*")) return type.startsWith(value.slice(0, -1))
    return type === value
  })
}

type DropzoneProps = Omit<React.ComponentProps<"label">, "onDrop" | "onChange"> & {
  /** MIME types or extensions, as in the input's `accept` attribute */
  accept?: readonly string[]
  multiple?: boolean
  disabled?: boolean
  /** Files picked or dropped that match `accept` (only the first one without `multiple`) */
  onFiles: (files: File[]) => void
  /** Dropped files that do not match `accept` */
  onReject?: (files: File[]) => void
  /** Props for the hidden file input (`aria-label`, `id`, `name`...) */
  inputProps?: Omit<React.ComponentProps<"input">, "type" | "accept" | "multiple" | "disabled" | "onChange">
}

/**
 * A file drop area: drag files onto it, or click / press Enter to open the file picker. It is a
 * `<label>` around a visually hidden `<input type="file">`, so it works with the keyboard and
 * screen readers like a normal file input. Content goes in `children` (see DropzoneIcon,
 * DropzoneTitle, DropzoneDescription); `data-dragging` is set while files are over it.
 */
function Dropzone({
  accept = [],
  multiple = false,
  disabled = false,
  onFiles,
  onReject,
  inputProps,
  className,
  children,
  ...props
}: DropzoneProps) {
  const [dragging, setDragging] = React.useState(false)

  function handle(files: File[]) {
    const accepted = files.filter((file) => matchesAccept(file, accept))
    const rejected = files.filter((file) => !matchesAccept(file, accept))
    if (rejected.length > 0) onReject?.(rejected)
    if (accepted.length > 0) onFiles(multiple ? accepted : accepted.slice(0, 1))
  }

  return (
    <label
      data-slot="dropzone"
      data-dragging={dragging || undefined}
      data-disabled={disabled || undefined}
      className={cn(
        "flex w-full cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-input p-6 text-center text-balance transition-colors outline-none hover:bg-muted/50 has-[input:focus-visible]:border-ring has-[input:focus-visible]:ring-3 has-[input:focus-visible]:ring-ring/50 aria-invalid:border-destructive data-dragging:border-primary data-dragging:bg-primary/5 data-disabled:pointer-events-none data-disabled:cursor-not-allowed data-disabled:opacity-50 dark:bg-input/10",
        className
      )}
      onDragEnter={(event) => {
        event.preventDefault()
        if (!disabled) setDragging(true)
      }}
      onDragOver={(event) => {
        // Needed so the browser allows the drop (and does not open the file instead)
        event.preventDefault()
        event.dataTransfer.dropEffect = disabled ? "none" : "copy"
      }}
      onDragLeave={(event) => {
        // Moving over a child fires dragleave on the parent: only reset when leaving the area
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false)
      }}
      onDrop={(event) => {
        event.preventDefault()
        setDragging(false)
        if (!disabled) handle(Array.from(event.dataTransfer.files))
      }}
      {...props}
    >
      <input
        {...inputProps}
        type="file"
        accept={accept.join(",")}
        multiple={multiple}
        disabled={disabled}
        className={cn("sr-only", inputProps?.className)}
        onChange={(event) => {
          const files = Array.from(event.target.files ?? [])
          // Reset, so picking the same file again fires change again
          event.target.value = ""
          handle(files)
        }}
      />
      {children}
    </label>
  )
}

function DropzoneIcon({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="dropzone-icon"
      className={cn(
        "flex size-10 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-5",
        className
      )}
      {...props}
    />
  )
}

function DropzoneTitle({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="dropzone-title"
      className={cn("text-sm font-medium", className)}
      {...props}
    />
  )
}

function DropzoneDescription({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="dropzone-description"
      className={cn("text-xs text-muted-foreground", className)}
      {...props}
    />
  )
}

export { Dropzone, DropzoneIcon, DropzoneTitle, DropzoneDescription }
