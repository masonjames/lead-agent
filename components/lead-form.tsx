'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { Controller, useForm } from 'react-hook-form';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet
} from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { formSchema } from '@/lib/types';
import { toast } from 'sonner';

export function LeadForm() {
  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      email: '',
      name: '',
      phone: '',
      company: '',
      address: '',
      recipientEmail: '',
      message: ''
    }
  });

  async function onSubmit(data: z.infer<typeof formSchema>) {
    const response = await fetch('/api/submit', {
      method: 'POST',
      body: JSON.stringify(data)
    });

    if (response.ok) {
      toast.success('Form submitted successfully');
      form.reset();
    } else {
      toast.error('Form submission failed');
    }
  }

  return (
    <div className="mx-auto max-w-xl p-6">
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
        <FieldSet>
          <FieldLegend>Contact Information</FieldLegend>
          <FieldDescription>
            Please provide your contact details so we can reach you.
          </FieldDescription>
          <FieldGroup>
            <Controller
              name="email"
              control={form.control}
              render={({ field, fieldState }) => (
                <Field data-invalid={fieldState.invalid}>
                  <FieldLabel htmlFor="email">
                    Business Email <span className="text-destructive">*</span>
                  </FieldLabel>
                  <Input
                    {...field}
                    id="email"
                    type="email"
                    aria-invalid={fieldState.invalid}
                    placeholder="john@company.com"
                    autoComplete="email"
                  />
                  <FieldDescription>
                    Please use your work email address.
                  </FieldDescription>
                  {fieldState.invalid && (
                    <FieldError errors={[fieldState.error]} />
                  )}
                </Field>
              )}
            />

            <div className="grid grid-cols-2 gap-4">
              <Controller
                name="name"
                control={form.control}
                render={({ field, fieldState }) => (
                  <Field data-invalid={fieldState.invalid}>
                    <FieldLabel htmlFor="name">
                      Name <span className="text-destructive">*</span>
                    </FieldLabel>
                    <Input
                      {...field}
                      id="name"
                      aria-invalid={fieldState.invalid}
                      placeholder="John Doe"
                      autoComplete="name"
                    />
                    {fieldState.invalid && (
                      <FieldError errors={[fieldState.error]} />
                    )}
                  </Field>
                )}
              />

              <Controller
                name="phone"
                control={form.control}
                render={({ field, fieldState }) => (
                  <Field data-invalid={fieldState.invalid}>
                    <FieldLabel htmlFor="phone">Phone</FieldLabel>
                    <Input
                      {...field}
                      id="phone"
                      type="tel"
                      aria-invalid={fieldState.invalid}
                      placeholder="(555) 123-4567"
                      autoComplete="tel"
                    />
                    {fieldState.invalid && (
                      <FieldError errors={[fieldState.error]} />
                    )}
                  </Field>
                )}
              />
            </div>

            <Controller
              name="company"
              control={form.control}
              render={({ field, fieldState }) => (
                <Field data-invalid={fieldState.invalid}>
                  <FieldLabel htmlFor="company">Company</FieldLabel>
                  <Input
                    {...field}
                    id="company"
                    aria-invalid={fieldState.invalid}
                    placeholder="Acme Inc."
                    autoComplete="organization"
                  />
                  <FieldDescription>
                    Optional: Tell us where you work.
                  </FieldDescription>
                  {fieldState.invalid && (
                    <FieldError errors={[fieldState.error]} />
                  )}
                </Field>
              )}
            />

            <Controller
              name="address"
              control={form.control}
              render={({ field, fieldState }) => (
                <Field data-invalid={fieldState.invalid}>
                  <FieldLabel htmlFor="address">Property Address</FieldLabel>
                  <Input
                    {...field}
                    id="address"
                    aria-invalid={fieldState.invalid}
                    placeholder="123 Main St, Bradenton, FL 34205"
                    autoComplete="street-address"
                  />
                  <FieldDescription>
                    Primary address for property research (Manatee & Sarasota County, FL).
                  </FieldDescription>
                  {fieldState.invalid && (
                    <FieldError errors={[fieldState.error]} />
                  )}
                </Field>
              )}
            />

            <Controller
              name="recipientEmail"
              control={form.control}
              render={({ field, fieldState }) => (
                <Field data-invalid={fieldState.invalid}>
                  <FieldLabel htmlFor="recipientEmail">Send me the results</FieldLabel>
                  <Input
                    {...field}
                    id="recipientEmail"
                    type="email"
                    aria-invalid={fieldState.invalid}
                    placeholder="your@email.com"
                    autoComplete="email"
                  />
                  <FieldDescription>
                    Optional: Enter your email to receive a copy of the property report.
                  </FieldDescription>
                  {fieldState.invalid && (
                    <FieldError errors={[fieldState.error]} />
                  )}
                </Field>
              )}
            />
          </FieldGroup>
        </FieldSet>

        <div className="flex justify-end">
          <Button type="submit" disabled={form.formState.isSubmitting}>
            {form.formState.isSubmitting ? 'Submitting...' : 'Submit'}
          </Button>
        </div>
      </form>
    </div>
  );
}
