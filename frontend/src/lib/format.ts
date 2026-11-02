export function fmtMs(ms: number | null | undefined, digits = 1): string {
  if (ms === null || ms === undefined || Number.isNaN(ms)) return '–';
  if (ms < 1) return '0 ms';
  if (ms < 1000) return `${Math.round(ms)} ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(digits)} s`;
  const m = Math.floor(s / 60);
  return `${m}m ${Math.round(s - m * 60)}s`;
}

export function fmtNum(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(n)) return '–';
  if (!Number.isSafeInteger(n) && Math.abs(n) >= 1e15) return n.toExponential(3);
  return n.toLocaleString('en-US');
}

export function fmtPct(n: number): string {
  return `${n.toFixed(n >= 10 ? 0 : 1)}%`;
}

export function fmtClock(epochSec: number | null | undefined): string {
  if (!epochSec) return '–';
  return new Date(epochSec * 1000).toLocaleTimeString([], { hour12: false });
}

export function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

export const ALGO_LABEL: Record<string, string> = {
  reader_preference: 'Reader preference',
  writer_preference: 'Writer preference',
  fair_fifo: 'Fair FIFO',
};

export const ALGO_SHORT: Record<string, string> = {
  reader_preference: 'Readers first',
  writer_preference: 'Writers first',
  fair_fifo: 'First come, first served',
};

export function niceTicks(maxMs: number, target = 8): number[] {
  const raw = Math.max(maxMs, 1) / target;
  const pow = Math.pow(10, Math.floor(Math.log10(raw)));
  const n = raw / pow;
  const step = (n < 1.5 ? 1 : n < 3.5 ? 2 : n < 7.5 ? 5 : 10) * pow;
  const out: number[] = [];
  for (let t = 0; t <= maxMs + step; t += step) out.push(t);
  return out;
}

export function download(filename: string, content: string, mime: string): void {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
