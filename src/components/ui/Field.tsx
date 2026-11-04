import { forwardRef, useId, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { cn } from '@/lib/cn';

const CONTROL =
  'w-full rounded-lg border bg-white px-3 text-navy-900 placeholder:text-slate-400 ' +
  'text-base sm:text-sm ' +
  'transition-colors disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-500';

const CONTROL_OK = 'border-slate-300 hover:border-slate-400 focus:border-brand-500';
const CONTROL_ERROR = 'border-red-400 focus:border-red-500';

interface FieldShellProps {
  label?: string;
  hint?: string;
  error?: string;
  required?: boolean;
  htmlFor: string;
  children: ReactNode;
  className?: string;
}

function FieldShell({ label, hint, error, required, htmlFor, children, className }: FieldShellProps) {
  return (
    <div className={cn('w-full', className)}>
      {label ? (
        <label htmlFor={htmlFor} className="label">
          {label}
          {required ? <span className="ml-0.5 text-red-500" aria-hidden="true">*</span> : null}
        </label>
      ) : null}
      {children}
      {error ? (
        <p className="mt-1 text-xs font-medium text-red-600" role="alert">
          {error}
        </p>
      ) : hint ? (
        <p className="hint">{hint}</p>
      ) : null}
    </div>
  );
}

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  hint?: string;
  error?: string;
  leading?: ReactNode;
  trailing?: ReactNode;
  containerClassName?: string;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { label, hint, error, leading, trailing, className, containerClassName, id, required, ...props },
  ref,
) {
  const generated = useId();
  const inputId = id ?? generated;

  return (
    <FieldShell
      label={label}
      hint={hint}
      error={error}
      required={required}
      htmlFor={inputId}
      className={containerClassName}
    >
      <div className="relative">
        {leading ? (
          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-500">
            {leading}
          </span>
        ) : null}
        <input
          ref={ref}
          id={inputId}
          required={required}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? inputId + '-error' : undefined}
          className={cn(
            CONTROL,
            error ? CONTROL_ERROR : CONTROL_OK,
            'h-12 sm:h-11',
            leading && 'pl-9',
            trailing && 'pr-10',
            className,
          )}
          {...props}
        />
        {trailing ? (
          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500">{trailing}</span>
        ) : null}
      </div>
    </FieldShell>
  );
});

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  hint?: string;
  error?: string;
  containerClassName?: string;
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { label, hint, error, className, containerClassName, id, required, children, ...props },
  ref,
) {
  const generated = useId();
  const selectId = id ?? generated;
  return (
    <FieldShell
      label={label}
      hint={hint}
      error={error}
      required={required}
      htmlFor={selectId}
      className={containerClassName}
    >
      <select
        ref={ref}
        id={selectId}
        required={required}
        aria-invalid={error ? true : undefined}
        className={cn(CONTROL, error ? CONTROL_ERROR : CONTROL_OK, 'h-12 pr-8 sm:h-11', className)}
        {...props}
      >
        {children}
      </select>
    </FieldShell>
  );
});

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
  hint?: string;
  error?: string;
  containerClassName?: string;
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { label, hint, error, className, containerClassName, id, required, ...props },
  ref,
) {
  const generated = useId();
  const areaId = id ?? generated;
  return (
    <FieldShell
      label={label}
      hint={hint}
      error={error}
      required={required}
      htmlFor={areaId}
      className={containerClassName}
    >
      <textarea
        ref={ref}
        id={areaId}
        required={required}
        aria-invalid={error ? true : undefined}
        className={cn(CONTROL, error ? CONTROL_ERROR : CONTROL_OK, 'py-2.5', className)}
        {...props}
      />
    </FieldShell>
  );
});
