// The app's control kit: react-bootstrap under the hood, instrument-panel
// defaults baked in. Components render the same native elements as before
// (button/select/input/textarea), so selectors and tests keep working —
// migrate a surface by swapping tags, not rewriting it.

import { forwardRef } from 'react';
import BsButton from 'react-bootstrap/Button';
import Form from 'react-bootstrap/Form';
import type { ButtonProps } from 'react-bootstrap/Button';
import type { FormControlProps } from 'react-bootstrap/FormControl';
import type { FormSelectProps } from 'react-bootstrap/FormSelect';

/** Solid button — the default action style. */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(props, ref) {
  return <BsButton ref={ref} size="sm" variant="primary" {...props} />;
});

/** Ghost button — secondary/toolbar actions (transparent until hover). */
export const Ghost = forwardRef<HTMLButtonElement, ButtonProps>(function Ghost({ className, ...rest }, ref) {
  return <BsButton ref={ref} size="sm" variant="outline-secondary" className={`ghost ${className ?? ''}`} {...rest} />;
});

export const Input = forwardRef<HTMLInputElement, FormControlProps & { placeholder?: string }>(function Input(props, ref) {
  return <Form.Control ref={ref} size="sm" {...props} />;
});

export const TextArea = forwardRef<HTMLTextAreaElement, FormControlProps & { rows?: number; spellCheck?: boolean }>(
  function TextArea(props, ref) {
    return <Form.Control ref={ref} as="textarea" size="sm" {...props} />;
  }
);

export const Select = forwardRef<HTMLSelectElement, FormSelectProps>(function Select(props, ref) {
  return <Form.Select ref={ref} size="sm" {...props} />;
});
