import { NextRequest, NextResponse } from 'next/server';

const MODELS = ['gemini-2.5-flash', 'gemini-2.5-flash-lite'];

async function callGemini(model: string, prompt: string): Promise<string> {
  const key = process.env.GEMINI_API_KEY!;
  const systemInstruction = `You are a world-class OpenSCAD engineer specializing in highly detailed, print-ready 3D models.

Given a plain English description, return a JSON object with exactly two fields:
- "description": a detailed technical description of what will be modeled, including key dimensions, features, and design decisions
- "scadCode": complete, valid, working OpenSCAD code

Rules for the OpenSCAD code:
1. Use parametric variables at the top (e.g. width, height, wall_thickness, fillet_r) so the model is easy to customize
2. Add realistic detail: fillets/chamfers on edges, screw holes, ribs for strength, cutouts, curves where appropriate
3. Use difference(), union(), intersection() and hull() to create complex geometry — avoid flat boxy shapes
4. Use $fn = 64 or higher for smooth curves
5. Add a cable management hole, slot, or similar practical feature where it makes sense
6. Model must be manifold and 3D-printable (no zero-thickness walls, no open surfaces)
7. Comment each major section of code
8. Aim for 80-150 lines of well-structured OpenSCAD code — not too simple, not overcomplicated

Only return valid JSON, no markdown, no code fences.`;
  
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
