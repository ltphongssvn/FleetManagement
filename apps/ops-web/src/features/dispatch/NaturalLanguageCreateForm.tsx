// apps/ops-web/src/features/dispatch/NaturalLanguageCreateForm.tsx
// T38 (2026): natural-language (Mad-Libs / sentence) create form. A presentational
// re-layout of the SAME create contract CreateOrderForm drives: it emits byte-
// identical FormData field names (plannedStartAt, customer, cargo,
// assignedOperatorId, assignedAssetId, pickupAt, deliveryAt, pickupWarehouse_N,
// deliveryWarehouse_N) into the UNCHANGED create-order.action + DateOnlyFormSchema
// SSOT. Zero create-contract change; the sentence chrome is presentation only.
//
// Reuses the proven machinery from CreateOrderForm verbatim: useActionState bridge,
// the onCreated optimistic-UI effect, and the bidirectional driver<->vehicle pair
// auto-fill. Only the JSX changes: stacked sections become an inline sentence with
// ComboboxField slots. Pickup slots start at 1 and grow via them-kho progressive
// disclosure (design: table-first page, create-on-demand in a drawer).
'use client';
import { useActionState, useEffect, useRef, useState } from 'react';
import type { JSX } from 'react';
import { useRouter } from 'next/navigation';
import { createOrder, type CreateOrderState } from './create-order.action';
import { ComboboxField } from './ui/ComboboxField';
import { FieldError, type CreateOrderFormProps } from './CreateOrderForm';

const slotCls = 'inline-block min-w-[9rem] align-baseline';
const dateSlotCls = 'inline-block rounded-md border border-slate-300 bg-white px-2 py-1 text-sm text-slate-900 align-baseline focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20';

