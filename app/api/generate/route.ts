import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export async function POST(req: NextRequest) {
  // Lazy-init Supabase inside the handler so env vars are read at request time
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
  try {
    const { scadCode, fileName } = await req.json();

    if (!scadCode || typeof scadCode !== 'string') {
      return NextResponse.json({ error: 'scadCode is required' }, { status: 400 });
    }

    const baseName = fileName
      ? fileName.replace(/\.[^.]+$/, '')
      : `model_${Date.now()}`;

    // Generate STL using openscad-wasm
    let stlBuffer: ArrayBuffer;
    try {
      const { createOpenSCAD } = await import('openscad-wasm');
      const instance = await createOpenSCAD({ noInitialRun: true });
      const openscad = instance.getInstance();
      openscad.FS.writeFile('/input.scad', scadCode);
      openscad.callMain(['/input.scad', '-o', '/output.stl']);
      const rawData = openscad.FS.readFile('/output.stl') as Uint8Array;
      // Copy into a plain ArrayBuffer to satisfy TypeScript/Blob constraints
      stlBuffer = rawData.buffer.slice(rawData.byteOffset, rawData.byteOffset + rawData.byteLength) as ArrayBuffer;
    } catch (wasmErr) {
      console.error('[generate] openscad-wasm error:', wasmErr);
      return NextResponse.json(
        { error: `OpenSCAD rendering failed: ${wasmErr instanceof Error ? wasmErr.message : String(wasmErr)}` },
        { status: 500 }
      );
    }

    // Upload .scad to Supabase Storage
    const scadPath = `${baseName}.scad`;
    const { error: scadUploadError } = await supabase.storage
      .from('models')
      .upload(scadPath, new Blob([scadCode], { type: 'text/plain' }), {
        upsert: true,
        contentType: 'text/plain',
      });

    if (scadUploadError) {
      console.error('[generate] scad upload error:', scadUploadError);
      return NextResponse.json(
        { error: `Failed to upload .scad: ${scadUploadError.message}` },
        { status: 500 }
      );
    }

    // Upload .stl to Supabase Storage
    const stlPath = `${baseName}.stl`;
    const { error: stlUploadError } = await supabase.storage
      .from('models')
      .upload(stlPath, new Blob([stlBuffer], { type: 'model/stl' }), {
        upsert: true,
        contentType: 'model/stl',
      });

    if (stlUploadError) {
      console.error('[generate] stl upload error:', stlUploadError);
      return NextResponse.json(
        { error: `Failed to upload .stl: ${stlUploadError.message}` },
        { status: 500 }
      );
    }

    const { data: scadUrlData } = supabase.storage.from('models').getPublicUrl(scadPath);
    const { data: stlUrlData } = supabase.storage.from('models').getPublicUrl(stlPath);

    return NextResponse.json({
      stlUrl: stlUrlData.publicUrl,
      scadUrl: scadUrlData.publicUrl,
    });
  } catch (err) {
    console.error('[generate] error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
