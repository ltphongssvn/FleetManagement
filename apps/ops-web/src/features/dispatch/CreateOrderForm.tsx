// apps/ops-web/src/features/dispatch/CreateOrderForm.tsx
// Bilingual VN/EN dispatcher form mirroring the LENH DIEU XE spreadsheet.
// Uses Headless UI Combobox via ComboboxField — portal-rendered, searchable,
// immune to overflow clipping.
//
// Multi-pickup: section 4 always renders 4 fixed pickup-warehouse slots
// (pickupWarehouse_1..4) sharing one pickupAt date. The dispatcher assigns
// 1..4 of them; unassigned slots show a 'None' placeholder and submit empty.
// Section 5 is a single delivery field (deliveryAt / deliveryWarehouse): all
// goods unload at exactly one destination warehouse.
'use client';
import { useActionState, useState } from 'react';
import type { JSX } from 'react';
import { createOrder, type CreateOrderState } from './create-order.action';
import { ComboboxField } from './ui/ComboboxField';
import { t, type Locale } from '@/lib/i18n';
export interface DriverOption { readonly id: string; readonly label: string }
export interface RefOption { readonly id: string; readonly label: string }
export interface CreateOrderFormProps {
  readonly drivers: readonly DriverOption[];
  readonly vehicles?: readonly RefOption[];
  readonly customers?: readonly RefOption[];
  readonly cargoTypes?: readonly RefOption[];
  readonly pickupWarehouses?: readonly RefOption[];
  readonly deliveryWarehouses?: readonly RefOption[];
  readonly defaultOrderRef?: string;
  readonly locale?: Locale;
}
const inputCls =
  'block w-full rounded-md border border-slate-300 bg-white px-3 py-2 pr-10 text-sm text-slate-900 shadow-sm transition placeholder:text-slate-400 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20';
const labelCls = 'block text-xs font-medium uppercase tracking-wide text-slate-600';
const sectionCls = 'border-b border-slate-200 px-6 py-5 last:border-b-0';
const sectionTitleCls = 'mb-4 flex items-center gap-2 text-sm font-semibold text-slate-900';
const stepBadgeCls =
  'inline-flex h-6 w-6 items-center justify-center rounded-full bg-indigo-50 text-xs font-semibold text-indigo-700 ring-1 ring-inset ring-indigo-200';
