import { NextRequest, NextResponse } from 'next/server';

type Category = 'character' | 'mechanical' | 'object';
type ImageSource = 'wikipedia' | 'unsplash';
type ReferenceImage = {
  url: string;
  title: string;
  source: ImageSource;
};

type WikipediaResponse = {
  query?: {
    search?: Array<{
      title?: string;
    }>;
    pages?: Record<
      string,
      {
        title?: string;
        thumbnail?: {
          source?: string;
          width?: number;
          height?: number;
        };
        images?: Array<{
          title?: string;
        }>;
        imageinfo?: Array<{
          url?: string;
          width?: number;
          height?: number;
        }>;
      }
    >;
  };
};
type UnsplashResponse = {
  results?: Array<{
    id?: string;
    alt_description?: string | null;
    description?: string | null;
    urls?: {
      small?: string;
      regular?: string;
    };
  }>;
};

const MAX_IMAGES = 8;
const MIN_IMAGE_SIZE = 100;
const WIKIPEDIA_API = 'https://en.wikipedia.org/w/api.php';

function normalizeCategory(raw: string): Category {
  const value = raw.trim().toLowerCase();
  if (value.includes('character')) return 'character';
  if (value.includes('mechanical')) return 'mechanical';
  return 'object';
}

function cleanSearchTerm(prompt: string) {
  return prompt
    .trim()
    .replace(/["'`]/g, '')
    .replace(/\s+/g, ' ')
    .slice(0, 120);
}

function buildUnsplashSearchTerm(prompt: string, category: Category) {
  switch (category) {
    case 'mechanical':
      return `${prompt} mechanical engineering`;
    case 'character':
      return `${prompt} character reference`;
    default:
      return prompt;
  }
}

async function fetchUnsplashSearch(term: string) {
  const searchParams = new URLSearchParams({
    query: term,
    per_page: '6',
    page: '1',
  });
  const res = await fetch(`https://unsplash.com/napi/search/photos?${searchParams.toString()}`, {
    headers: {
      'Accept-Version': 'v1',
    },
  });

  if (!res.ok) {
    throw new Error(`Unsplash request failed with ${res.status}`);
  }

  return (await res.json()) as UnsplashResponse;
}

async function fetchWikipedia(params: Record<string, string>) {
  const searchParams = new URLSearchParams({
    action: 'query',
    format: 'json',
    origin: '*',
    ...params,
  });
  const res = await fetch(`${WIKIPEDIA_API}?${searchParams.toString()}`);

  if (!res.ok) {
    throw new Error(`Wikipedia request failed with ${res.status}`);
  }

  return (await res.json()) as WikipediaResponse;
}

function isValidImageUrl(url: string) {
  const normalized = url.toLowerCase();
  return !normalized.endsWith('.svg') && !normalized.includes('.svg?');
}

function isLargeEnough(width?: number, height?: number) {
  return (width ?? MIN_IMAGE_SIZE) >= MIN_IMAGE_SIZE && (height ?? MIN_IMAGE_SIZE) >= MIN_IMAGE_SIZE;
}

function dedupeImages(images: ReferenceImage[]) {
  const seen = new Set<string>();
  const results: ReferenceImage[] = [];

  for (const image of images) {
    if (seen.has(image.url)) continue;
    seen.add(image.url);
    results.push(image);
    if (results.length >= MAX_IMAGES) break;
  }

  return results;
}

async function getWikipediaThumbnail(title: string): Promise<ReferenceImage[]> {
  try {
    const data = await fetchWikipedia({
      titles: title,
      prop: 'pageimages',
      pithumbsize: '400',
    });

    return Object.values(data.query?.pages ?? {})
      .flatMap((page) => {
        const source = page.thumbnail?.source;
        if (!source || !isValidImageUrl(source) || !isLargeEnough(page.thumbnail?.width, page.thumbnail?.height)) {
          return [];
        }

        return [{ url: source, title: page.title ?? title, source: 'wikipedia' as const }];
      })
      .slice(0, 1);
  } catch (error) {
    console.warn('[images] wikipedia thumbnail failed:', error);
    return [];
  }
}

async function getWikipediaImageInfo(fileTitle: string): Promise<ReferenceImage | null> {
  try {
    const data = await fetchWikipedia({
      titles: fileTitle.startsWith('File:') ? fileTitle : `File:${fileTitle}`,
      prop: 'imageinfo',
      iiprop: 'url|size',
    });

    for (const page of Object.values(data.query?.pages ?? {})) {
      const image = page.imageinfo?.[0];
      if (!image?.url || !isValidImageUrl(image.url) || !isLargeEnough(image.width, image.height)) {
        continue;
      }

      return {
        url: image.url,
        title: (page.title ?? fileTitle).replace(/^File:/, ''),
        source: 'wikipedia',
      };
    }
  } catch (error) {
    console.warn('[images] wikipedia image info failed:', error);
  }

  return null;
}

async function getWikipediaGallery(title: string): Promise<ReferenceImage[]> {
  try {
    const data = await fetchWikipedia({
      titles: title,
      prop: 'images',
      imlimit: '6',
    });

    const page = Object.values(data.query?.pages ?? {})[0];
    const imageTitles = (page?.images ?? [])
      .map((image) => image.title)
      .filter((value): value is string => Boolean(value))
      .filter((value) => !value.toLowerCase().endsWith('.svg'))
      .slice(0, 5);

    const images = await Promise.all(imageTitles.map((imageTitle) => getWikipediaImageInfo(imageTitle)));
    return images.filter((image): image is ReferenceImage => Boolean(image));
  } catch (error) {
    console.warn('[images] wikipedia gallery failed:', error);
    return [];
  }
}

async function getWikipediaImages(prompt: string): Promise<ReferenceImage[]> {
  const titles = [prompt];

  try {
    const searchData = await fetchWikipedia({
      list: 'search',
      srsearch: prompt,
      srlimit: '4',
    });

    for (const result of searchData.query?.search ?? []) {
      if (result.title && !titles.includes(result.title)) {
        titles.push(result.title);
      }
    }
  } catch (error) {
    console.warn('[images] wikipedia search failed:', error);
  }

  const thumbnailGroups = await Promise.all(titles.slice(0, 4).map((title) => getWikipediaThumbnail(title)));
  const galleryImages = titles.length > 0 ? await getWikipediaGallery(titles[0]) : [];

  return dedupeImages([...thumbnailGroups.flat(), ...galleryImages]);
}

async function getUnsplashImages(prompt: string, category: Category): Promise<ReferenceImage[]> {
  try {
    const data = await fetchUnsplashSearch(buildUnsplashSearchTerm(prompt, category));
    return (data.results ?? []).reduce<ReferenceImage[]>((images, image, index) => {
        const url = image.urls?.small ?? image.urls?.regular;
        if (!url || !isValidImageUrl(url)) return images;

        images.push({
          url,
          title: image.alt_description ?? image.description ?? `${prompt} reference ${index + 1}`,
          source: 'unsplash' as const,
        });

        return images;
      }, [])
      .slice(0, 6);
  } catch (error) {
    console.warn('[images] unsplash search failed:', error);
    return [];
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const prompt = typeof body?.prompt === 'string' ? cleanSearchTerm(body.prompt) : '';

    if (!prompt) {
      return NextResponse.json({ error: 'Prompt is required' }, { status: 400 });
    }

    const category =
      typeof body?.category === 'string' && body.category.trim() ? normalizeCategory(body.category) : 'object';

    const unsplashImages = await getUnsplashImages(prompt, category);
    const images =
      category === 'character' ? dedupeImages([...await getWikipediaImages(prompt), ...unsplashImages]) : unsplashImages;

    return NextResponse.json({ images: images.slice(0, MAX_IMAGES) });
  } catch (error) {
    console.error('[images] error:', error);
    return NextResponse.json({ images: [] });
  }
}
