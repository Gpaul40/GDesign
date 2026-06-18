import { NextRequest, NextResponse } from 'next/server';

const MODELS = ['gemini-2.5-flash', 'gemini-2.5-flash-lite'];
const WEB_SEARCH_TOOL: Array<{ google_search: Record<string, never> }> = [{ google_search: {} }];

type Category = 'character' | 'mechanical' | 'object';
type Strategy = 'web_research' | 'mechanical_precision';

type GeminiPart = {
  text?: string;
};

type GeminiChunk = {
  web?: {
    title?: string;
    uri?: string;
  };
};

type GeminiSupport = {
  segment?: {
    text?: string;
  };
  groundingChunkIndices?: number[];
};

type GeminiResponse = {
  candidates?: Array<{
    content?: {
      parts?: GeminiPart[];
    };
    groundingMetadata?: {
      webSearchQueries?: string[];
      groundingChunks?: GeminiChunk[];
      groundingSupports?: GeminiSupport[];
    };
  }>;
};

const BASE_SYSTEM_PROMPT = `You are a world-class OpenSCAD engineer specializing in highly detailed, print-ready 3D models.

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

const CHARACTER_SYSTEM_PROMPT = `${BASE_SYSTEM_PROMPT}

Character-specific guidance:
- Prioritize recognizable body proportions and the subject's most distinctive silhouette
- Simplify anatomy into printable, stable geometry while preserving key facial, costume, or species-defining features
- Favor hull(), rotate_extrude(), tapered cylinders, spheres, and blended primitives for organic forms
- Keep overhangs manageable and ensure the pose is self-supporting or uses a solid integrated base
- Use researched proportions when available, but translate them into simplified, robust 3D-printable shapes`;

const MECHANICAL_SYSTEM_PROMPT = `${BASE_SYSTEM_PROMPT}

Mechanical precision guidance:
- Design like a careful mechanical CAD engineer using BOSL2-style patterns and best practices, but output pure OpenSCAD only
- Prioritize exact dimensions, alignment, symmetry, fit, and manufacturability
- Add tolerance notes in comments wherever mating parts interact, using 0.2 mm clearance unless the request implies otherwise
- Prefer common hardware standards such as M3 and M4 fasteners with realistic clearance dimensions
- Include interlocking features, lead-ins, chamfers, ribs, bosses, and stops where they improve strength or assembly
- Use robust mechanical patterns such as:
  * m3_clearance_d = 3.4; m4_clearance_d = 4.4;
  * clearance = 0.2; // mm per side for sliding or mating features
  * difference() { part_body(); translate([0,0,-0.1]) cylinder(h=plate_thickness+0.2, d=m3_clearance_d); }
  * translate([0,0,thread_start_z]) cylinder(h=thread_length, d=major_diameter);
  * difference() { outer_lug(); translate([0,0,-0.1]) cylinder(h=lug_thickness+0.2, d=pin_diameter + clearance*2); }
- If threads, bearings, hinges, or joints are requested, model practical approximations that print well and assemble cleanly`;

const OBJECT_SYSTEM_PROMPT = `${BASE_SYSTEM_PROMPT}