export function NaturalLanguageCreateForm({
  drivers, vehicles = [], customers = [], cargoTypes = [],
  pickupWarehouses = [], deliveryWarehouses = [],
  driverVehicleAssignments = [],
  locale = 'vi',
  onCreated,
}: CreateOrderFormProps): JSX.Element {
  const [state, formAction, pending] = useActionState<CreateOrderState, FormData>(createOrder, undefined);
  const router = useRouter();
  const [pickupCount, setPickupCount] = useState(1);
  const [deliveryCount, setDeliveryCount] = useState(1);
  const addPickup = (): void => { setPickupCount((n) => n + 1); };
  const addDelivery = (): void => { setDeliveryCount((n) => n + 1); };
  const pickupRows = Array.from({ length: pickupCount }, (_, i) => i + 1);
  const deliveryRows = Array.from({ length: deliveryCount }, (_, i) => i + 1);
  const pairedOperatorIds = new Set(driverVehicleAssignments.map((x) => x.operatorId));
  const pairedVehicleIds = new Set(driverVehicleAssignments.map((x) => x.vehicleId));
  const pairedDrivers = drivers.filter((d) => pairedOperatorIds.has(d.id));
  const pairedVehicles = vehicles.filter((v) => pairedVehicleIds.has(v.id));
  const [vehicleValue, setVehicleValue] = useState('');
  const [assetIdValue, setAssetIdValue] = useState('');
  const [driverValue, setDriverValue] = useState('');
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => { setHydrated(true); }, []);
  const handledRefRef = useRef<string | null>(null);
  const onCreatedRef = useRef(onCreated);
  onCreatedRef.current = onCreated;
  const valuesRef = useRef({ operatorId: driverValue, assetId: assetIdValue });
  valuesRef.current = { operatorId: driverValue, assetId: assetIdValue };
  useEffect(() => {
    if (state?.status !== 'created') return;
    if (handledRefRef.current === state.externalRef) return;
    handledRefRef.current = state.externalRef;
    const cb = onCreatedRef.current;
    if (cb) cb(state.externalRef, valuesRef.current);
    router.refresh();
  }, [state, router]);
  const onVehicleChange = (nextPlate: string): void => {
    setVehicleValue(nextPlate);
    if (nextPlate === '') { setAssetIdValue(''); return; }
    const veh = pairedVehicles.find((v) => v.label === nextPlate);
    if (!veh) return;
    setAssetIdValue(veh.id);
    const pair = driverVehicleAssignments.find((x) => x.vehicleId === veh.id);
    if (pair) setDriverValue(pair.operatorId);
  };
  const onDriverChange = (nextOperatorId: string): void => {
    setDriverValue(nextOperatorId);
    if (nextOperatorId === '') return;
    const pair = driverVehicleAssignments.find((x) => x.operatorId === nextOperatorId);
    if (!pair) return;
    const veh = pairedVehicles.find((v) => v.id === pair.vehicleId);
    if (veh) { setVehicleValue(veh.label); setAssetIdValue(veh.id); }
  };
  const errs = state?.status === 'invalid' ? state.errors : {};
  const topError = state?.status === 'api_error' || state?.status === 'server_error' ? state.message : undefined;
  const createdRef = state?.status === 'created' ? state.externalRef : undefined;
  const vi = locale === 'vi';
  const ph = (labelVi: string, labelEn: string): string =>
    vi ? 'Chọn ' + labelVi : 'Select ' + labelEn;
  const lead = vi ? 'Hôm nay ngày ' : 'Today ';
  return (
    <form action={formAction} data-testid='nl-create-order-form' data-hydrated={hydrated ? 'true' : 'false'} className='rounded-2xl border border-white/60 bg-white/95 p-6 text-[15px] leading-9 text-slate-800 shadow-xl shadow-indigo-900/5 ring-1 ring-slate-900/5'>
      {topError ? (
        <div role='alert' className='mb-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700'>{topError}</div>
      ) : null}
      {createdRef ? (
        <div role='status' className='mb-4 rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800'>
          <span className='font-semibold'>{vi ? 'Số Lệnh' : 'Order No'}:</span> <span className='font-mono'>{createdRef}</span>
        </div>
      ) : null}
      <div className='flex flex-wrap items-baseline gap-x-1 gap-y-2'>
        <span>{lead}</span>
        <input name='plannedStartAt' type='date' required aria-label={vi ? 'Ngày điều xe' : 'Dispatch date'} className={dateSlotCls} />
        <span>{vi ? 'hãy làm lệnh điều xe' : 'create a dispatch order for truck'}</span>
        <span className={slotCls}>
          <ComboboxField id='vehiclePlate' name='vehiclePlate' options={pairedVehicles} placeholder={ph('số xe', 'truck')} value={vehicleValue} onChange={onVehicleChange} />
          <input type='hidden' name='assignedAssetId' value={assetIdValue} readOnly />
        </span>
        <span>{vi ? 'do tài xế' : 'driven by'}</span>
        <span className={slotCls}>
          <ComboboxField id='assignedOperatorId' name='assignedOperatorId' options={pairedDrivers} placeholder={ph('tài xế', 'driver')} required submitValue='id' value={driverValue} onChange={onDriverChange} />
        </span>
        <span>{vi ? 'chở' : 'carrying'}</span>
        <span className={slotCls}>
          <ComboboxField name='cargo' options={cargoTypes} placeholder={ph('tên hàng', 'cargo')} submitValue='id' />
        </span>
        <span>{vi ? 'cho khách hàng' : 'for customer'}</span>
        <span className={slotCls}>
          <ComboboxField name='customer' options={customers} placeholder={ph('khách hàng', 'customer')} submitValue='id' />
        </span>
        <span>{vi ? '. Tài xế tới kho nhận hàng ngày' : '. Pick up on'}</span>
        <input name='pickupAt' type='date' required aria-label={vi ? 'Ngày nhận hàng' : 'Pickup date'} className={dateSlotCls} />
        <span>{vi ? 'tại' : 'at'}</span>
        {pickupRows.map((n) => {
          const whId = 'pickupWarehouse_' + String(n);
          return (
            <span key={n} className={slotCls}>
              <ComboboxField id={whId} name={whId} options={pickupWarehouses} placeholder={ph('kho nhận', 'warehouse')} submitValue='id' />
            </span>
          );
        })}
        <button type='button' onClick={addPickup} className='rounded-md border border-dashed border-indigo-300 bg-indigo-50/50 px-2 py-1 text-sm font-medium text-indigo-700 transition hover:bg-indigo-50'>
          <span aria-hidden='true'>+</span> {vi ? 'thêm kho nhận hàng' : 'add loading warehouse'}
        </button>
        <span>{vi ? ', xong giao ở kho' : ', then deliver to'}</span>
        {deliveryRows.map((n) => {
          const whId = 'deliveryWarehouse_' + String(n);
          return (
            <span key={n} className={slotCls}>
              <ComboboxField id={whId} name={whId} options={deliveryWarehouses} placeholder={ph('kho giao', 'warehouse')} submitValue='id' />
            </span>
          );
        })}
        <button type='button' onClick={addDelivery} className='rounded-md border border-dashed border-indigo-300 bg-indigo-50/50 px-2 py-1 text-sm font-medium text-indigo-700 transition hover:bg-indigo-50'>
          <span aria-hidden='true'>+</span> {vi ? 'thêm kho giao hàng' : 'add unloading warehouse'}
        </button>
        <span>{vi ? '. Khách cần nhận hàng ngày' : '. Customer delivery date'}</span>
        <input name='deliveryAt' type='date' required aria-label={vi ? 'Ngày giao hàng' : 'Delivery date'} className={dateSlotCls} />
        <span>.</span>
      </div>
      <FieldError msg={errs.pickupWarehouses} />
      <FieldError msg={errs.deliveryWarehouses} />
      <FieldError msg={errs.assignedOperatorId} />
      <div className='mt-6 flex items-center justify-end'>
        <button type='submit' disabled={pending} className='inline-flex items-center gap-2 rounded-md bg-indigo-600 px-5 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-500 disabled:opacity-60'>
          {pending ? (vi ? 'Đang tạo…' : 'Creating…') : (vi ? 'Tạo lệnh' : 'Create order')}
        </button>
      </div>
    </form>
  );
}
