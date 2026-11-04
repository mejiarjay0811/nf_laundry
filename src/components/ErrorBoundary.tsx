import { Component, type ErrorInfo, type ReactNode } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/Button';

interface Props {
  children: ReactNode;
  /** Shown in the message so the cashier knows what failed. */
  area?: string;
}

interface State {
  error: Error | null;
}

/**
 * Stops one broken screen from taking down the whole till.
 *
 * Without this, any render error unmounts the entire React tree and the app
 * goes blank — which looks exactly like "the system is down" to whoever is
 * standing at the counter. Here the rest of the app keeps working and the
 * failure is contained to the panel that caused it.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // eslint-disable-next-line no-console
    console.error('Screen failed to render', error, info.componentStack);
  }

  private reset = (): void => {
    this.setState({ error: null });
  };

  render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div
        role="alert"
        className="card flex flex-col items-center justify-center px-6 py-14 text-center"
      >
        <div className="mb-3 rounded-full bg-red-50 p-3 text-red-500">
          <AlertTriangle className="h-6 w-6" aria-hidden="true" />
        </div>
        <p className="text-sm font-semibold text-navy-900">
          {this.props.area ? 'The ' + this.props.area + ' screen ran into a problem.' : 'This screen ran into a problem.'}
        </p>
        <p className="mt-1 max-w-md text-sm text-slate-600">
          Nothing was lost — your saved transactions are safe. Try again, or move to another
          screen and come back.
        </p>
        <div className="mt-5 flex flex-wrap justify-center gap-2">
          <Button
            variant="outline"
            onClick={this.reset}
            icon={<RefreshCw className="h-4 w-4" aria-hidden="true" />}
          >
            Try again
          </Button>
          <Button onClick={() => window.location.reload()}>Reload the app</Button>
        </div>
        {import.meta.env.DEV ? (
          <pre className="mt-5 max-w-full overflow-x-auto rounded-lg bg-slate-900 p-3 text-left text-[11px] text-slate-200">
            {error.message}
          </pre>
        ) : null}
      </div>
    );
  }
}
