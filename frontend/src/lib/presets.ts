import type { SimConfig } from '../types';

export const DEFAULT_CONFIG: SimConfig = {
  algorithm: 'reader_preference',
  reader_count: 6,
  writer_count: 2,
  read_duration_ms: 1200,
  write_duration_ms: 1800,
  initial_value: 100,
  writer_op: 'ADD',
  writer_amount: 10,
  max_duration_sec: 60,
  stagger_arrivals_ms: 200,
};

export interface Preset {
  id: string;
  name: string;
  blurb: string;
  config: SimConfig;
}

export const PRESETS: Preset[] = [
  {
    id: 'starve',
    name: 'Starve the writer',
    blurb: 'Readers keep arriving before the last one leaves. Watch the writers wait.',
    config: { ...DEFAULT_CONFIG, algorithm: 'reader_preference', reader_count: 40, writer_count: 2, read_duration_ms: 1200, write_duration_ms: 800, stagger_arrivals_ms: 100 },
  },
  {
    id: 'fair',
    name: 'Same load, fair queue',
    blurb: 'The starvation workload again, admitted strictly in request order.',
    config: { ...DEFAULT_CONFIG, algorithm: 'fair_fifo', reader_count: 40, writer_count: 2, read_duration_ms: 1200, write_duration_ms: 800, stagger_arrivals_ms: 100 },
  },
  {
    id: 'writers-first',
    name: 'Writers cut the line',
    blurb: 'A waiting writer closes the gate on new readers.',
    config: { ...DEFAULT_CONFIG, algorithm: 'writer_preference', reader_count: 16, writer_count: 5, read_duration_ms: 1000, write_duration_ms: 900, stagger_arrivals_ms: 120 },
  },
  {
    id: 'integrity',
    name: 'Ten writes, no lost updates',
    blurb: '100 + 10 × 5 must equal 150, with version 10.',
    config: { ...DEFAULT_CONFIG, algorithm: 'fair_fifo', reader_count: 4, writer_count: 10, read_duration_ms: 400, write_duration_ms: 400, initial_value: 100, writer_op: 'ADD', writer_amount: 5, stagger_arrivals_ms: 60 },
  },
  {
    id: 'stress',
    name: 'Stress: 100 × 50',
    blurb: 'The maximum thread pool. Safety checks run the whole way.',
    config: { ...DEFAULT_CONFIG, algorithm: 'writer_preference', reader_count: 100, writer_count: 50, read_duration_ms: 300, write_duration_ms: 300, stagger_arrivals_ms: 15, max_duration_sec: 120 },
  },
];

export const LIMITS = {
  reader_count: [1, 100],
  writer_count: [1, 50],
  read_duration_ms: [100, 10000],
  write_duration_ms: [100, 10000],
  initial_value: [-10000, 10000],
  writer_amount: [1, 1000],
  max_duration_sec: [5, 300],
  stagger_arrivals_ms: [0, 2000],
} as const;

export function configErrors(c: SimConfig): Partial<Record<keyof typeof LIMITS, string>> {
  const errs: Partial<Record<keyof typeof LIMITS, string>> = {};
  (Object.keys(LIMITS) as (keyof typeof LIMITS)[]).forEach((k) => {
    const [lo, hi] = LIMITS[k];
    const v = c[k];
    if (!Number.isInteger(v) || v < lo || v > hi) errs[k] = `${lo} to ${hi}`;
  });
  return errs;
}
