import {
  COUNTER_KEYS,
  LIMITS,
  SHEETS,
  type MachineStatus,
  type MachineType,
} from '../../shared/constants.js';
import { manilaIso } from '../../shared/datetime.js';
import type { MachineDto, MachineUsageDto, Paginated, SessionUser } from '../../shared/types.js';
import { badRequest, conflict, notFound } from '../errors.js';
import { getStore } from '../sheets/index.js';
import type { RowView } from '../sheets/table.js';
import { comparisonKey, normaliseText } from '../utils/ids.js';
import { withNamedLock } from '../utils/mutex.js';
import { recordAudit } from './audit.service.js';
import { nextEntityId } from './sequence.service.js';

/**
 * The washers and dryers, and what has actually been through them.
 *
 * A machine's status is derived from whether it has an open usage row, not
 * stored on the machine — except for Maintenance and Retired, which are
 * deliberate human decisions. A stored "In Use" flag drifts the first time a
 * browser is closed mid-load, and then the floor view lies about which drum is
 * free, which is the one thing it exists to tell you.
 *
 * Total Cycles is a counter rather than a derived sum: it survives the usage
 * rows being archived, and it is what a service schedule is read against.
 */

function minutesBetween(from: string, to: string): number | null {
  const start = Date.parse(from);
  const end = Date.parse(to);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return null;
  return Math.round((end - start) / 60000);
}

function toUsageDto(row: RowView): MachineUsageDto {
  const endedAt = row.get('Ended At');
  return {
    usageId: row.get('Usage ID'),
    machineId: row.get('Machine ID'),
    machineName: row.get('Machine Name'),
    machineType: (row.get('Machine Type') || 'Washer') as MachineType,
    transactionId: row.get('Transaction ID'),
    orNumber: row.get('O.R. Number'),
    startedAt: row.get('Started At'),
    endedAt: endedAt || null,
    minutes: endedAt ? minutesBetween(row.get('Started At'), endedAt) : null,
    operator: row.get('Operator'),
    notes: row.get('Notes'),
  };
}

function toMachineDto(row: RowView, currentUsage: MachineUsageDto | null): MachineDto {
  const declared = (row.get('Status') || 'Available') as MachineStatus;
  /*
   * An open load wins over "Available", but never over a machine someone has
   * taken out of service: if the belt is off, the drum is not free whatever a
   * stale usage row claims.
   */
  const status: MachineStatus =
    declared === 'Maintenance' || declared === 'Retired'
      ? declared
      : currentUsage
        ? 'In Use'
        : 'Available';

  return {
    machineId: row.get('Machine ID'),
    name: row.get('Name'),
    type: (row.get('Type') || 'Washer') as MachineType,
    capacityKg: row.num('Capacity Kg'),
    location: row.get('Location'),
    status,
    cycleMinutes: row.num('Cycle Minutes') || 45,
    totalCycles: row.num('Total Cycles'),
    lastServiceDate: row.get('Last Service Date'),
    notes: row.get('Notes'),
    currentUsage,
  };
}

async function openUsageByMachine(): Promise<Map<string, MachineUsageDto>> {
  const table = await getStore().table(SHEETS.machineUsage);
  const open = new Map<string, MachineUsageDto>();
  for (const row of table.rows) {
    if (row.get('Status') !== 'Active') continue;
    if (row.get('Ended At')) continue;
    open.set(row.get('Machine ID'), toUsageDto(row));
  }
  return open;
}

/* ------------------------------------------------------------- reading */

export async function listMachines(includeRetired = false): Promise<MachineDto[]> {
  const [table, open] = await Promise.all([
    getStore().table(SHEETS.machines),
    openUsageByMachine(),
  ]);

  return table.rows
    .filter((row) => includeRetired || row.get('Status') !== 'Retired')
    .map((row) => toMachineDto(row, open.get(row.get('Machine ID')) ?? null))
    // Washers before dryers, then by name: the order the floor is laid out in.
    .sort(
      (a, b) =>
        a.type.localeCompare(b.type) ||
        a.name.localeCompare(b.name, undefined, { numeric: true }),
    );
}

export async function getMachine(machineId: string): Promise<MachineDto> {
  const row = (await getStore().table(SHEETS.machines)).rows.find(
    (entry) => entry.get('Machine ID') === machineId,
  );
  if (!row) throw notFound('Machine');
  const open = await openUsageByMachine();
  return toMachineDto(row, open.get(machineId) ?? null);
}

