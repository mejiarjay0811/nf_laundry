import type { ReactNode } from 'react';
import {
  AlertCircle,
  Ban,
  CheckCircle2,
  Clock,
  PackageCheck,
  RotateCcw,
  Shirt,
} from 'lucide-react';
import type { OrderStatus, PaymentStatus, PickupStatus } from '@shared/constants';
import { cn } from '@/lib/cn';

type Tone = 'green' | 'yellow' | 'red' | 'blue' | 'slate' | 'purple' | 'cyan';

const TONES: Record<Tone, string> = {
  green: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20',
  yellow: 'bg-amber-50 text-amber-800 ring-amber-600/20',
  red: 'bg-red-50 text-red-700 ring-red-600/20',
  blue: 'bg-blue-50 text-blue-700 ring-blue-600/20',
  cyan: 'bg-cyan-50 text-cyan-800 ring-cyan-600/20',
  purple: 'bg-violet-50 text-violet-700 ring-violet-600/20',
  slate: 'bg-slate-100 text-slate-700 ring-slate-500/20',
};

export function Badge({
  tone = 'slate',
  icon,
  children,
  className,
}: {
  tone?: Tone;
  icon?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5',
        'text-xs font-medium ring-1 ring-inset',
        TONES[tone],
        className,
      )}
    >
      {icon}
      {children}
    </span>
  );
}

/**
 * Status is never communicated by colour alone — every badge pairs its colour
 * with an icon and a text label so it reads correctly for colour-blind users
 * and screen readers.
 */
const PAYMENT_TONE: Record<PaymentStatus, { tone: Tone; icon: ReactNode }> = {
  Paid: { tone: 'green', icon: <CheckCircle2 className="h-3 w-3" aria-hidden="true" /> },
  'Partially Paid': { tone: 'yellow', icon: <Clock className="h-3 w-3" aria-hidden="true" /> },
  Unpaid: { tone: 'red', icon: <AlertCircle className="h-3 w-3" aria-hidden="true" /> },
  Refunded: { tone: 'purple', icon: <RotateCcw className="h-3 w-3" aria-hidden="true" /> },
  Cancelled: { tone: 'slate', icon: <Ban className="h-3 w-3" aria-hidden="true" /> },
};

export function PaymentBadge({ status }: { status: PaymentStatus }) {
  const config = PAYMENT_TONE[status] ?? PAYMENT_TONE.Unpaid;
  return (
    <Badge tone={config.tone} icon={config.icon}>
      {status}
    </Badge>
  );
}

const ORDER_TONE: Record<OrderStatus, { tone: Tone; icon: ReactNode }> = {
  Received: { tone: 'blue', icon: <Shirt className="h-3 w-3" aria-hidden="true" /> },
  'Ready for Pickup': { tone: 'green', icon: <CheckCircle2 className="h-3 w-3" aria-hidden="true" /> },
  'Picked Up': { tone: 'slate', icon: <PackageCheck className="h-3 w-3" aria-hidden="true" /> },
  Cancelled: { tone: 'red', icon: <Ban className="h-3 w-3" aria-hidden="true" /> },
};

/** How an in-progress order reads on screen. */
const ORDER_LABEL: Record<OrderStatus, string> = {
  Received: 'In progress',
  'Ready for Pickup': 'Ready',
  'Picked Up': 'Collected',
  Cancelled: 'Cancelled',
};

export function OrderBadge({ status }: { status: OrderStatus }) {
  const config = ORDER_TONE[status] ?? ORDER_TONE.Received;
  return (
    <Badge tone={config.tone} icon={config.icon}>
      {ORDER_LABEL[status] ?? status}
    </Badge>
  );
}

const PICKUP_TONE: Record<PickupStatus, Tone> = {
  Pending: 'slate',
  Ready: 'green',
  'Picked Up': 'blue',
  Cancelled: 'red',
};

export function PickupBadge({ status }: { status: PickupStatus }) {
  return <Badge tone={PICKUP_TONE[status] ?? 'slate'}>{status}</Badge>;
}
