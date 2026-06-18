import { NextRequest, NextResponse } from 'next/server';
import { GoogleGenerativeAI } from '@google/generative-ai';

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);

export async function POST(req: NextRequest) {
  try {
    const { prompt } = await req.json();

    if (!prompt || typeof prompt !== 'string') {
      return NextResponse.json({ error: 'Prompt is required' }, { status: 400 });
    }

    const model = genAI.getGenerativeModel({
      model: 'gemini-1.5-flash',
      systemInstruction:
        'You are an expert OpenSCAD programmer. Given a plain English description of a 3D object, return a JSON object with two fields: "description" (a clear technical description of the model) and "scadCode" (valid, working OpenSCAD code that creates the described object). Only return valid JSON, no markdown, no code fences.',
    });

    const result = await model.generateContent(prompt);
    const text = result.response.text().trim();

    // Strip any accidental markdown fences
    const cleaned = text.replace(/^```(?:json)?\n?/i, '').replace(/\n?```$/i, '').trim();

    let parsed: { description: string; scadCode: string };
    try {
      parsed = JSON.parse(cleaned);
    } catch {
      return NextResponse.json(
        { error: 'Gemini returned invalid JSON', raw: cleaned },
        { status: 502 }
      );
    }

    if (!parsed.description || !parsed.scadCode) {
      return NextResponse.json(
        { error: 'Gemini response missing required fields', raw: cleaned },
        { status: 502 }
      );
    }

    return NextResponse.json({ description: parsed.description, scadCode: parsed.scadCode });
  } catch (err) {
    console.error('[rewrite] error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
