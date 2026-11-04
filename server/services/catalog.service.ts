import { COUNTER_KEYS, DEFAULT_SERVICES, SHEETS } from '../../shared/constants.js';
import { manilaIso } from '../../shared/datetime.js';
import { toCentavos, toPesos, type Centavos } from '../../shared/money.js';
import type { ServiceDto, SessionUser } from '../../shared/types.js';
import { badRequest, conflict, notFound } from '../errors.js';
import { getStore } from '../sheets/index.js';
import type { RowView } from '../sheets/table.js';
import { comparisonKey, normaliseText } from '../utils/ids.js';
import { withNamedLock } from '../utils/mutex.js';
import { recordAudit } from './audit.service.js';
import { nextEntityId } from './sequence.service.js';

/**
 * The service catalogue is the ONLY source of pricing.
 *
 * Prices are never hardcoded in the POS: a transaction resolves its unit price
 * here at the moment of sale and then stores that price on the transaction row.
 * Later price edits therefore affect new sales only, and historical receipts
 * keep the price that was actually charged.
 */

export interface ServiceRecord extends ServiceDto {
  row: RowView;
}

function toRecord(row: RowView): ServiceRecord {
  return {
    serviceId: row.get('Service ID'),
    name: row.get('Name'),
    description: row.get('Description'),
    price: row.num('Price'),
    unit: row.get('Unit') || 'load',
    status: row.get('Status') === 'Inactive' ? 'Inactive' : 'Active',
    sortOrder: row.num('Sort Order', 999),
    createdAt: row.get('Created At'),
    updatedAt: row.get('Updated At'),
    row,
  };
}

export function toServiceDto(record: ServiceRecord): ServiceDto {
  const { row: _row, ...dto } = record;
  return dto;
}

export async function listServices(includeInactive = false): Promise<ServiceDto[]> {
  const table = await getStore().table(SHEETS.services);
  return table.rows
    .map(toRecord)
    .filter((service) => includeInactive || service.status === 'Active')
    .map(toServiceDto)
    .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
}

export async function getServiceRecord(serviceId: string): Promise<ServiceRecord | null> {
  const table = await getStore().table(SHEETS.services);
  const row = table.find((candidate) => candidate.get('Service ID') === serviceId);
  return row ? toRecord(row) : null;
}

/**
 * Resolve the price to charge, server-side. The client's idea of the price is
 * never trusted — this is what stops a tampered request from underpaying.
 */
export async function resolvePricing(serviceId: string): Promise<{
  serviceId: string;
  name: string;
  unitPriceC: Centavos;
}> {
  const record = await getServiceRecord(serviceId);
  if (!record) throw notFound('Service');
  if (record.status !== 'Active') {
    throw badRequest('"' + record.name + '" is not currently offered.');
  }
  const unitPriceC = toCentavos(record.price);
  if (unitPriceC <= 0) {
    throw badRequest('"' + record.name + '" has no price configured. Set a price in Services.');
  }
  return { serviceId: record.serviceId, name: record.name, unitPriceC };
}

/** Seed the three default services on a fresh workbook. Returns how many. */
export async function seedServices(): Promise<number> {
  return withNamedLock('services:write', async () => {
    const store = getStore();
    const table = await store.table(SHEETS.services, { fresh: true });
    const existing = new Set(table.rows.map((row) => comparisonKey(row.get('Name'))));
    const timestamp = manilaIso();

    const missing = DEFAULT_SERVICES.filter((s) => !existing.has(comparisonKey(s.name)));
    if (missing.length === 0) return 0;

    let counter = table.size;
    const records = missing.map((service) => {
      counter += 1;
      return {
        'Service ID': 'SVC-' + String(counter).padStart(3, '0'),
        Name: service.name,
        Description: service.description,
        Price: service.price.toFixed(2),
        Unit: 'load',
        Status: 'Active',
        'Sort Order': String(service.sortOrder),
        'Created At': timestamp,
        'Updated At': timestamp,
      };
    });

    await store.appendRecords(SHEETS.services, records);
    return records.length;
  });
}

export interface CreateServiceInput {
  name: string;
  description?: string;
  price: number;
  unit?: string;
  sortOrder?: number;
}

export async function createService(
  input: CreateServiceInput,
  actor: SessionUser,
): Promise<ServiceDto> {
  const name = normaliseText(input.name, 60);
  if (name.length < 2) throw badRequest('Service name is required.');

  const priceC = toCentavos(input.price);
  if (priceC <= 0) throw badRequest('Price must be greater than zero.');

  return withNamedLock('services:write', async () => {
    const store = getStore();
    const table = await store.table(SHEETS.services, { fresh: true });
    if (table.find((row) => comparisonKey(row.get('Name')) === comparisonKey(name))) {
      throw conflict('A service with that name already exists.');
    }

    const serviceId = await nextEntityId(
      COUNTER_KEYS.serviceId,
      'SVC-',
      SHEETS.services,
      'Service ID',
      3,
    );
    const timestamp = manilaIso();

    await store.appendRecords(SHEETS.services, [
      {
        'Service ID': serviceId,
        Name: name,
        Description: normaliseText(input.description, 160),
        Price: toPesos(priceC).toFixed(2),
        Unit: normaliseText(input.unit, 20) || 'load',
        Status: 'Active',
        'Sort Order': String(input.sortOrder ?? table.size + 1),
        'Created At': timestamp,
        'Updated At': timestamp,
      },
    ]);

    await recordAudit({
      actor,
      action: 'SERVICE_CREATE',
      module: 'Services',
      entityId: serviceId,
      newValue: { name, price: toPesos(priceC) },
    });

    const created = await getServiceRecord(serviceId);
    if (!created) throw notFound('The new service');
    return toServiceDto(created);
  });
}

export interface UpdateServiceInput {
  name?: string;
  description?: string;
  price?: number;
  unit?: string;
  status?: 'Active' | 'Inactive';
  sortOrder?: number;
}

export async function updateService(
  serviceId: string,
  input: UpdateServiceInput,
  actor: SessionUser,
): Promise<ServiceDto> {
  return withNamedLock('services:write', async () => {
    const store = getStore();
    const record = await getServiceRecord(serviceId);
    if (!record) throw notFound('Service');

    const patch: Record<string, string> = { 'Updated At': manilaIso() };
    let priceChanged = false;

    if (input.name !== undefined) {
      const name = normaliseText(input.name, 60);
      if (name.length < 2) throw badRequest('Service name is required.');
      patch.Name = name;
    }
    if (input.description !== undefined) {
      patch.Description = normaliseText(input.description, 160);
    }
    if (input.price !== undefined) {
      const priceC = toCentavos(input.price);
      if (priceC <= 0) throw badRequest('Price must be greater than zero.');
      patch.Price = toPesos(priceC).toFixed(2);
      priceChanged = toPesos(priceC) !== record.price;
    }
    if (input.unit !== undefined) patch.Unit = normaliseText(input.unit, 20) || 'load';
    if (input.status !== undefined) patch.Status = input.status;
    if (input.sortOrder !== undefined) patch['Sort Order'] = String(input.sortOrder);

    await store.updateRecord(SHEETS.services, record.row, patch);

    await recordAudit({
      actor,
      action: priceChanged ? 'PRICE_CHANGE' : 'SERVICE_UPDATE',
      module: 'Services',
      entityId: serviceId,
      previousValue: { name: record.name, price: record.price, status: record.status },
      newValue: input,
    });

    const updated = await getServiceRecord(serviceId);
    if (!updated) throw notFound('Service');
    return toServiceDto(updated);
  });
}
