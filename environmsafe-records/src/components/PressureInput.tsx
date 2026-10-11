import { useEffect, useState } from 'react';
import { fromPa, PRESSURE_UNITS, roundSmart, toPa, type PressureUnit } from '../lib/calc';
import { usePressureUnit } from '../lib/domain';
import { Field } from './ui';

/** Pressure entry in the user's unit; the value is stored in pascals. */
export function PressureInput({ label, valuePa, onChange, hint, disabled }: { label: string; valuePa: number | null | undefined; onChange: (pa: number | null) => void; hint?: string; disabled?: boolean }) {
  const defaultUnit = usePressureUnit();
  const [unit, setUnit] = useState<PressureUnit>(defaultUnit);
  const [text, setText] = useState(valuePa == null ? '' : String(roundSmart(fromPa(valuePa, unit))));
  useEffect(() => {
    setText(valuePa == null ? '' : String(roundSmart(fromPa(valuePa, unit))));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unit]);
  return (
    <Field label={label} hint={hint}>
      {(id) => (
        <div className="flex gap-2">
          <input
            id={id}
            className="input"
            inputMode="decimal"
            disabled={disabled}
            value={text}
            onChange={(e) => {
              const t = e.target.value.replace(',', '.');
              setText(t);
              const n = parseFloat(t);
              onChange(t.trim() === '' || Number.isNaN(n) ? null : toPa(n, unit));
            }}
          />
          <select className="input !w-28" aria-label={`${label} unit`} value={unit} disabled={disabled} onChange={(e) => setUnit(e.target.value as PressureUnit)}>
            {Object.entries(PRESSURE_UNITS).map(([k, u]) => (
              <option key={k} value={k}>{u.label}</option>
            ))}
          </select>
        </div>
      )}
    </Field>
  );
}
