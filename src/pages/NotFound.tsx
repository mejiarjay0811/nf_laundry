import { Link } from 'react-router-dom';
import { Home, SearchX } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';

export default function NotFound() {
  useDocumentTitle('Page not found');

  return (
    <div className="card flex flex-col items-center justify-center px-6 py-20 text-center">
      <div className="mb-4 rounded-full bg-slate-100 p-4 text-slate-400">
        <SearchX className="h-7 w-7" aria-hidden="true" />
      </div>
      <h1 className="text-lg font-semibold text-navy-900">This page does not exist.</h1>
      <p className="mt-1 max-w-sm text-sm text-slate-600">
        The link may be out of date, or the record may have been renamed.
      </p>
      <Button
        className="mt-5"
        onClick={() => {
          window.location.href = '/dashboard';
        }}
        icon={<Home className="h-4 w-4" aria-hidden="true" />}
      >
        Back to dashboard
      </Button>
      <Link to="/transactions" className="mt-3 text-sm text-brand-700 hover:underline">
        Or browse transactions
      </Link>
    </div>
  );
}
