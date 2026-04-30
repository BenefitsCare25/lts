import type { ReactNode } from 'react';

interface ScreenShellProps {
  title: ReactNode;
  context?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
}

export function ScreenShell({ title, context, actions, children }: ScreenShellProps) {
  return (
    <>
      <header className="screen-shell-head">
        <div className="screen-shell-head__title">
          <h1>{title}</h1>
          {context ? <p>{context}</p> : null}
        </div>
        {actions ? <div className="screen-shell-head__actions">{actions}</div> : null}
      </header>
      {children}
    </>
  );
}
