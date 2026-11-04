import { Link } from 'react-router-dom';
import { AlertTriangle, CheckCircle2, Info } from 'lucide-react';
import type { AlertItem } from '@shared/types';

const ICONS = {
  info: <Info className="h-4 w-4 text-brand-600" aria-hidden="true" />,
  warning: <AlertTriangle className="h-4 w-4 text-amber-600" aria-hidden="true" />,
  danger: <AlertTriangle className="h-4 w-4 text-red-600" aria-hidden="true" />,
};

export function AlertsPanel({
  alerts,
  onClose,
}: {
  alerts: AlertItem[];
  onClose: () => void;
}) {
  return (
    <div
      className="absolute right-0 top-full z-40 mt-1.5 w-80 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-pop"
      role="region"
      aria-label="Alerts"
    >
      <div className="border-b border-slate-100 px-4 py-2.5">
        <p className="text-sm font-semibold text-navy-900">Alerts</p>
      </div>

      {alerts.length === 0 ? (
        <div className="flex flex-col items-center gap-2 px-4 py-8 text-center">
          <CheckCircle2 className="h-6 w-6 text-emerald-500" aria-hidden="true" />
          <p className="text-sm text-slate-600">Everything is up to date.</p>
        </div>
      ) : (
        <ul className="max-h-80 divide-y divide-slate-100 overflow-y-auto">
          {alerts.map((alert) => (
            <li key={alert.id}>
              <Link
                to={alert.href ?? '/dashboard'}
                onClick={onClose}
                className="flex items-start gap-2.5 px-4 py-3 hover:bg-slate-50"
              >
                <span className="mt-0.5 shrink-0">{ICONS[alert.severity]}</span>
                <span className="min-w-0">
                  <span className="block text-sm font-medium text-navy-900">{alert.title}</span>
                  <span className="mt-0.5 block text-xs text-slate-500">{alert.detail}</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
