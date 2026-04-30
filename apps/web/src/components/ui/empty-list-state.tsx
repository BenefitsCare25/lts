import Link from 'next/link';

interface EmptyListStateProps {
  message: string;
  actionHref: string;
  actionLabel: string;
}

export function EmptyListState({ message, actionHref, actionLabel }: EmptyListStateProps) {
  return (
    <div className="card card-padded text-center">
      <p className="mb-2">{message}</p>
      <Link href={actionHref} className="btn btn-primary">
        {actionLabel}
      </Link>
    </div>
  );
}
