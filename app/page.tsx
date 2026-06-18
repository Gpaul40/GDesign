'use client';

import dynamic from 'next/dynamic';
import { useState } from 'react';

const STLViewer = dynamic(() => import('../components/STLViewer'), { ssr: false });

type Step = 'idle' | 'rewriting' | 'review' | 'generating' | 'preview';

export default function Home() {
  const [prompt, setPrompt] = useState('');
  const [step, setStep] = useState<Step>('idle');
  const [description, setDescription] = useState('');
  const [scadCode, setScadCode] = useState('');
  const [stlUrl, setStlUrl] = useState('');
  const [scadUrl, setScadUrl] = useState('');
  const [error, setError] = useState('');
  const [showCode, setShowCode] = useState(false);

  const handleGenerate = async () => {
    if (!prompt.trim()) return;
    setError('');
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
      setDescription(data.description);
      setScadCode(data.scadCode);
      setStep('review');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
      setStep('idle');
    }
  };

  const handleApprove = async () => {
    setError('');
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
      setStlUrl(data.stlUrl);
      setScadUrl(data.scadUrl);
      setStep('preview');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
      setStep('review');
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
  };

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100 flex flex-col items-center px-4 py-12">
      <header className="mb-10 text-center">
        <h1 className="text-4xl font-bold tracking-tight text-white">GDesign</h1>
        <p className="mt-2 text-slate-400 text-sm">Turn plain English into 3D-printable models</p>
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
            disabled={step === 'rewriting' || step === 'generating'}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleGenerate();
            }}
          />
          <div className="flex gap-3">
            <button
              onClick={handleGenerate}
              disabled={!prompt.trim() || step === 'rewriting' || step === 'generating'}
              className="flex-1 rounded-xl bg-sky-600 hover:bg-sky-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-medium py-2.5 transition"
            >
              {step === 'rewriting' ? (
                <span className="flex items-center justify-center gap-2">
                  <Spinner /> Generating OpenSCAD…
                </span>
              ) : (
                'Generate'
              )}
            </button>
            {step !== 'idle' && (
              <button
                onClick={handleReset}
                className="rounded-xl border border-slate-600 hover:border-slate-400 text-slate-400 hover:text-slate-200 text-sm px-4 transition"
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
              <div className="flex items-center gap-2 text-slate-400 text-sm">
                <Spinner /> Rendering STL and uploading…
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

