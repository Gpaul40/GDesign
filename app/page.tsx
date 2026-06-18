'use client';

import dynamic from 'next/dynamic';
import { useEffect, useRef, useState } from 'react';
import TerminalLog, { type TerminalLine } from '../components/TerminalLog';
import { applyScadParams, parseScadParams, type ScadParam } from '../lib/scadParams';

const STLViewer = dynamic(() => import('../components/STLViewer'), { ssr: false });
const RENDER_DURATION = 45000;
const SIZE_PRESETS = [
  { id: 'small', label: 'Small 0.75x', scale: 0.75 },
  { id: 'medium', label: 'Medium 1x', scale: 1 },
  { id: 'large', label: 'Large 1.5x', scale: 1.5 },
  { id: 'xl', label: 'XL 2x', scale: 2 },
] as const;
const RENDER_FLAVOR_LINES = [
  'Processing vertex data...',
  'Optimizing mesh topology...',
  'Computing boolean operations...',
  'Applying geometric transforms...',
  'Validating manifold geometry...',
  'Calculating bounding volumes...',
] as const;

type Step = 'idle' | 'rewriting' | 'review' | 'generating' | 'preview';
type PromptCategory = 'character' | 'mechanical' | 'object';
type GenerationStrategy = 'web_research' | 'mechanical_precision';
type GenerationStreamEvent = {
  error?: string;
  progress?: number;
  status?: string;
  stlUrl?: string;
  scadUrl?: string;
  stlBytes?: number;
  triangleCount?: number;
};
type GenerationStreamResult = {
  stlUrl: string;
  scadUrl: string;
  stlBytes: number;
  triangleCount: number;
};

