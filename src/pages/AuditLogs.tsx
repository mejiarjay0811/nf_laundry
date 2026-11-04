import { useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Download, ScrollText, Search } from 'lucide-react';
import { formatDateTime } from '@shared/datetime';
import type { AuditLogDto, Paginated } from '@shared/types';
import { PageHeader } from '@/components/PageHeader';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Select } from '@/components/ui/Field';
import { Pagination, TableWrap, Td, Th, Tr } from '@/components/ui/Table';
import { EmptyState, ErrorState, SkeletonTable } from '@/components/ui/States';
import { useDebounce } from '@/hooks/useDebounce';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { api } from '@/lib/api';
import { exportCsv } from '@/lib/csv';

const PAGE_SIZE = 50;

const ACTION_TONE = (action: string) => {
  if (action.includes('CANCEL') || action.includes('FAILED')) return 'red' as const;
  if (action.includes('CREATE')) return 'green' as const;
  if (action.includes('PRICE') || action.includes('SETTINGS')) return 'purple' as const;
  if (action.includes('PAYMENT')) return 'blue' as const;
  return 'slate' as const;
};

export default function AuditLogs() {
  useDocumentTitle('Audit Logs');
  const [search, setSearch] = useState('');
  const [action, setAction] = useState('');
  const [module, setModule] = useState('');
  const [page, setPage] = useState(1);
  const debounced = useDebounce(search, 300);

  const facets = useQuery({
    queryKey: ['audit', 'facets'],
    queryFn: ({ signal }) =>
      api.get<{ actions: string[]; modules: string[]; users: string[] }>(
        '/audit-logs/facets',
        undefined,
        signal,
      ),
    staleTime: 5 * 60_000,
  });

  const query = useQuery({
    queryKey: ['audit', { debounced, action, module, page }],
    queryFn: ({ signal }) =>
      api.get<Paginated<AuditLogDto>>(
        '/audit-logs',
        {
          page,
          pageSize: PAGE_SIZE,
          search: debounced || undefined,
          action: action || undefined,
          module: module || undefined,
        },
        signal,
      ),
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  });

  const items = query.data?.items ?? [];

  return (
    <>
      <PageHeader
        title="Audit Logs"
        subtitle={
          query.data
            ? query.data.total + ' recorded events'
            : 'Every change made in the system.'
        }
        actions={
          <Button
            variant="outline"
            size="sm"
            disabled={items.length === 0}
            onClick={() =>
              exportCsv('audit-log-' + new Date().toISOString().slice(0, 10), items, [
                { header: 'Timestamp', value: (row) => row.timestamp },
                { header: 'User', value: (row) => row.username },
                { header: 'Action', value: (row) => row.action },
                { header: 'Module', value: (row) => row.module },
                { header: 'Entity', value: (row) => row.entityId },
                { header: 'Previous', value: (row) => row.previousValue },
                { header: 'New', value: (row) => row.newValue },
              ])
            }
            icon={<Download className="h-4 w-4" aria-hidden="true" />}
          >
            Export CSV
          </Button>
        }
      />

      <div className="card mb-4 grid grid-cols-1 gap-2 p-3 sm:grid-cols-[1fr_180px_180px]">
        <div className="relative">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
            aria-hidden="true"
          />
          <input
            type="search"
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              setPage(1);
            }}
            placeholder="Search user, entity or value"
            aria-label="Search audit log"
            className="h-10 w-full rounded-lg border border-slate-300 pl-9 pr-3 text-sm placeholder:text-slate-400 focus:border-brand-500"
          />
        </div>
        <Select
          aria-label="Filter by action"
          value={action}
          onChange={(event) => {
            setAction(event.target.value);
            setPage(1);
          }}
          className="h-10"
        >
          <option value="">All actions</option>
          {facets.data?.actions.map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </Select>
        <Select
          aria-label="Filter by module"
          value={module}
          onChange={(event) => {
            setModule(event.target.value);
            setPage(1);
          }}
          className="h-10"
        >
          <option value="">All modules</option>
          {facets.data?.modules.map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </Select>
      </div>

      <div className="card overflow-hidden">
        {query.isLoading ? (
          <SkeletonTable rows={10} columns={6} />
        ) : query.isError ? (
          <ErrorState
            title="Unable to load the audit log"
            message={query.error instanceof Error ? query.error.message : undefined}
            onRetry={() => void query.refetch()}
          />
        ) : items.length === 0 ? (
          <EmptyState
            icon={<ScrollText className="h-6 w-6" aria-hidden="true" />}
            title="No audit entries found."
            message="Activity will appear here as staff use the system."
          />
        ) : (
          <>
            <TableWrap>
              <thead>
                <tr>
                  <Th>When</Th>
                  <Th>User</Th>
                  <Th>Action</Th>
                  <Th>Module</Th>
                  <Th>Record</Th>
                  <Th>Details</Th>
                </tr>
              </thead>
              <tbody>
                {items.map((entry) => (
                  <Tr key={entry.logId}>
                    <Td className="whitespace-nowrap text-slate-600 tnum">
                      {formatDateTime(entry.timestamp)}
                    </Td>
                    <Td className="font-medium">{entry.username}</Td>
                    <Td>
                      <Badge tone={ACTION_TONE(entry.action)}>{entry.action}</Badge>
                    </Td>
                    <Td className="text-slate-600">{entry.module}</Td>
                    <Td className="font-mono text-xs text-slate-600">
                      {entry.entityId || '\u2014'}
                    </Td>
                    <Td className="max-w-md">
                      {entry.previousValue ? (
                        <span className="block truncate text-xs text-slate-400">
                          was: {entry.previousValue}
                        </span>
                      ) : null}
                      {entry.newValue ? (
                        <span className="block truncate text-xs text-slate-600">
                          {entry.newValue}
                        </span>
                      ) : null}
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </TableWrap>
            <Pagination
              page={query.data?.page ?? 1}
              pageSize={query.data?.pageSize ?? PAGE_SIZE}
              total={query.data?.total ?? 0}
              totalPages={query.data?.totalPages ?? 1}
              onPageChange={setPage}
            />
          </>
        )}
      </div>
    </>
  );
}
