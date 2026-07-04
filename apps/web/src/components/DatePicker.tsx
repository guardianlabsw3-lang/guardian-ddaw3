'use client';

import { useEffect, useMemo, useRef, useState } from 'react';

/**
 * Calendar date picker: the user chooses a day from a month grid instead of typing digits.
 * Value/onChange use the timezone-agnostic "YYYY-MM-DD" string the API expects for due dates
 * (same contract as a native `<input type="date">`), and an empty string means "no date".
 */
export function DatePicker({
  id,
  value,
  onChange,
  placeholder = 'Selecione uma data',
}: {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const selected = useMemo(() => parseIso(value), [value]);
  // Month shown in the grid; defaults to the selected date's month, else the current month.
  const [viewMonth, setViewMonth] = useState(() => startOfMonth(selected ?? new Date()));

  // Re-sync the visible month whenever the picker is opened, so it lands on the selection.
  useEffect(() => {
    if (open) setViewMonth(startOfMonth(selected ?? new Date()));
  }, [open, selected]);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: MouseEvent) {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const days = useMemo(() => buildCalendar(viewMonth), [viewMonth]);
  const today = toIso(new Date());

  function pick(day: Date) {
    onChange(toIso(day));
    setOpen(false);
  }

  return (
    <div className="datepicker" ref={containerRef}>
      <button
        id={id}
        type="button"
        className="datepicker-trigger"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        <span className={value ? undefined : 'datepicker-placeholder'}>
          {value ? formatHuman(selected) : placeholder}
        </span>
        <span aria-hidden="true" className="datepicker-icon">
          📅
        </span>
      </button>

      {open ? (
        <div className="datepicker-popup" role="dialog" aria-label="Calendário">
          <div className="datepicker-header">
            <button
              type="button"
              className="datepicker-nav"
              onClick={() => setViewMonth(addMonths(viewMonth, -1))}
              aria-label="Mês anterior"
            >
              ‹
            </button>
            <span className="datepicker-title">{formatMonthTitle(viewMonth)}</span>
            <button
              type="button"
              className="datepicker-nav"
              onClick={() => setViewMonth(addMonths(viewMonth, 1))}
              aria-label="Próximo mês"
            >
              ›
            </button>
          </div>

          <div className="datepicker-weekdays">
            {WEEKDAYS.map((weekday) => (
              <span key={weekday}>{weekday}</span>
            ))}
          </div>

          <div className="datepicker-grid">
            {days.map((day) => {
              const iso = toIso(day);
              const inMonth = day.getMonth() === viewMonth.getMonth();
              const classes = ['datepicker-day'];
              if (!inMonth) classes.push('datepicker-day-muted');
              if (iso === value) classes.push('datepicker-day-selected');
              else if (iso === today) classes.push('datepicker-day-today');
              return (
                <button
                  key={iso}
                  type="button"
                  className={classes.join(' ')}
                  onClick={() => pick(day)}
                  aria-pressed={iso === value}
                >
                  {day.getDate()}
                </button>
              );
            })}
          </div>

          <div className="datepicker-footer">
            <button type="button" className="datepicker-link" onClick={() => pick(new Date())}>
              Hoje
            </button>
            {value ? (
              <button
                type="button"
                className="datepicker-link"
                onClick={() => {
                  onChange('');
                  setOpen(false);
                }}
              >
                Limpar
              </button>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

const WEEKDAYS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
const MONTHS = [
  'Janeiro',
  'Fevereiro',
  'Março',
  'Abril',
  'Maio',
  'Junho',
  'Julho',
  'Agosto',
  'Setembro',
  'Outubro',
  'Novembro',
  'Dezembro',
];

/** "YYYY-MM-DD" → local Date at midnight, or null when empty/invalid (timezone-agnostic). */
function parseIso(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!match) return null;
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

/** Local Date → "YYYY-MM-DD" without the UTC shift `toISOString()` would introduce. */
function toIso(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function startOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function addMonths(date: Date, delta: number): Date {
  return new Date(date.getFullYear(), date.getMonth() + delta, 1);
}

/** 6 weeks (42 cells) covering the month, padded with leading/trailing days. */
function buildCalendar(month: Date): Date[] {
  const first = startOfMonth(month);
  const start = new Date(first);
  start.setDate(first.getDate() - first.getDay());
  return Array.from({ length: 42 }, (_, i) => {
    const day = new Date(start);
    day.setDate(start.getDate() + i);
    return day;
  });
}

function formatMonthTitle(date: Date): string {
  return `${MONTHS[date.getMonth()]} ${date.getFullYear()}`;
}

function formatHuman(date: Date | null): string {
  if (!date) return '';
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  return `${day}/${month}/${date.getFullYear()}`;
}