function useProgress(active: boolean, duration: number, endAt = 92) {
  const [progress, setProgress] = useState(0);
  const ref = useRef<ReturnType<typeof setInterval> | null>(null);
  const resetRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (ref.current) clearInterval(ref.current);
    if (resetRef.current) clearTimeout(resetRef.current);

    if (active) {
      resetRef.current = setTimeout(() => setProgress(0), 0);
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
      resetRef.current = setTimeout(() => setProgress(0), 0);
    }
    return () => {
      if (ref.current) clearInterval(ref.current);
      if (resetRef.current) clearTimeout(resetRef.current);
    };
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
  const [baseParams, setBaseParams] = useState<ScadParam[]>([]);
  const [customParams, setCustomParams] = useState<ScadParam[]>([]);
  const [activePreset, setActivePreset] = useState<string>('medium');
  const [isRerendering, setIsRerendering] = useState(false);
  const [strategy, setStrategy] = useState<GenerationStrategy | ''>('');
  const [category, setCategory] = useState<PromptCategory | ''>('');
  const [terminalLines, setTerminalLines] = useState<TerminalLine[]>([]);
  const [processStart, setProcessStart] = useState(0);
  const [showBuildLog, setShowBuildLog] = useState(true);

  const processStartRef = useRef(0);
  const reviewPausedAtRef = useRef(0);
  const renderFlavorIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const renderFlavorIndexRef = useRef(0);

  const rerenderProgress = useProgress(isRerendering, RENDER_DURATION, 92);

  const safeName = formatFileName(prompt);
  const isTerminalRunning = step === 'rewriting' || step === 'generating' || isRerendering;
  const isLoading = isTerminalRunning;

  const stopRenderFlavorLines = () => {
    if (renderFlavorIntervalRef.current) {
      clearInterval(renderFlavorIntervalRef.current);
      renderFlavorIntervalRef.current = null;
    }
  };

  const addLine = (text: string, type: TerminalLine['type'] = 'info') => {
    const start = processStartRef.current || processStart || Date.now();
    const timestamp = formatElapsedTimestamp((Date.now() - start) / 1000);
    setTerminalLines((current) => [...current, { text: `${timestamp} > ${text}`, type }]);
  };

  const startTerminalSession = () => {
    stopRenderFlavorLines();
    reviewPausedAtRef.current = 0;
    renderFlavorIndexRef.current = 0;
    const startedAt = Date.now();
    processStartRef.current = startedAt;
    setProcessStart(startedAt);
    setTerminalLines([]);
    setShowBuildLog(true);
  };

  const pauseTimerForReview = () => {
    reviewPausedAtRef.current = Date.now();
  };

  const resumeTimerFromReview = () => {
    if (!reviewPausedAtRef.current) return;
    const nextStart = processStartRef.current + (Date.now() - reviewPausedAtRef.current);
    processStartRef.current = nextStart;
    setProcessStart(nextStart);
    reviewPausedAtRef.current = 0;
  };

  const startRenderFlavorLines = () => {
    stopRenderFlavorLines();
    renderFlavorIndexRef.current = 0;
    renderFlavorIntervalRef.current = setInterval(() => {
      const message = RENDER_FLAVOR_LINES[renderFlavorIndexRef.current % RENDER_FLAVOR_LINES.length];
      renderFlavorIndexRef.current += 1;
      addLine(message, 'dim');
    }, 2000);
  };

  const appendGenerationStatus = (
    status: string,
    metadata?: Pick<GenerationStreamEvent, 'stlBytes' | 'triangleCount'>
  ) => {
    switch (status) {
      case '🔍 Parsing OpenSCAD code...':
        addLine('Parsing OpenSCAD input...');
        break;
      case '⚙️ Initializing WebAssembly renderer...':
        addLine('Loading WebAssembly renderer...');
        break;
      case '🏗️ Compiling model geometry...':
        stopRenderFlavorLines();
        addLine('Renderer initialized ✓', 'success');
        addLine('Writing input.scad to virtual filesystem...');
        addLine('Compiling geometry (pass 1/3)...');
        break;
      case '🔄 Rendering mesh (this may take a moment)...':
        addLine('Compiling geometry (pass 2/3)...');
        startRenderFlavorLines();
        break;
      case '✅ Render complete! Processing output...':
        stopRenderFlavorLines();
        addLine('Compiling geometry (pass 3/3)...');
        addLine(
          `Mesh generated — ${(metadata?.triangleCount ?? estimateTriangleCount(metadata?.stlBytes ?? 0)).toLocaleString()} triangles ✓`,
          'success'
        );
        addLine('Calculating surface normals...');
        addLine('Writing output.stl...');
        if (metadata?.stlBytes) {
          addLine(`STL size: ${formatBytes(metadata.stlBytes)} ✓`, 'success');
        }
        break;
      case '☁️ Uploading .scad file...':
        stopRenderFlavorLines();
        addLine('Uploading .scad to Supabase storage...');
        break;
      case '☁️ Uploading .stl file...':
        addLine('Uploading .stl to Supabase storage...');
        break;
      case '🎉 Done! Loading preview...':
        stopRenderFlavorLines();
        addLine(`Build complete in ${getElapsedSeconds(processStartRef.current).toFixed(1)}s ✓`, 'success');
        addLine('Loading 3D preview...');
        break;
      default:
        stopRenderFlavorLines();
        addLine(status);
    }
  };

  useEffect(() => () => stopRenderFlavorLines(), []);

  const streamGeneration = async (nextScadCode: string, nextFileName: string) => {
    const res = await fetch('/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scadCode: nextScadCode, fileName: nextFileName }),
    });

    if (!res.ok) {
      const data = await res.json().catch(() => null);
      throw new Error(data?.error || 'Generation failed');
    }

    if (!res.body) {
      throw new Error('Streaming response unavailable');
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    const result: Partial<GenerationStreamResult> = {};

    const processChunk = (chunk: string) => {
      for (const line of chunk.split('\n').filter((entry) => entry.startsWith('data: '))) {
        const data = JSON.parse(line.slice(6)) as GenerationStreamEvent;

        if (data.error) {
          addLine(data.error, 'error');
          throw new Error(data.error);
        }
        if (data.status) {
          appendGenerationStatus(data.status, {
            stlBytes: data.stlBytes,
            triangleCount: data.triangleCount,
          });
        }
        if (data.stlBytes !== undefined) result.stlBytes = data.stlBytes;
        if (data.triangleCount !== undefined) result.triangleCount = data.triangleCount;
        if (data.stlUrl) {
          result.stlUrl = data.stlUrl;
          result.scadUrl = data.scadUrl;
        }
      }
    };

    while (true) {
      const { done: streamDone, value } = await reader.read();
      if (streamDone) break;

      buffer += decoder.decode(value, { stream: true });
      const events = buffer.split('\n\n');
      buffer = events.pop() ?? '';

      for (const event of events) {
        processChunk(event);
      }
    }

    if (buffer.trim()) {
      processChunk(buffer);
    }

    if (!result.stlUrl || !result.scadUrl) {
      throw new Error('Generation completed without output URLs');
    }

    return {
      stlUrl: result.stlUrl,
      scadUrl: result.scadUrl,
      stlBytes: result.stlBytes ?? 0,
      triangleCount: result.triangleCount ?? estimateTriangleCount(result.stlBytes ?? 0),
    } satisfies GenerationStreamResult;
  };

  const handleGenerate = async () => {
    if (!prompt.trim()) return;

    startTerminalSession();
    setError('');
    setStep('rewriting');
    setDescription('');
    setScadCode('');
    setStlUrl('');
    setScadUrl('');
    setBaseParams([]);
    setCustomParams([]);
    setActivePreset('medium');
    setIsRerendering(false);
    setStrategy('');
    setCategory('');

    addLine('Initializing GDesign renderer...');
    addLine('Classifying prompt type...');

    try {
      const res = await fetch('/api/rewrite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: prompt.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Rewrite failed');

      const parsedParams = parseScadParams(data.scadCode);
      addLine(`Detected category: ${String(data.category).toUpperCase()} ✓`, 'success');

      if (data.strategy === 'web_research') {
        addLine('Fetching web research references...');
        addLine(`Research complete — ${data.researchSourceCount ?? 0} sources found ✓`, 'success');
      } else {
        addLine('Applying mechanical precision heuristics...');
        addLine('Mechanical rule set engaged ✓', 'success');
      }

      addLine('Constructing OpenSCAD prompt...');
      addLine('Generating parametric SCAD code...');
      addLine(`Code generation complete — ${data.scadCode.split('\n').length} lines ✓`, 'success');

      setDescription(data.description);
      setScadCode(data.scadCode);
      setBaseParams(parsedParams);
      setCustomParams(parsedParams);
      setActivePreset('medium');
      setStrategy(data.strategy);
      setCategory(data.category);
      setStep('review');
      pauseTimerForReview();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Something went wrong';
      addLine(message, 'error');
      setError(message);
      setStep('idle');
    }
  };

  const handleApprove = async () => {
    resumeTimerFromReview();
    setError('');
    setStep('generating');
    setShowBuildLog(true);

    try {
      const data = await streamGeneration(scadCode, safeName);
      setStlUrl(data.stlUrl);
      setScadUrl(data.scadUrl);
      setStep('preview');
      setShowBuildLog(false);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Something went wrong';
      addLine(message, 'error');
      setError(message);
      setStep('review');
      pauseTimerForReview();
    }
  };

  const handlePresetSelect = (presetId: string, scale: number) => {
    setActivePreset(presetId);
    setCustomParams(
      baseParams.map((param) => ({
        ...param,
        value: roundToStep(param.value * scale, getParamStep(param.value)),
      }))
    );
  };

  const handleParamChange = (name: string, value: number) => {
    setActivePreset('');
    setCustomParams((current) =>
      current.map((param) => (param.name === name ? { ...param, value } : param))
    );
  };

  const handleRerender = async () => {
    if (!customParams.length) return;

    const nextScadCode = applyScadParams(
      scadCode,
      customParams.map(({ name, value }) => ({ name, value }))
    );

    startTerminalSession();
    setError('');
    setIsRerendering(true);
    addLine('Applying custom parameter overrides...');
    addLine('Generating parametric SCAD code...');
    addLine(`Code generation complete — ${nextScadCode.split('\n').length} lines ✓`, 'success');

    try {
      const data = await streamGeneration(nextScadCode, `${safeName}_${Date.now()}`);
      setScadCode(nextScadCode);
      setStlUrl(data.stlUrl);
      setScadUrl(data.scadUrl);
      setShowBuildLog(false);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Something went wrong';
      addLine(message, 'error');
      setError(message);
    } finally {
      stopRenderFlavorLines();
      setIsRerendering(false);
    }
  };

  const handleReset = () => {
    stopRenderFlavorLines();
    processStartRef.current = 0;
    reviewPausedAtRef.current = 0;
    renderFlavorIndexRef.current = 0;
    setStep('idle');
    setPrompt('');
    setDescription('');
    setScadCode('');
    setStlUrl('');
    setScadUrl('');
    setError('');
    setShowCode(false);
    setBaseParams([]);
    setCustomParams([]);
    setActivePreset('medium');
    setIsRerendering(false);
    setStrategy('');
    setCategory('');
    setTerminalLines([]);
    setProcessStart(0);
    setShowBuildLog(true);
  };

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100 flex flex-col items-center px-4 py-12">
      <header className="mb-10 text-center">
        <img src="/logo.png" alt="GDesign" className="mx-auto w-64 h-auto" />
        <p className="mt-1 text-slate-400 text-xs tracking-widest uppercase">Prompt CAD. Get Designs.</p>
      </header>

      <main className="w-full max-w-2xl flex flex-col gap-6">
        <section className="flex flex-col gap-3">
          <textarea
            className="w-full rounded-xl bg-slate-800 border border-slate-700 text-slate-100 placeholder-slate-500 p-4 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-sky-500 transition"
            rows={4}
            placeholder={`Describe what you want to 3D print… e.g. "make me a phone stand"`}
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
                <span className="relative z-10 flex items-center justify-center gap-2">
                  <Spinner />
                  <span>Preparing model…</span>
                </span>
              ) : step === 'generating' ? (
                <span className="relative z-10 flex items-center justify-center gap-2">
                  <Spinner />
                  <span>Building STL…</span>
                </span>
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

        {error && (
          <div className="rounded-xl bg-red-900/40 border border-red-700 text-red-300 text-sm p-4">
            {error}
          </div>
        )}

        {(terminalLines.length > 0 || isTerminalRunning) && (
          <section className="flex flex-col gap-3">
            {step === 'preview' ? (
              <div className="flex items-center justify-between rounded-xl border border-slate-700 bg-slate-800/70 px-4 py-3">
                <div>
                  <h2 className="text-sm font-semibold text-slate-100">Build Log</h2>
                  <p className="text-xs text-slate-400">Live renderer output captured from the latest run.</p>
                </div>
                <button
                  onClick={() => setShowBuildLog((current) => !current)}
                  className="text-xs font-medium text-sky-400 hover:text-sky-300 transition"
                >
                  {showBuildLog ? 'Hide build log' : 'Show build log'}
                </button>
              </div>
            ) : (
              <div className="flex items-center justify-between px-1">
                <div>
                  <h2 className="text-sm font-semibold text-slate-100">Build Log</h2>
                  <p className="text-xs text-slate-400">Streaming diagnostic output from the renderer pipeline.</p>
                </div>
                <span className="text-xs font-mono text-slate-500">{terminalLines.length} lines</span>
              </div>
            )}

            {(showBuildLog || step !== 'preview' || isTerminalRunning) && (
              <TerminalLog lines={terminalLines} isRunning={isTerminalRunning} />
            )}
          </section>
        )}

        {(step === 'review' || step === 'generating' || step === 'preview') && (
          <section className="flex flex-col gap-4 rounded-xl bg-slate-800 border border-slate-700 p-5">
            <div>
              <div className="mb-1 flex items-center gap-2">
                <h2 className="text-xs font-semibold uppercase tracking-widest text-slate-400">
                  Model Description
                </h2>
                {strategy && (
                  <span className="rounded-full border border-slate-600 bg-slate-900/80 px-2.5 py-1 text-[10px] font-medium uppercase tracking-wide text-slate-200">
                    {getStrategyBadgeLabel(strategy, category)}
                  </span>
                )}
              </div>
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
          </section>
        )}

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

        {step === 'preview' && (
          <section className="flex flex-col gap-5 rounded-xl bg-slate-800 border border-slate-700 p-5">
            <div className="flex items-center gap-3">
              <div className="rounded-lg bg-slate-900/80 border border-slate-700 p-2 text-sky-400">
                <SlidersIcon />
              </div>
              <div>
                <h2 className="text-sm font-semibold text-slate-100">Customize Model</h2>
                <p className="text-xs text-slate-400">Tune the detected OpenSCAD parameters and render a new STL.</p>
              </div>
            </div>

            {customParams.length > 0 ? (
              <>
                <div className="flex flex-wrap gap-2">
                  {SIZE_PRESETS.map((preset) => (
                    <button
                      key={preset.id}
                      onClick={() => handlePresetSelect(preset.id, preset.scale)}
                      disabled={isRerendering}
                      className={`rounded-lg border px-3 py-2 text-sm transition ${
                        activePreset === preset.id
                          ? 'border-sky-500 bg-sky-500/15 text-sky-300'
                          : 'border-slate-600 bg-slate-900/60 text-slate-300 hover:border-slate-500 hover:text-slate-100'
                      } disabled:opacity-50 disabled:cursor-not-allowed`}
                    >
                      {preset.label}
                    </button>
                  ))}
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                  {customParams.map((param) => {
                    const baseValue = baseParams.find((baseParam) => baseParam.name === param.name)?.value ?? param.value;
                    const stepSize = getParamStep(baseValue);
                    const magnitude = Math.max(Math.abs(baseValue), 1);
                    const minValue = Math.max(0, roundToStep(magnitude * 0.25, stepSize));
                    const maxValue = Math.max(minValue + stepSize, roundToStep(magnitude * 4, stepSize));

                    return (
                      <div key={param.name} className="rounded-xl bg-slate-900/70 border border-slate-700 p-4">
                        <div className="mb-3">
                          <div className="flex items-center justify-between gap-3">
                            <label className="text-sm font-medium text-slate-200">{formatParamName(param.name)}</label>
                            <span className="text-xs font-mono text-sky-300">{formatParamValue(param.value)}</span>
                          </div>
                          {param.comment && (
                            <p className="mt-1 text-xs text-slate-500">{param.comment}</p>
                          )}
                        </div>

                        <div className="flex items-center gap-3">
                          <input
                            type="range"
                            min={minValue}
                            max={maxValue}
                            step={stepSize}
                            value={param.value}
                            onChange={(e) => handleParamChange(param.name, Number(e.target.value))}
                            disabled={isRerendering}
                            className="h-2 flex-1 cursor-pointer appearance-none rounded-lg bg-slate-700 accent-sky-500 disabled:cursor-not-allowed"
                          />
                          <input
                            type="number"
                            min={minValue}
                            max={maxValue}
                            step={stepSize}
                            value={param.value}
                            onChange={(e) => {
                              const nextValue = Number(e.target.value);
                              if (Number.isFinite(nextValue)) {
                                handleParamChange(param.name, nextValue);
                              }
                            }}
                            disabled={isRerendering}
                            className="w-24 rounded-lg border border-slate-600 bg-slate-800 px-3 py-2 text-sm text-slate-100 focus:outline-none focus:ring-2 focus:ring-sky-500 disabled:cursor-not-allowed disabled:opacity-60"
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>

                <div className="flex flex-col gap-2">
                  <button
                    onClick={handleRerender}
                    disabled={isRerendering}
                    className="self-start rounded-xl bg-sky-600 hover:bg-sky-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-medium px-6 py-2.5 transition overflow-hidden relative"
                  >
                    {isRerendering ? (
                      <ProgressButton label="Re-rendering…" progress={rerenderProgress} />
                    ) : (
                      'Re-render'
                    )}
                  </button>
                  {isRerendering && (
                    <p className="text-xs text-slate-400">Rendering updated geometry and refreshing the preview…</p>
                  )}
                </div>
              </>
            ) : (
              <div className="rounded-xl border border-slate-700 bg-slate-900/60 p-4 text-sm text-slate-400">
                No numeric top-level OpenSCAD parameters were detected in this model.
              </div>
            )}
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

function SlidersIcon() {
  return (
    <svg
      className="h-5 w-5"
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth="1.8"
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h6m4 0h6M8 6v12m8-8h4M4 10h8m-4 0v8m-4 4h10m4 0h2m-6 0v-6" />
    </svg>
  );
}

function formatElapsedTimestamp(elapsedSeconds: number) {
  const safeElapsed = Math.max(0, elapsedSeconds);
  const minutes = Math.floor(safeElapsed / 60);
  const seconds = (safeElapsed % 60).toFixed(1).padStart(4, '0');
  return `[${String(minutes).padStart(2, '0')}:${seconds}]`;
}

function getElapsedSeconds(start: number) {
  if (!start) return 0;
  return Math.max(0, (Date.now() - start) / 1000);
}

function formatBytes(bytes: number) {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
}

function estimateTriangleCount(bytes: number) {
  if (bytes < 84) return 0;
  return Math.max(0, Math.floor((bytes - 84) / 50));
}

function formatFileName(value: string) {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40);

  return normalized || `model_${Date.now()}`;
}

function getStrategyBadgeLabel(strategy: GenerationStrategy, category: PromptCategory | '') {
  if (strategy === 'mechanical_precision') {
    return '⚙️ Mechanical Precision';
  }

  return category === 'character' || category === 'object' ? '🔍 Web Research' : '🔍 Web Research';
}

function formatParamName(name: string) {
  return name
    .replace(/^\$/, '')
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function getParamStep(value: number) {
  return Number.isInteger(value) && Math.abs(value) >= 10 ? 1 : 0.5;
}

function roundToStep(value: number, step: number) {
  return Number((Math.round(value / step) * step).toFixed(step === 1 ? 0 : 2));
}

function formatParamValue(value: number) {
  return Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/\.?0+$/, '');
}
