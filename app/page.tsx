'use client';

import dynamic from 'next/dynamic';
import { useState, useEffect, useRef } from 'react';

const STLViewer = dynamic(() => import('../components/STLViewer'), { ssr: false });

type Step = 'idle' | 'rewriting' | 'review' | 'generating' | 'preview';

function useProgress(active: boolean, duration: number, endAt = 92) {
  const [progress, setProgress] = useState(0);
  const ref = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (active) {
      setProgress(0);
      const steps = 60;
      const interval = duration / steps;
      let current = 0;
      ref.current = setInterval(() => {
        current += endAt / steps;
        if (current >= endAt) {
          if (ref.current) clearInterval(ref.current);
          setProgress(endAt);
        } else {
          setProgress(Math.round(current));
        }
      }, interval);
    } else {
      if (ref.current) clearInterval(ref.current);
      setProgress(0);
    }
    return () => { if (ref.current) clearInterval(ref.current); };
  }, [active, duration, endAt]);

  return progress;
}

export default function Home() {
  const [prompt, setPrompt] = useState('');
  const [step, setStep] = useState<Step>('idle');
  const [description, setDescription] = useState('');
  const [scadCode, setScadCode] = useState('');
  const [stlUrl, setStlUrl] = useState('');
  const [scadUrl, setScadUrl] = useState('');
  const [error, setError] = useState('');
  const [showCode, setShowCode] = useState(false);
  const [done, setDone] = useState(false);

  const rewriteProgress = useProgress(step === 'rewriting', 15000, 92);
  const generateProgress = useProgress(step === 'generating', 45000, 92);

  const displayProgress = step === 'rewriting'
    ? (done ? 100 : rewriteProgress)
    : step === 'generating'
    ? (done ? 100 : generateProgress)
    : 0;

  const handleGenerate = async () => {
    if (!prompt.trim()) return;
    setError('');
    setDone(false);
    setStep('rewriting');
    setDescription('');
    setScadCode('');
    setStlUrl('');
    setScadUrl('');

    try {
      const res = await fetch('/api/rewrite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: prompt.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Rewrite failed');
      setDone(true);
      setTimeout(() => {
        setDescription(data.description);
        setScadCode(data.scadCode);
        setStep('review');
        setDone(false);
      }, 300);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
      setStep('idle');
      setDone(false);
    }
  };

  const handleApprove = async () => {
    setError('');
    setDone(false);
    setStep('generating');

    const safeName = prompt
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .slice(0, 40);

    try {
      const res = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scadCode, fileName: safeName }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Generation failed');
      setDone(true);
      setTimeout(() => {
        setStlUrl(data.stlUrl);
        setScadUrl(data.scadUrl);
        setStep('preview');
        setDone(false);
      }, 300);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
      setStep('review');
      setDone(false);
    }
  };

  const handleReset = () => {
    setStep('idle');
    setPrompt('');
    setDescription('');
    setScadCode('');
    setStlUrl('');
    setScadUrl('');
    setError('');
    setShowCode(false);
    setDone(false);
  };

  const isLoading = step === 'rewriting' || step === 'generating';

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100 flex flex-col items-center px-4 py-12">
      <header className="mb-10 text-center">
        <img src="/logo.png" alt="GDesign" className="mx-auto w-64 h-auto" />
        <p className="mt-1 text-slate-400 text-xs tracking-widest uppercase">Prompt CAD. Get Designs.</p>
      </header>

      <main className="w-full max-w-2xl flex flex-col gap-6">
        {/* Prompt input */}
        <section className="flex flex-col gap-3">
          <textarea
            className="w-full rounded-xl bg-slate-800 border border-slate-700 text-slate-100 placeholder-slate-500 p-4 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-sky-500 transition"
            rows={4}
            placeholder={`Describe what you want to 3D print\u2026 e.g. "make me a phone stand"`}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            disabled={isLoading}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleGenerate();
            }}
          />
          <div className="flex gap-3">
            <button
              onClick={handleGenerate}
              disabled={!prompt.trim() || isLoading}
              className="flex-1 rounded-xl bg-sky-600 hover:bg-sky-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-medium py-2.5 transition overflow-hidden relative"
            >
              {step === 'rewriting' ? (
                <ProgressButton label="Generating OpenSCAD…" progress={displayProgress} />
              ) : (
                'Generate'
              )}
            </button>
            {step !== 'idle' && (
              <button
                onClick={handleReset}
                disabled={isLoading}
                className="rounded-xl border border-slate-600 hover:border-slate-400 text-slate-400 hover:text-slate-200 text-sm px-4 transition disabled:opacity-40"
              >
                Reset
              </button>
            )}
          </div>
        </section>

        {/* Error */}
        {error && (
          <div className="rounded-xl bg-red-900/40 border border-red-700 text-red-300 text-sm p-4">
            {error}
          </div>
        )}

        {/* Review panel */}
        {(step === 'review' || step === 'generating' || step === 'preview') && (
          <section className="flex flex-col gap-4 rounded-xl bg-slate-800 border border-slate-700 p-5">
            <div>
              <h2 className="text-xs font-semibold uppercase tracking-widest text-slate-400 mb-1">
                Model Description
              </h2>
              <p className="text-slate-200 text-sm leading-relaxed">{description}</p>
            </div>

            <div>
              <button
                onClick={() => setShowCode((v) => !v)}
                className="text-xs text-sky-400 hover:text-sky-300 transition"
              >
                {showCode ? '▾ Hide OpenSCAD code' : '▸ Show OpenSCAD code'}
              </button>
              {showCode && (
                <pre className="mt-2 bg-slate-900 rounded-lg p-4 text-xs text-green-300 overflow-x-auto leading-relaxed">
                  {scadCode}
                </pre>
              )}
            </div>

            {step === 'review' && (
              <button
                onClick={handleApprove}
                className="self-start rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-medium px-6 py-2.5 transition"
              >
                Approve &amp; Generate STL
              </button>
            )}

            {step === 'generating' && (
              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between text-sm text-slate-400">
                  <span className="flex items-center gap-2"><Spinner /> Rendering STL and uploading…</span>
                  <span className="font-mono text-sky-400 font-semibold">{displayProgress}%</span>
                </div>
                <div className="w-full bg-slate-700 rounded-full h-1.5">
                  <div
                    className="bg-emerald-500 h-1.5 rounded-full transition-all duration-500"
                    style={{ width: `${displayProgress}%` }}
                  />
                </div>
              </div>
            )}
          </section>
        )}

        {/* 3D Preview */}
        {step === 'preview' && stlUrl && (
          <section className="flex flex-col gap-4">
            <div className="h-96 w-full">
              <STLViewer stlUrl={stlUrl} />
            </div>
            <div className="flex gap-3">
              <a
                href={stlUrl}
                download
                className="flex-1 text-center rounded-xl bg-sky-600 hover:bg-sky-500 text-white text-sm font-medium py-2.5 transition"
              >
                Download STL
              </a>
              {scadUrl && (
                <a
                  href={scadUrl}
                  download
                  className="rounded-xl border border-slate-600 hover:border-slate-400 text-slate-400 hover:text-slate-200 text-sm px-4 transition flex items-center"
                >
                  Download .scad
                </a>
              )}
            </div>
          </section>
        )}
      </main>
    </div>
  );
}

function ProgressButton({ label, progress }: { label: string; progress: number }) {
  return (
    <span className="flex items-center justify-center gap-2 relative z-10">
      <Spinner />
      <span>{label}</span>
      <span className="font-mono text-sky-200 font-semibold">{progress}%</span>
    </span>
  );
}

function Spinner() {
  return (
    <svg
      className="animate-spin h-4 w-4 text-current"
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
    >
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
      />
    </svg>
  );
}
