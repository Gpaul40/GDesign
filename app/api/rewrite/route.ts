import { NextRequest, NextResponse } from 'next/server';

const MODELS = ['gemini-2.5-flash', 'gemini-2.5-flash-lite'];

async function callGemini(model: string, prompt: string): Promise<string> {
  const key = process.env.GEMINI_API_KEY!;
  const systemInstruction = 'You are an expert OpenSCAD programmer. Given a plain English description of a 3D object, return a JSON object with two fields: "description" (a clear technical description of the model) and "scadCode" (valid, working OpenSCAD code that creates the described object). Only return valid JSON, no markdown, no code fences.';
  
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        systemInstruction: { parts: [{ text: systemInstruction }] },
      }),
    }
  );
  if (!res.ok) {
    const err = await res.json();
    throw new Error(JSON.stringify(err.error || err));
  }
  const data = await res.json();
  return data.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
}

export async function POST(req: NextRequest) {
  try {
    const { prompt } = await req.json();
    if (!prompt || typeof prompt !== 'string') {
      return NextResponse.json({ error: 'Prompt is required' }, { status: 400 });
    }

    let text = '';
    let lastError = '';
    for (const model of MODELS) {
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          text = await callGemini(model, prompt);
          if (text) break;
        } catch (e) {
          lastError = e instanceof Error ? e.message : String(e);
          await new Promise(r => setTimeout(r, 2000));
        }
      }
      if (text) break;
    }

    if (!text) {
      return NextResponse.json({ error: 'Gemini unavailable: ' + lastError }, { status: 503 });
    }

    const cleaned = text.replace(/^```(?:json)?\n?/i, '').replace(/\n?```$/i, '').trim();

    let parsed: { description: string; scadCode: string };
    try {
      parsed = JSON.parse(cleaned);
    } catch {
      return NextResponse.json({ error: 'Gemini returned invalid JSON', raw: cleaned }, { status: 502 });
    }

    if (!parsed.description || !parsed.scadCode) {
      return NextResponse.json({ error: 'Gemini response missing fields', raw: cleaned }, { status: 502 });
    }

    return NextResponse.json({ description: parsed.description, scadCode: parsed.scadCode });
  } catch (err) {
    console.error('[rewrite] error:', err);
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Unknown error' }, { status: 500 });
  }
}
