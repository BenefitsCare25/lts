// =============================================================
// Card — single source of truth for card shapes.
//
// Wraps the existing `.card` / `.card-padded` CSS classes so
// screens stop choosing between `<div className="card">` and
// `<div className="card card-padded">`. Variant prop forces the
// decision; default ("default") matches the smaller padding.
//
// New screens should always reach for <Card> instead of div.
// =============================================================

import type { HTMLAttributes, ReactNode } from 'react';

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  variant?: 'default' | 'padded' | 'compact';
  children: ReactNode;
}

export function Card({ variant = 'default', className, children, ...rest }: CardProps) {
  const classes = ['card'];
  if (variant === 'padded') classes.push('card-padded');
  if (variant === 'compact') classes.push('p-3');
  if (className) classes.push(className);
  return (
    <div className={classes.join(' ')} {...rest}>
      {children}
    </div>
  );
}
