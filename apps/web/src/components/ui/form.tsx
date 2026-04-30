// =============================================================
// Form — react-hook-form + Zod adapter.
//
// Centralises the form lifecycle so screens stop re-implementing
// useState/onChange/onSubmit + per-field validation. Consumers
// pass a Zod schema and a submit handler; useFormContext() inside
// children gives them register/setValue/etc.
//
// Usage:
//   const schema = z.object({ legalName: z.string().min(2) });
//   <Form schema={schema} onSubmit={handle}>
//     <Field label="Legal name">
//       <input className="input" {...register('legalName')} />
//     </Field>
//     <button type="submit">Save</button>
//   </Form>
//
// First migration target: client-form.tsx (validates the
// abstraction before rolling out to the other 6 hand-rolled
// forms in Sprint D).
// =============================================================

'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import type { ReactNode } from 'react';
import {
  FormProvider,
  useForm,
  type DefaultValues,
  type FieldValues,
  type Resolver,
  type SubmitHandler,
  type UseFormProps,
} from 'react-hook-form';
import type { ZodType } from 'zod';

interface FormProps<TValues extends FieldValues> {
  schema: ZodType<TValues>;
  defaultValues?: DefaultValues<TValues>;
  onSubmit: SubmitHandler<TValues>;
  children: ReactNode;
  className?: string;
  // Forwarded through to RHF for advanced use (mode: 'onBlur', etc.)
  options?: Omit<UseFormProps<TValues>, 'resolver' | 'defaultValues'>;
}

export function Form<TValues extends FieldValues>({
  schema,
  defaultValues,
  onSubmit,
  children,
  className,
  options,
}: FormProps<TValues>) {
  // biome-ignore lint/suspicious/noExplicitAny: zodResolver generics don't compose with exactOptionalPropertyTypes
  const resolver = zodResolver(schema as any) as Resolver<TValues>;
  const baseOptions: UseFormProps<TValues> = { ...options, resolver };
  if (defaultValues !== undefined) {
    baseOptions.defaultValues = defaultValues;
  }
  const methods = useForm<TValues>(baseOptions);
  // Cast handleSubmit to bridge RHF's TFieldValues constraint vs our concrete TValues.
  const submit = methods.handleSubmit as unknown as (
    handler: SubmitHandler<TValues>,
  ) => (e?: React.BaseSyntheticEvent) => Promise<void>;
  return (
    <FormProvider {...methods}>
      <form onSubmit={submit(onSubmit)} className={className ?? 'form-grid'} noValidate>
        {children}
      </form>
    </FormProvider>
  );
}

// Re-export for ergonomic imports in form consumers.
export { useFormContext, useWatch, Controller } from 'react-hook-form';
