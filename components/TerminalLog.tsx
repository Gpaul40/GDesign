'use client';

import { useEffect, useRef } from 'react';

export type TerminalLine = {
  text: string;
  type: 'info' | 'success' | 'error' | 'dim';
};

type TerminalLogProps = {
  lines: TerminalLine[];
  isRunning: boolean;
};

const LINE_COLORS: Record<TerminalLine['type'], string> = {
  info: 'text-[#00ff88]',
  success: 'text-[#00d4ff]',
  error: 'text-[#ff4444]',
  dim: 'text-slate-500',
};

export default function TerminalLog({ lines, isRunning }: TerminalLogProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!scrollRef.current) return;
    scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [lines, isRunning]);

  return (
    <div className="overflow-hidden rounded-xl border border-slate-700">
      <div className="flex items-center gap-2 bg-slate-800 px-4 py-2 rounded-t-xl">
        <span className="h-3 w-3 rounded-full bg-red-500" />
        <span className="h-3 w-3 rounded-full bg-yellow-400" />
        <span className="h-3 w-3 rounded-full bg-green-500" />
        <span className="ml-2 text-xs text-slate-400">GDesign Renderer v1.0</span>
      </div>

      <div
        ref={scrollRef}
        className="min-h-[280px] max-h-[400px] overflow-y-auto bg-slate-950 p-4 font-mono text-xs rounded-b-xl"
      >
        <div className="flex flex-col gap-1.5">
          {lines.map((line, index) => {
            const match = line.text.match(/^(\[\d{2}:\d{2}\.\d\])\s>\s(.*)$/);
            const timestamp = match?.[1];
            const message = match?.[2] ?? line.text;

            return (
              <div
                key={`${index}-${line.text}`}
                className="animate-fade-in break-words whitespace-pre-wrap leading-5"
                style={{ animationDelay: `${Math.min(index * 45, 360)}ms` }}
              >
                {timestamp && <span className="text-slate-500">{timestamp} </span>}
                <span className="text-slate-500">&gt; </span>
                <span className={LINE_COLORS[line.type]}>{message}</span>
                {isRunning && index === lines.length - 1 && (
                  <span className="ml-1 animate-pulse text-[#00ff88]">█</span>
                )}
              </div>
            );
          })}

          {lines.length === 0 && (
            <div className="animate-fade-in text-slate-500">
              [00:00.0] &gt; Waiting for renderer...
              {isRunning && <span className="ml-1 animate-pulse text-[#00ff88]">█</span>}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