export async function listUsage(query: {
  page: number;
  pageSize: number;
  machineId?: string;
  from?: string;
  to?: string;
}): Promise<Paginated<MachineUsageDto>> {
  const table = await getStore().table(SHEETS.machineUsage);
  const rows = table.rows
    .filter((row) => {
      if (row.get('Status') !== 'Active') return false;
      if (query.machineId && row.get('Machine ID') !== query.machineId) return false;
      const day = row.get('Started At').slice(0, 10);
      if (query.from && day < query.from) return false;
      if (query.to && day > query.to) return false;
      return true;
    })
    .sort((a, b) => b.get('Started At').localeCompare(a.get('Started At')));

  const start = (query.page - 1) * query.pageSize;
  return {
    items: rows.slice(start, start + query.pageSize).map(toUsageDto),
    page: query.page,
    pageSize: query.pageSize,
    total: rows.length,
    totalPages: Math.max(1, Math.ceil(rows.length / query.pageSize)),
  };
}

/* ------------------------------------------------------------- writing */

export async function createMachine(
  input: {
    name: string;
    type: MachineType;
    capacityKg?: number;
    location?: string;
    cycleMinutes?: number;
    notes?: string;
  },
  actor: SessionUser,
): Promise<MachineDto> {
  const name = normaliseText(input.name, 60);
  if (name.length < 1) throw badRequest('Give the machine a name, such as "Washer 1".');

  return withNamedLock('machines:write', async () => {
    const table = await getStore().table(SHEETS.machines, { fresh: true });
    const clash = table.rows.some(
      (row) =>
        row.get('Status') !== 'Retired' && comparisonKey(row.get('Name')) === comparisonKey(name),
    );
    if (clash) throw conflict('A machine with that name already exists.');

    const machineId = await nextEntityId(
      COUNTER_KEYS.machineId,
      'MCH-',
      SHEETS.machines,
      'Machine ID',
      4,
    );
    const timestamp = manilaIso();

    await getStore().appendRecords(SHEETS.machines, [
      {
        'Machine ID': machineId,
        Name: name,
        Type: input.type,
        'Capacity Kg': String(Math.max(0, Number(input.capacityKg) || 0)),
        Location: normaliseText(input.location, 60),
        Status: 'Available',
        'Cycle Minutes': String(Math.max(1, Number(input.cycleMinutes) || 45)),
        'Total Cycles': '0',
        'Last Service Date': '',
        Notes: normaliseText(input.notes, LIMITS.maxNotesLength),
        'Created At': timestamp,
        'Updated At': timestamp,
      },
    ]);

    await recordAudit({
      actor,
      action: 'MACHINE_CREATE',
      module: 'Machines',
      entityId: machineId,
      newValue: { name, type: input.type },
    });

    return getMachine(machineId);
  });
}

export async function updateMachine(
  machineId: string,
  input: {
    name?: string;
    location?: string;
    status?: MachineStatus;
    capacityKg?: number;
    cycleMinutes?: number;
    lastServiceDate?: string;
    notes?: string;
  },
  actor: SessionUser,
): Promise<MachineDto> {
  return withNamedLock('machines:write', async () => {
    const table = await getStore().table(SHEETS.machines, { fresh: true });
    const row = table.rows.find((entry) => entry.get('Machine ID') === machineId);
    if (!row) throw notFound('Machine');

    const patch: Record<string, string> = { 'Updated At': manilaIso() };
    if (input.name !== undefined) patch.Name = normaliseText(input.name, 60);
    if (input.location !== undefined) patch.Location = normaliseText(input.location, 60);
    if (input.capacityKg !== undefined) {
      patch['Capacity Kg'] = String(Math.max(0, Number(input.capacityKg) || 0));
    }
    if (input.cycleMinutes !== undefined) {
      patch['Cycle Minutes'] = String(Math.max(1, Number(input.cycleMinutes) || 45));
    }
    if (input.lastServiceDate !== undefined) patch['Last Service Date'] = input.lastServiceDate;
    if (input.notes !== undefined) {
      patch.Notes = normaliseText(input.notes, LIMITS.maxNotesLength);
    }

    if (input.status !== undefined) {
      // Taking a machine out of service with a load still in it would strand
      // that load as perpetually "in use" and lose the order behind it.
      const open = await openUsageByMachine();
      if (open.has(machineId) && input.status !== 'In Use') {
        throw conflict('Finish or release the load in this machine first.');
      }
      patch.Status = input.status;
    }

    await getStore().updateRecord(SHEETS.machines, row, patch);
    await recordAudit({
      actor,
      action: 'MACHINE_UPDATE',
      module: 'Machines',
      entityId: machineId,
      newValue: input as Record<string, unknown>,
    });

    return getMachine(machineId);
  });
}

