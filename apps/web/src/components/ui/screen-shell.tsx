// =============================================================
// ScreenShell — standard page-header layout for every admin
// screen.
//
// Replaces ad-hoc per-screen markup: the existing pattern of
//   <p className="eyebrow">…</p>
//   <h1>Title</h1>
//   <p>description</p>
//   ...content
// is now centralised here. Action buttons dock right; an optional
// `description` slot stays under the title.
//
// Use:
//   <ScreenShell eyebrow="Catalogue" title="Insurers"
//                description="Insurers your tenant works with"
//                actions={<button>Add insurer</button>}>
//     ...children...
//   </ScreenShell>
// =============================================================

import type { ReactNode } from 'react';

interface ScreenShellProps {
  title: string;
  eyebrow?: string;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
}

export function ScreenShell({ title, eyebrow, description, actions, children }: ScreenShellProps) {
  return (
    <>
      <header className="screen-shell-head">
        <div className="screen-shell-head__title">
          {eyebrow ? <p className="eyebrow mb-2">{eyebrow}</p> : null}
          <h1>{title}</h1>
          {description ? <p>{description}</p> : null}
        </div>
        {actions ? <div className="screen-shell-head__actions">{actions}</div> : null}
      </header>
      {children}
    </>
  );
}