export function FieldError({ msg }: { msg?: string | undefined }): JSX.Element | null {
  if (!msg) return null;
  return <p className='mt-1 text-xs text-red-600'>{msg}</p>;
}
export function CreateOrderForm({
  drivers, vehicles = [], customers = [], cargoTypes = [],
  pickupWarehouses = [], deliveryWarehouses = [], defaultOrderRef = '', locale = 'vi',
}: CreateOrderFormProps): JSX.Element {
  const [state, formAction, pending] = useActionState<CreateOrderState, FormData>(createOrder, undefined);
  // Dynamic warehouse rows. Section 4 starts at 4 pickup slots, section 5 at 1
  // delivery slot; either side grows without a hard cap for rare business
  // cases. Local UI state only; the server reads indexed *Warehouse_N fields.
  const [pickupCount, setPickupCount] = useState(4);
  const [deliveryCount, setDeliveryCount] = useState(1);
  const addPickup = (): void => { setPickupCount((n) => n + 1); };
  const addDelivery = (): void => { setDeliveryCount((n) => n + 1); };
  const pickupRows = Array.from({ length: pickupCount }, (_, i) => i + 1);
  const deliveryRows = Array.from({ length: deliveryCount }, (_, i) => i + 1);
  const errs = state?.status === 'invalid' ? state.errors : {};
  const topError = state?.status === 'api_error' || state?.status === 'server_error' ? state.message : undefined;
  const tx = (k: string): string => t(locale, k);
  const ph = (k: string): string =>
    locale === 'vi' ? '— Chọn ' + k.toLowerCase() + ' —' : '— Select ' + k.toLowerCase() + ' —';
  const inputMt = inputCls + ' mt-1';
  return (
    <form action={formAction} className='rounded-2xl border border-white/60 bg-white/95 shadow-xl shadow-indigo-900/5 ring-1 ring-slate-900/5'>
      <div className='rounded-t-2xl border-b border-slate-200/70 bg-gradient-to-r from-indigo-50/60 via-white/40 to-sky-50/60 px-6 py-4'>
        <h2 className='text-base font-semibold uppercase tracking-wide text-slate-900'>{tx('orderForm.title')}</h2>
        <p className='mt-0.5 text-xs text-slate-500'>{locale === 'vi' ? 'Vui lòng điền đầy đủ thông tin bên dưới.' : 'Fill in the fields below to create a dispatch order.'}</p>
      </div>
      {topError ? (
        <div role='alert' className='mx-6 mt-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700'>{topError}</div>
      ) : null}
      <div className={sectionCls}>
        <div className={sectionTitleCls}><span className={stepBadgeCls}>1</span>{tx('orderForm.orderNo')} & {tx('orderForm.orderDate')}</div>
        <div className='grid grid-cols-1 gap-4 sm:grid-cols-2'>
          <div>
            <label htmlFor='externalRef' className={labelCls}>{tx('orderForm.orderNo')}</label>
            <input id='externalRef' name='externalRef' required placeholder='XT.001' defaultValue={defaultOrderRef} className={inputCls + ' mt-1 font-mono uppercase'} />
            <FieldError msg={errs.externalRef} />
          </div>
          <div>
            <label htmlFor='plannedStartAt' className={labelCls}>{tx('orderForm.orderDate')}</label>
            <input id='plannedStartAt' name='plannedStartAt' type='datetime-local' required className={inputMt} />
          </div>
        </div>
      </div>
      <div className={sectionCls}>
        <div className={sectionTitleCls}><span className={stepBadgeCls}>2</span>{tx('orderForm.customer')} & {tx('orderForm.cargo')}</div>
        <div className='grid grid-cols-1 gap-4 sm:grid-cols-2'>
          <div>
            <label htmlFor='customer' className={labelCls}>{tx('orderForm.customer')}</label>
            <ComboboxField id='customer' name='customer' options={customers} placeholder={ph(tx('orderForm.customer'))} />
          </div>
          <div>
            <label htmlFor='cargo' className={labelCls}>{tx('orderForm.cargo')}</label>
            <ComboboxField id='cargo' name='cargo' options={cargoTypes} placeholder={ph(tx('orderForm.cargo'))} />
          </div>
        </div>
      </div>
      <div className={sectionCls}>
        <div className={sectionTitleCls}><span className={stepBadgeCls}>3</span>{tx('orderForm.vehiclePlate')} / {tx('orderForm.driverName')}</div>
        <div className='grid grid-cols-1 gap-4 sm:grid-cols-2'>
          <div>
            <label htmlFor='vehiclePlate' className={labelCls}>{tx('orderForm.vehiclePlate')}</label>
            <ComboboxField id='vehiclePlate' name='vehiclePlate' options={vehicles} placeholder={ph(tx('orderForm.vehiclePlate'))} />
          </div>
          <div>
            <label htmlFor='assignedOperatorId' className={labelCls}>{tx('orderForm.driverName')}</label>
            <ComboboxField id='assignedOperatorId' name='assignedOperatorId' options={drivers} placeholder={tx('orderForm.selectDriver')} required submitValue='id' />
            <FieldError msg={errs.assignedOperatorId} />
          </div>
        </div>
      </div>
      <div className={sectionCls}>
        <div className={sectionTitleCls}>
          <span className={stepBadgeCls}>4</span>
          {tx('orderForm.pickupDate')} & {tx('orderForm.pickupWarehouse')}
        </div>
        <p className='mb-3 text-xs text-slate-500'>{tx('orderForm.maxPickupsHint')}</p>
        <div className='mb-4'>
          <label htmlFor='pickupAt' className={labelCls}>{tx('orderForm.pickupDate')}</label>
          <input id='pickupAt' name='pickupAt' type='datetime-local' required className={inputMt} />
          <FieldError msg={errs.pickupAt} />
        </div>
        <div className='grid grid-cols-1 gap-3 sm:grid-cols-2'>
          {pickupRows.map((n) => {
            const whId = 'pickupWarehouse_' + String(n);
            return (
              <div key={n} className='rounded-lg border border-slate-200 bg-slate-50/60 p-3'>
                <label htmlFor={whId} className={labelCls}>{tx('orderForm.pickup')} {n}</label>
                <ComboboxField id={whId} name={whId} options={pickupWarehouses} placeholder={tx('orderForm.none')} />
              </div>
            );
          })}
        </div>
        <button
          type='button'
          onClick={addPickup}
          className='mt-4 inline-flex items-center gap-1 rounded-md border border-dashed border-indigo-300 bg-indigo-50/50 px-3 py-2 text-sm font-medium text-indigo-700 transition hover:bg-indigo-50'
        >
          <span aria-hidden='true'>+</span> {tx('orderForm.addPickupWarehouse')}
        </button>
        <FieldError msg={errs.pickupWarehouses} />
      </div>
      <div className={sectionCls}>
        <div className={sectionTitleCls}>
          <span className={stepBadgeCls}>5</span>
          {tx('orderForm.deliveryDate')} & {tx('orderForm.deliveryWarehouse')}
        </div>
        <p className='mb-3 text-xs text-slate-500'>{tx('orderForm.deliveryHint')}</p>
        <div className='mb-4'>
          <label htmlFor='deliveryAt' className={labelCls}>{tx('orderForm.deliveryDate')}</label>
          <input id='deliveryAt' name='deliveryAt' type='datetime-local' required className={inputMt} />
          <FieldError msg={errs.deliveryAt} />
        </div>
        <div className='grid grid-cols-1 gap-3 sm:grid-cols-2'>
          {deliveryRows.map((n) => {
            const whId = 'deliveryWarehouse_' + String(n);
            return (
              <div key={n} className='rounded-lg border border-slate-200 bg-slate-50/60 p-3'>
                <label htmlFor={whId} className={labelCls}>{tx('orderForm.deliveryWarehouse')} {n}</label>
                <ComboboxField id={whId} name={whId} options={deliveryWarehouses} placeholder={tx('orderForm.none')} />
              </div>
            );
          })}
        </div>
        <button
          type='button'
          onClick={addDelivery}
          className='mt-4 inline-flex items-center gap-1 rounded-md border border-dashed border-indigo-300 bg-indigo-50/50 px-3 py-2 text-sm font-medium text-indigo-700 transition hover:bg-indigo-50'
        >
          <span aria-hidden='true'>+</span> {tx('orderForm.addDeliveryWarehouse')}
        </button>
        <FieldError msg={errs.deliveryWarehouses} />
      </div>
      <div className='flex items-center justify-between gap-3 rounded-b-2xl border-t border-slate-200/70 bg-gradient-to-r from-slate-50/80 to-white/60 px-6 py-4'>
        <p className='text-xs text-slate-500'>{locale === 'vi' ? 'Kiểm tra kỹ thông tin trước khi tạo lệnh.' : 'Review the information before submitting.'}</p>
        <div className='flex items-center gap-2'>
          <button type='reset' className='rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 shadow-sm transition hover:bg-slate-50'>
            {locale === 'vi' ? 'Đặt lại' : 'Reset'}
          </button>
          <button type='submit' disabled={pending} className='inline-flex items-center gap-2 rounded-md bg-indigo-600 px-5 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-500 disabled:opacity-60'>
            {pending ? tx('orderForm.submitting') : tx('orderForm.submit')}
          </button>
        </div>
      </div>
    </form>
  );
}