/** Put a load in. The order is optional — a shop test run is still usage. */
export async function startUsage(
  input: { machineId: string; transactionId?: string; orNumber?: string; notes?: string },
  actor: SessionUser,
): Promise<MachineUsageDto> {
  return withNamedLock('machines:usage', async () => {
    const machine = await getMachine(input.machineId);
    if (machine.currentUsage) throw conflict('That machine already has a load in it.');
    if (machine.status === 'Maintenance' || machine.status === 'Retired') {
      throw conflict('That machine is out of service.');
    }

    const usageId = await nextEntityId(
      COUNTER_KEYS.machineUsageId,
      'USE-',
      SHEETS.machineUsage,
      'Usage ID',
      6,
    );
    const timestamp = manilaIso();

    await getStore().appendRecords(SHEETS.machineUsage, [
      {
        'Usage ID': usageId,
        'Machine ID': machine.machineId,
        'Machine Name': machine.name,
        'Machine Type': machine.type,
        'Transaction ID': normaliseText(input.transactionId, 24),
        'O.R. Number': normaliseText(input.orNumber, 24),
        'Started At': timestamp,
        'Ended At': '',
        Minutes: '',
        Operator: actor.username,
        Status: 'Active',
        Notes: normaliseText(input.notes, LIMITS.maxNotesLength),
        'Created At': timestamp,
      },
    ]);

    await recordAudit({
      actor,
      action: 'MACHINE_ASSIGN',
      module: 'Machines',
      entityId: usageId,
      newValue: { machineId: machine.machineId, transactionId: input.transactionId },
    });

    const table = await getStore().table(SHEETS.machineUsage, { fresh: true });
    const created = table.rows.find((row) => row.get('Usage ID') === usageId);
    if (!created) throw notFound('Usage');
    return toUsageDto(created);
  });
}

/** Take the load out. This is the moment the cycle counter moves. */
export async function endUsage(usageId: string, actor: SessionUser): Promise<MachineUsageDto> {
  return withNamedLock('machines:usage', async () => {
    const usageTable = await getStore().table(SHEETS.machineUsage, { fresh: true });
    const row = usageTable.rows.find((entry) => entry.get('Usage ID') === usageId);
    if (!row) throw notFound('Usage');
    if (row.get('Ended At')) throw conflict('That load has already been taken out.');

    const endedAt = manilaIso();
    const minutes = minutesBetween(row.get('Started At'), endedAt);
    await getStore().updateRecord(SHEETS.machineUsage, row, {
      'Ended At': endedAt,
      Minutes: minutes === null ? '' : String(minutes),
    });

    const machineTable = await getStore().table(SHEETS.machines, { fresh: true });
    const machineRow = machineTable.rows.find(
      (entry) => entry.get('Machine ID') === row.get('Machine ID'),
    );
    if (machineRow) {
      await getStore().updateRecord(SHEETS.machines, machineRow, {
        'Total Cycles': String(machineRow.num('Total Cycles') + 1),
        'Updated At': endedAt,
      });
    }

    await recordAudit({
      actor,
      action: 'MACHINE_RELEASE',
      module: 'Machines',
      entityId: usageId,
      newValue: { minutes },
    });

    const refreshed = (await getStore().table(SHEETS.machineUsage, { fresh: true })).rows.find(
      (entry) => entry.get('Usage ID') === usageId,
    );
    if (!refreshed) throw notFound('Usage');
    return toUsageDto(refreshed);
  });
}

/** Dryer cycles finished in a window — what a gas tank's cost is divided by. */
export async function countDryerCycles(fromIso: string, toIso: string): Promise<number> {
  const table = await getStore().table(SHEETS.machineUsage);
  return table.rows.filter((row) => {
    if (row.get('Status') !== 'Active') return false;
    if (row.get('Machine Type') !== 'Dryer') return false;
    const endedAt = row.get('Ended At');
    if (!endedAt) return false;
    return endedAt >= fromIso && endedAt <= toIso;
  }).length;
}
