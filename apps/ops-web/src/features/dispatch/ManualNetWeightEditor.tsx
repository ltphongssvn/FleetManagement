// apps/ops-web/src/features/dispatch/ManualNetWeightEditor.tsx
// T33 Slice E: inline dispatcher net-weight entry for a phieu-can the AI could
// not read. Rendered under a stop cell Nhap KL button; owns the tiny local input
// state and calls the setManualNetWeight server action on confirm. Kept as its
// own client component so DispatchView only tracks WHICH manifest is being
// edited, not the input mechanics.
//
// Validation mirrors the action boundary: only a positive, finite kg is sent;
// empty / zero / negative is a no-op (the action would reject it anyway, but not
// calling avoids a pointless roundtrip). On success the parent closes the editor
// and the action revalidatePath refreshes the board (new kg + Chenh lech).
'use client';
import { useState } from 'react';
import type { JSX } from 'react';
import { setManualNetWeight } from './set-manual-net-weight.action';

export function ManualNetWeightEditor({
  manifestId,
  onDone,
}: {
  manifestId: string;
  onDone: () => void;
}): JSX.Element {
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = (): void => {
    const kg = Number(value);
    if (!Number.isFinite(kg) || kg <= 0) return;
    setBusy(true);
    void setManualNetWeight({ manifestId, extractedNetWeightKg: kg })
      .then(() => { onDone(); })
      .catch(() => { setBusy(false); });
  };
  return (
    <span className='mt-1 inline-flex items-center gap-1'>
      <input
        data-testid={'manual-netweight-input-' + manifestId}
        type='number'
        min={1}
        step='any'
        inputMode='numeric'
        value={value}
        onChange={(e) => { setValue(e.target.value); }}
        aria-label='Nhập khối lượng hàng (kg)'
        className='w-24 rounded border px-1 py-0.5 text-xs tabular-nums'
      />
      <button
        type='button'
        data-testid={'manual-netweight-confirm-' + manifestId}
        onClick={submit}
        disabled={busy}
        className='rounded bg-amber-600 px-1.5 py-0.5 text-xs font-medium text-white hover:bg-amber-700 disabled:opacity-50'
      >
        {'Lưu'}
      </button>
    </span>
  );
}
