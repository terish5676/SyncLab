import { useEffect, useMemo, useRef, useState } from 'react';
import { useActions, useLiveNow, useSync } from '../store';
import { buildLanes, writerBands } from '../lib/lanes';
import { fmtMs, niceTicks } from '../lib/format';
import { EmptyMark } from './Icons';

const GUTTER = 50;
const HEAD = 30;

function useWidth<T extends HTMLElement>(): [React.RefObject<T | null>, number] {
  const ref = useRef<T | null>(null);
  const [w, setW] = useState(900);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setW(el.clientWidth));
    ro.observe(el);
    setW(el.clientWidth);
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

export function Lanes() {
  const { events, sim, focusId } = useSync();
  const { focus } = useActions();
  const now = useLiveNow(120);
  const [ref, width] = useWidth<HTMLDivElement>();
  const [zoom, setZoom] = useState(1);
  const [tip, setTip] = useState<{ x: number; y: number; text: string } | null>(null);

  const lanes = useMemo(() => buildLanes(events, now), [events, now]);
  const bands = useMemo(() => writerBands(lanes), [lanes]);
  const rowH = lanes.length > 60 ? 12 : lanes.length > 28 ? 17 : 24;
  const maxT = Math.max(1000, now, ...lanes.flatMap((l) => l.segments.map((s) => s.end)));
  const inner = Math.max(300, (width - GUTTER - 18) * zoom);
  const x = (t: number) => GUTTER + (t / maxT) * inner;
  const height = HEAD + lanes.length * rowH + 10;
  const ticks = niceTicks(maxT, Math.max(4, Math.round(inner / 90)));
  const running = sim?.status === 'RUNNING';
  const dense = rowH < 16;

  if (lanes.length === 0) {
    return (
      <div className="empty">
        <EmptyMark />
        <h3>The lanes fill in as threads move</h3>
        <p>Each row is one reader or writer. Brass hatching means waiting, green means reading, dark teal means writing alone.</p>
      </div>
    );
  }

  const show = (e: React.MouseEvent, text: string) => setTip({ x: e.clientX + 14, y: e.clientY + 14, text });

  return (
    <div>
      <div className="log-tools">
        <div className="legend" aria-label="Legend">
          <span><i style={{ backgroundImage: 'var(--hatch)', backgroundColor: 'color-mix(in srgb, var(--wait) 16%, transparent)', boxShadow: 'inset 0 0 0 1px var(--wait)' }} />Waiting</span>
          <span><i style={{ background: 'var(--read)' }} />Reading (shared)</span>
          <span><i style={{ background: 'var(--write)' }} />Writing (exclusive)</span>
          <span><i style={{ background: 'color-mix(in srgb, var(--write) 14%, transparent)', boxShadow: 'inset 0 0 0 1px var(--line-strong)' }} />Write window</span>
        </div>
        <div className="chips" role="group" aria-label="Zoom">
          {[1, 2, 4, 8].map((z) => (
            <button key={z} className="chip" aria-pressed={zoom === z} onClick={() => setZoom(z)}>{z}×</button>
          ))}
        </div>
      </div>
      <div className="lanes-wrap" ref={ref}>
        <svg className="lanes-svg" width={GUTTER + inner + 18} height={height} role="img" aria-label={`Swim lanes for ${lanes.length} processes`}>
          <defs>
            <pattern id="hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
              <rect width="6" height="6" style={{ fill: 'var(--wait)' }} opacity="0.16" />
              <rect width="1.6" height="6" style={{ fill: 'var(--wait)' }} opacity="0.9" />
            </pattern>
          </defs>
          <g style={{ position: 'sticky' }}>
            <rect x="0" y="0" width={GUTTER + inner + 18} height={HEAD} style={{ fill: 'var(--panel)' }} />
            <line x1="0" x2={GUTTER + inner + 18} y1={HEAD} y2={HEAD} style={{ stroke: 'var(--line-strong)' }} strokeWidth="1" />
          </g>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={x(t)} x2={x(t)} y1={HEAD - 6} y2={height} style={{ stroke: 'var(--line)' }} />
              <text x={x(t) + 3} y={HEAD - 11}>{t >= 1000 ? `${+(t / 1000).toFixed(2)}s` : `${t}ms`}</text>
            </g>
          ))}
          {bands.map((b, i) => (
            <rect key={i} x={x(b.start)} y={HEAD} width={Math.max(1, x(b.end) - x(b.start))} height={height - HEAD} style={{ fill: 'var(--write)' }} opacity={0.1} />
          ))}
          {lanes.map((l, i) => {
            const y = HEAD + i * rowH;
            const dim = focusId && focusId !== l.id ? 0.28 : 1;
            return (
              <g key={l.id} opacity={dim}>
                {i % 2 === 1 && <rect x="0" y={y} width={GUTTER + inner + 18} height={rowH} style={{ fill: 'var(--ink)' }} opacity={0.035} />}
                <text x="6" y={y + rowH / 2 + 4} fontWeight={700} style={{ cursor: 'pointer' }} onClick={() => focus(focusId === l.id ? null : l.id)}>{dense ? l.id.replace(/^([RW])0?/, '$1') : l.id}</text>
                {l.segments.map((s, j) => {
                  const fill = s.kind === 'wait' ? 'url(#hatch)' : s.kind === 'read' ? 'var(--read)' : 'var(--write)';
                  const edge = s.kind === 'wait' ? 'var(--wait)' : 'none';
                  const w = Math.max(2, x(s.end) - x(s.start));
                  const label = `${l.id} ${s.kind === 'wait' ? 'waited' : s.kind === 'read' ? 'read' : 'wrote'} ${fmtMs(s.end - s.start)}${s.open ? ' (so far)' : ''}${s.cancelled ? ' · cancelled' : ''}`;
                  return (
                    <rect
                      key={j} x={x(s.start)} y={y + 2} width={w} height={rowH - 4} rx={dense ? 1 : 3} style={{ fill, stroke: edge }} strokeWidth={1}
                      strokeDasharray={s.cancelled ? '3 2' : undefined}
                      onMouseMove={(e) => show(e, label)} onMouseLeave={() => setTip(null)} onClick={() => focus(focusId === l.id ? null : l.id)}
                    >
                      <title>{label}</title>
                    </rect>
                  );
                })}
                {l.cancelledAt !== undefined && <text x={x(l.cancelledAt) + 3} y={y + rowH / 2 + 4} fontWeight={800}>×</text>}
              </g>
            );
          })}
          {running && <line x1={x(now)} x2={x(now)} y1={HEAD} y2={height} style={{ stroke: 'var(--focus)' }} strokeWidth="1.5" strokeDasharray="4 3" />}
        </svg>
      </div>
      {tip && <div className="tip" style={{ left: tip.x, top: tip.y }}>{tip.text}</div>}
    </div>
  );
}