Object-specific guidance:
- Use real-world proportions and standard dimensions when reference data is available
- Preserve the familiar silhouette and usability of the object while keeping the geometry elegant and printable
- Translate researched dimensions into clear top-level parameters in millimeters`;

async function fetchGemini(
  model: string,
  prompt: string,
  options?: {
    systemInstruction?: string;
    tools?: Array<{ google_search: Record<string, never> }>;
  }
): Promise<GeminiResponse> {
  const key = process.env.GEMINI_API_KEY!;
  const body: Record<string, unknown> = {
    contents: [{ parts: [{ text: prompt }] }],
  };

  if (options?.systemInstruction) {
    body.systemInstruction = { parts: [{ text: options.systemInstruction }] };
  }

  if (options?.tools?.length) {
    body.tools = options.tools;
  }

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }
  );

  if (!res.ok) {
    const err = await res.json();
    throw new Error(JSON.stringify(err.error || err));
  }

  return res.json();
}

async function runGeminiWithRetry<T>(
  runner: (model: string) => Promise<T | null>
): Promise<{ result: T; model: string }> {
  let lastError = '';

  for (const model of MODELS) {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const result = await runner(model);
        if (result) return { result, model };
      } catch (e) {
        lastError = e instanceof Error ? e.message : String(e);
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }
    }
  }

  throw new Error(lastError ? `Gemini unavailable: ${lastError}` : 'Gemini unavailable');
}

function extractText(data: GeminiResponse) {
  return (
    data.candidates?.[0]?.content?.parts
      ?.map((part) => part.text ?? '')
      .join('')
      .trim() ?? ''
  );
}

function cleanJsonText(text: string) {
  return text.replace(/^```(?:json)?\n?/i, '').replace(/\n?```$/i, '').trim();
}

function normalizeCategory(raw: string): Category {
  const value = raw.trim().toLowerCase();
  if (value.includes('character')) return 'character';
  if (value.includes('mechanical')) return 'mechanical';
  return 'object';
}

function getStrategy(category: Category): Strategy {
  return category === 'mechanical' ? 'mechanical_precision' : 'web_research';
}

function getGenerationSystemPrompt(category: Category) {
  switch (category) {
    case 'character':
      return CHARACTER_SYSTEM_PROMPT;
    case 'mechanical':
      return MECHANICAL_SYSTEM_PROMPT;
    default:
      return OBJECT_SYSTEM_PROMPT;
  }
}

function getResearchQuery(prompt: string, category: Extract<Category, 'character' | 'object'>) {
  return category === 'character'
    ? `${prompt} 3D model dimensions proportions reference`
    : `${prompt} dimensions mm standard size`;
}

function buildResearchPrompt(prompt: string, category: Extract<Category, 'character' | 'object'>) {
  const searchQuery = getResearchQuery(prompt, category);
  const focus =
    category === 'character'
      ? 'Focus on body proportions, silhouette, distinctive features, and any commonly referenced height or scale details in millimeters.'
      : 'Focus on standard real-world dimensions in millimeters, typical proportions, and defining features that matter for a recognizable printable model.';

  return `Use Google Search grounding to research this subject for a print-ready OpenSCAD model.
Search target: "${searchQuery}"
Subject: "${prompt}"
${focus}
Return 4-6 concise bullet points with the most useful dimensional or proportional facts.`;
}

function buildGroundingContext(data: GeminiResponse) {
  const metadata = data.candidates?.[0]?.groundingMetadata;
  const researchText = extractText(data);
  const snippetLines: string[] = [];

  if (metadata?.groundingSupports?.length && metadata.groundingChunks?.length) {
    for (const support of metadata.groundingSupports.slice(0, 6)) {
      const segmentText = support.segment?.text?.trim();
      if (!segmentText) continue;

      const sources = (support.groundingChunkIndices ?? [])
        .map((index) => metadata.groundingChunks?.[index]?.web?.title)
        .filter((title): title is string => Boolean(title));

      snippetLines.push(
        sources.length > 0 ? `- ${segmentText} (sources: ${sources.join(', ')})` : `- ${segmentText}`
      );
    }
  }

  const queryLine =
    metadata?.webSearchQueries?.length
      ? `Search queries used: ${metadata.webSearchQueries.join(' | ')}`
      : '';

  const sections = [queryLine, researchText, ...snippetLines].filter(Boolean);
  return sections.length > 0 ? sections.join('\n') : null;
}

function buildGenerationPrompt(
  prompt: string,
  category: Category,
  strategy: Strategy,
  researchContext: string | null
) {
  return [
    `User request: "${prompt}"`,
    `Detected category: ${category}`,
    `Generation strategy: ${strategy}`,
    researchContext
      ? `Grounded research findings:\n${researchContext}\nUse these references when choosing dimensions, proportions, and distinguishing features.`
      : 'Grounded research findings: none available. Use sound real-world assumptions and stay print-ready.',
    'Return JSON with exactly "description" and "scadCode".',
  ].join('\n\n');
}

async function classifyPrompt(prompt: string) {
  const { result } = await runGeminiWithRetry(async (model) => {
    const data = await fetchGemini(
      model,
      `Classify this 3D modeling prompt into exactly one word: character, mechanical, or object.\nPrompt: "${prompt}"`,
      {
        systemInstruction:
          'You are a fast classifier. character = people, characters, creatures, animals. mechanical = gears, brackets, hinges, threads, bearings, joints, technical parts. object = everyday objects, household items, accessories. If unsure, return object. Return one word only.',
      }
    );

    const text = extractText(data);
    return text ? normalizeCategory(text) : null;
  });

  return result;
}

async function researchPrompt(prompt: string, category: Extract<Category, 'character' | 'object'>) {
  try {
    const { result } = await runGeminiWithRetry(async (model) => {
      const data = await fetchGemini(model, buildResearchPrompt(prompt, category), {
        systemInstruction:
          'You are a concise research assistant. Use Google Search grounding when helpful, prioritize dimensional facts and recognizable reference details, and keep the answer short.',
        tools: WEB_SEARCH_TOOL,
      });

      return buildGroundingContext(data) ?? (extractText(data) || null);
    });

    return result;
  } catch (error) {
    console.warn('[rewrite] grounded research fallback:', error);
    return null;
  }
}

export async function POST(req: NextRequest) {
  try {
    const { prompt } = await req.json();
    if (!prompt || typeof prompt !== 'string') {
      return NextResponse.json({ error: 'Prompt is required' }, { status: 400 });
    }

    const category = await classifyPrompt(prompt);
    const strategy = getStrategy(category);
    const researchContext =
      category === 'mechanical' ? null : await researchPrompt(prompt, category);

    const { result: text } = await runGeminiWithRetry(async (model) => {
      const data = await fetchGemini(
        model,
        buildGenerationPrompt(prompt, category, strategy, researchContext),
        {
          systemInstruction: getGenerationSystemPrompt(category),
        }
      );

      const responseText = extractText(data);
      return responseText || null;
    });

    const cleaned = cleanJsonText(text);

    let parsed: { description: string; scadCode: string };
    try {
      parsed = JSON.parse(cleaned);
    } catch {
      return NextResponse.json({ error: 'Gemini returned invalid JSON', raw: cleaned }, { status: 502 });
    }

    if (!parsed.description || !parsed.scadCode) {
      return NextResponse.json({ error: 'Gemini response missing fields', raw: cleaned }, { status: 502 });
    }

    return NextResponse.json({
      description: parsed.description,
      scadCode: parsed.scadCode,
      category,
      strategy,
    });
  } catch (err) {
    console.error('[rewrite] error:', err);
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Unknown error' }, { status: 500 });
  }
}
