// @rjsf/core v6 Form is a class component whose type doesn't satisfy
// @types/react 18's JSX.ElementClass constraint (missing `props` property).
// This wrapper casts through unknown to a plain function signature so TypeScript
// accepts it in JSX without `as any` at every call site.
import _Form, { type FormProps } from '@rjsf/core';
import type React from 'react';

export const RjsfForm = _Form as unknown as (props: FormProps<unknown>) => React.ReactElement;
