import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export async function POST(req: NextRequest) {
  try {
    const { scadCode, fileName } = await req.json();

    if (!scadCode || typeof scadCode !== 'string') {
      return NextResponse.json({ error: 'scadCode is required' }, { status: 400 });
    }

    const baseName = fileName
      ? fileName.replace(/\.[^.]+$/, '')
      : `model_${Date.now()}`;
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_KEY!
    );
    const encoder = new TextEncoder();
    const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
    const writer = writable.getWriter();

    const send = async (data: object) => {
      await writer.write(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
    };

    void (async () => {
      try {
        await send({ status: '🔍 Parsing OpenSCAD code...', progress: 5 });

        await send({ status: '⚙️ Initializing WebAssembly renderer...', progress: 15 });
        const { createOpenSCAD } = await import('openscad-wasm');
        const instance = await createOpenSCAD({ noInitialRun: true });
        const openscad = instance.getInstance();

        openscad.FS.writeFile('/input.scad', scadCode);

        await send({ status: '🏗️ Compiling model geometry...', progress: 35 });
        await send({ status: '🔄 Rendering mesh (this may take a moment)...', progress: 55 });
        openscad.callMain(['/input.scad', '-o', '/output.stl']);

        const rawData = openscad.FS.readFile('/output.stl') as Uint8Array;
        const stlBuffer = rawData.buffer.slice(
          rawData.byteOffset,
          rawData.byteOffset + rawData.byteLength
        ) as ArrayBuffer;
        const triangleCount =
          rawData.byteLength >= 84
            ? new DataView(stlBuffer).getUint32(80, true)
            : Math.max(0, Math.floor(Math.max(rawData.byteLength - 84, 0) / 50));

        await send({
          status: '✅ Render complete! Processing output...',
          progress: 75,
          stlBytes: rawData.byteLength,
          triangleCount,
        });

        const scadPath = `${baseName}.scad`;
        await send({ status: '☁️ Uploading .scad file...', progress: 82 });
        const { error: scadUploadError } = await supabase.storage
          .from('GDesign')
          .upload(scadPath, new Blob([scadCode], { type: 'text/plain' }), {
            upsert: true,
            contentType: 'text/plain',
          });

        if (scadUploadError) {
          throw new Error(`Failed to upload .scad: ${scadUploadError.message}`);
        }

        const stlPath = `${baseName}.stl`;
        await send({ status: '☁️ Uploading .stl file...', progress: 90 });
        const { error: stlUploadError } = await supabase.storage
          .from('GDesign')
          .upload(stlPath, new Blob([stlBuffer], { type: 'model/stl' }), {
            upsert: true,
            contentType: 'model/stl',
          });

        if (stlUploadError) {
          throw new Error(`Failed to upload .stl: ${stlUploadError.message}`);
        }

        const { data: scadUrlData } = supabase.storage.from('GDesign').getPublicUrl(scadPath);
        const { data: stlUrlData } = supabase.storage.from('GDesign').getPublicUrl(stlPath);

        await send({
          status: '🎉 Done! Loading preview...',
          progress: 100,
          stlBytes: rawData.byteLength,
          triangleCount,
          stlUrl: stlUrlData.publicUrl,
          scadUrl: scadUrlData.publicUrl,
        });
      } catch (err) {
        console.error('[generate] error:', err);
        await send({ error: err instanceof Error ? err.message : String(err) });
      } finally {
        await writer.close();
      }
    })();

    return new Response(readable, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      },
    });
  } catch (err) {
    console.error('[generate] error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
