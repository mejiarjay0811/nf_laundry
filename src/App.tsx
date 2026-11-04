import { Suspense, lazy, useCallback, useState } from 'react';
import { Route, Routes } from 'react-router-dom';
import { Landing, RequireAuth, RequireCapability } from '@/auth/guards';
import { AppLayout } from '@/layouts/AppLayout';
import { SplashScreen } from '@/components/SplashScreen';
import { Spinner } from '@/components/ui/States';

/** Survives remounts, so the splash plays once per launch. */
let splashAlreadyShown = false;

const Login = lazy(() => import('@/pages/Login'));
const Dashboard = lazy(() => import('@/pages/Dashboard'));
const Pos = lazy(() => import('@/pages/Pos'));
const Transactions = lazy(() => import('@/pages/Transactions'));
const TransactionDetail = lazy(() => import('@/pages/TransactionDetail'));
const Customers = lazy(() => import('@/pages/Customers'));
const CustomerDetail = lazy(() => import('@/pages/CustomerDetail'));
const Pickup = lazy(() => import('@/pages/Pickup'));
const Sales = lazy(() => import('@/pages/Sales'));
const DailySummary = lazy(() => import('@/pages/reports/DailySummary'));
const WeeklySummary = lazy(() => import('@/pages/reports/WeeklySummary'));
const MonthlySummary = lazy(() => import('@/pages/reports/MonthlySummary'));
const YearlySummary = lazy(() => import('@/pages/reports/YearlySummary'));
const Services = lazy(() => import('@/pages/Services'));
const Inventory = lazy(() => import('@/pages/Inventory'));
const Shifts = lazy(() => import('@/pages/Shifts'));
const Machines = lazy(() => import('@/pages/Machines'));
const Gas = lazy(() => import('@/pages/Gas'));
const Loyalty = lazy(() => import('@/pages/Loyalty'));
const Expenses = lazy(() => import('@/pages/Expenses'));
const Profit = lazy(() => import('@/pages/Profit'));
const Users = lazy(() => import('@/pages/Users'));
const AuditLogs = lazy(() => import('@/pages/AuditLogs'));
const Settings = lazy(() => import('@/pages/Settings'));
const NotFound = lazy(() => import('@/pages/NotFound'));

function PageLoader() {
  return (
    <div className="flex min-h-[50vh] items-center justify-center">
      <Spinner className="h-6 w-6" />
    </div>
  );
}

export default function App() {
  /*
   * Once per launch, not once per navigation. The check runs at module scope so
   * a remount — React's strict mode double-invoke in development, or a route
   * that unmounts the tree — cannot bring the splash back mid-session.
   */
  const [splashDone, setSplashDone] = useState(splashAlreadyShown);

  const dismissSplash = useCallback(() => {
    splashAlreadyShown = true;
    setSplashDone(true);
  }, []);

  return (
    <Suspense fallback={<PageLoader />}>
      {splashDone ? null : <SplashScreen onDone={dismissSplash} />}
      <Routes>
        <Route path="/login" element={<Login />} />

        <Route
          element={
            <RequireAuth>
              <AppLayout />
            </RequireAuth>
          }
        >
          <Route index element={<Landing />} />

          {/* Each screen names the permission it needs. An account that lacks
              it is sent to its own landing page rather than shown a shell that
              would only fill with permission errors. */}
          <Route element={<RequireCapability needs="pos.sell" />}>
            <Route path="/pos" element={<Pos />} />
          </Route>
          <Route element={<RequireCapability needs="orders.view" />}>
            <Route path="/transactions" element={<Transactions />} />
            <Route path="/transactions/:transactionId" element={<TransactionDetail />} />
            <Route path="/pickup" element={<Pickup />} />
          </Route>
          <Route element={<RequireCapability needs="customers.view" />}>
            <Route path="/customers" element={<Customers />} />
            <Route path="/customers/:customerId" element={<CustomerDetail />} />
          </Route>
          <Route element={<RequireCapability needs="services.manage" />}>
            <Route path="/services" element={<Services />} />
          </Route>

          <Route element={<RequireCapability needs="shifts.operate" />}>
            <Route path="/shifts" element={<Shifts />} />
          </Route>
          <Route element={<RequireCapability needs="machines.view" />}>
            <Route path="/machines" element={<Machines />} />
          </Route>
          <Route element={<RequireCapability needs="gas.view" />}>
            <Route path="/gas" element={<Gas />} />
          </Route>
          <Route element={<RequireCapability needs="loyalty.view" />}>
            <Route path="/loyalty" element={<Loyalty />} />
          </Route>

          {/* Trading figures are the owner's. The server refuses these to staff
              as well; the guard here just avoids loading a screen that would
              only fill with permission errors. */}
          <Route element={<RequireCapability needs="reports.view" />}>
            <Route path="/dashboard" element={<Dashboard />} />
            <Route path="/sales" element={<Sales />} />
            <Route path="/reports/daily" element={<DailySummary />} />
            <Route path="/reports/weekly" element={<WeeklySummary />} />
            <Route path="/reports/monthly" element={<MonthlySummary />} />
            <Route path="/reports/yearly" element={<YearlySummary />} />
          </Route>

          {/* Separate guards, because these are separate permissions: a
              manager runs the stock room without ever seeing the profit. */}
          <Route element={<RequireCapability needs="inventory.view" />}>
            <Route path="/inventory" element={<Inventory />} />
          </Route>
          <Route element={<RequireCapability needs="expenses.view" />}>
            <Route path="/expenses" element={<Expenses />} />
          </Route>
          <Route element={<RequireCapability needs="reports.profit" />}>
            <Route path="/profit" element={<Profit />} />
          </Route>

          <Route
            path="/users"
            element={
              <RequireCapability needs="users.manage">
                <Users />
              </RequireCapability>
            }
          />
          <Route
            path="/audit-logs"
            element={
              <RequireCapability needs="audit.view">
                <AuditLogs />
              </RequireCapability>
            }
          />
          <Route
            path="/settings"
            element={
              <RequireCapability needs="settings.manage">
                <Settings />
              </RequireCapability>
            }
          />

          <Route path="*" element={<NotFound />} />
        </Route>
      </Routes>
    </Suspense>
  );
}
