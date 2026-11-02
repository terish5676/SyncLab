import type { ProcessState, ViewId } from '../types';

/* Shape language: circle = reader, square = writer, dashed ring = waiting. Icons share the same 1.7 round stroke. */
const p = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };

export const IconPlay = () => (<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4.5 2.6v10.8a.6.6 0 0 0 .92.5l8.2-5.4a.6.6 0 0 0 0-1L5.42 2.1a.6.6 0 0 0-.92.5Z" fill="currentColor" /></svg>);
export const IconPause = () => (<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="3.5" y="2.5" width="3" height="11" rx="1" fill="currentColor" /><rect x="9.5" y="2.5" width="3" height="11" rx="1" fill="currentColor" /></svg>);
export const IconStop = () => (<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="3" y="3" width="10" height="10" rx="2" fill="currentColor" /></svg>);
export const IconReset = () => (<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2.8 8a5.2 5.2 0 1 0 1.7-3.85M2.8 2.4v2.9h2.9" {...p} strokeWidth={1.6} /></svg>);
export const IconDown = () => (<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 2.5v7.5M4.8 7.2 8 10.4l3.2-3.2M3 13.2h10" {...p} strokeWidth={1.6} /></svg>);
export const IconWarn = () => (<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.6 21.4 20H2.6L12 3.6Z" {...p} /><path d="M12 10v4.4M12 17.2v.1" {...p} strokeWidth={2} /></svg>);
export const IconCheck = () => (<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12.8 4.3 4.3L19 7.4" {...p} strokeWidth={2.6} /></svg>);
export const IconCross = () => (<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" {...p} strokeWidth={2.6} /></svg>);
export const IconDots = () => (<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 12h.01M12 12h.01M18 12h.01" {...p} strokeWidth={3.2} /></svg>);
export const IconSun = () => (<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4" {...p} /><path d="M12 2.8v2M12 19.2v2M2.8 12h2M19.2 12h2M5.5 5.5l1.4 1.4M17.1 17.1l1.4 1.4M5.5 18.5l1.4-1.4M17.1 6.9l1.4-1.4" {...p} /></svg>);
export const IconMoon = () => (<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 14.2A8.2 8.2 0 0 1 9.8 4a8.2 8.2 0 1 0 10.2 10.2Z" {...p} /></svg>);

/** The brand mark: a reader (circle) held inside a writer (square). */
export const BrandMark = () => (
  <svg viewBox="0 0 40 40" aria-hidden="true">
    <rect x="4.5" y="4.5" width="31" height="31" rx="7" fill="none" stroke="#e6f2ee" strokeWidth="1.6" />
    <circle cx="16" cy="20" r="7.5" fill="#0fb883" />
    <circle cx="25" cy="20" r="7.5" fill="none" stroke="#c6a25a" strokeWidth="1.6" strokeDasharray="2.6 2.4" />
  </svg>
);

/** A quiet mark for empty states, built from the same three shapes. */
export const EmptyMark = () => (
  <svg viewBox="0 0 48 48" aria-hidden="true">
    <rect x="6" y="6" width="36" height="36" rx="9" fill="none" stroke="currentColor" strokeWidth="1.4" />
    <circle cx="20" cy="24" r="8" fill="none" stroke="currentColor" strokeWidth="1.4" />
    <circle cx="28" cy="24" r="8" fill="none" stroke="currentColor" strokeWidth="1.4" strokeDasharray="2.4 2.8" />
  </svg>
);

export function NavIcon({ id }: { id: ViewId }) {
  switch (id) {
    case 'lab':
      return (<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="3.5" width="17" height="17" rx="4.5" {...p} /><circle cx="12" cy="12" r="3.6" {...p} /></svg>);
    case 'trace':
      return (<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6.5h8M8 12h12M4 17.5h6M14 17.5h6" {...p} strokeWidth={2} /></svg>);
    case 'versus':
      return (<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 19.5V11M12 19.5V4.5M18 19.5v-6M3.5 19.5h17" {...p} /></svg>);
    case 'report':
      return (<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6.5 3.5h8l4 4v13h-12z" {...p} /><path d="M14 3.7V8h4.3M9.5 12.5h5M9.5 16h5" {...p} /></svg>);
    case 'learn':
      return (<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3.5 6.5C6 5 9 5 12 6.8c3-1.8 6-1.8 8.5-.3v11.3c-2.5-1.5-5.5-1.5-8.5.3-3-1.8-6-1.8-8.5-.3z" {...p} /><path d="M12 6.8v11.3" {...p} /></svg>);
  }
}

/** Shape + word carry state, never colour alone. */
export function StateGlyph({ state }: { state: ProcessState }) {
  const c = { className: 'glyph', viewBox: '0 0 14 14', 'aria-hidden': true } as const;
  switch (state) {
    case 'WAITING':
      return (<svg {...c}><circle cx="7" cy="7" r="5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeDasharray="2.6 2.2" /></svg>);
    case 'READING':
      return (<svg {...c}><circle cx="7" cy="7" r="5.2" fill="currentColor" /></svg>);
    case 'WRITING':
      return (<svg {...c}><rect x="2" y="2" width="10" height="10" rx="1.6" fill="currentColor" /></svg>);
    case 'COMPLETED':
      return (<svg {...c}><path d="m2.6 7.4 3 3L11.4 4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>);
    case 'CANCELLED':
      return (<svg {...c}><path d="m3.4 3.4 7.2 7.2M10.6 3.4l-7.2 7.2" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" /></svg>);
    case 'ERROR':
      return (<svg {...c}><path d="M7 1.8 12.6 12H1.4z" fill="currentColor" strokeLinejoin="round" stroke="currentColor" strokeWidth="1" /></svg>);
    default:
      return (<svg {...c}><circle cx="7" cy="7" r="4.2" fill="none" stroke="currentColor" strokeWidth="1.3" /></svg>);
  }
}

export const STATE_WORD: Record<ProcessState, string> = {
  CREATED: 'Idle',
  WAITING: 'Waiting',
  READING: 'Reading',
  WRITING: 'Writing',
  COMPLETED: 'Done',
  CANCELLED: 'Cancelled',
  ERROR: 'Error',
};
