import { NextRequest, NextResponse } from 'next/server';
import { isValidDocumentationUrl } from '@/utils/url-utils';
import { cacheService } from '@/lib/cache/redis-cache';

/**
 * POST /api/crawl/seed
 *
 * Bootstraps the URL manifest for cache-first crawl deduplication.
 * Accepts a start URL and a list of page URLs that were previously crawled.
 * Verifies each page URL is still cached in Redis before storing the manifest.
 *
 * This avoids burning Firecrawl credits on a "bootstrap" crawl when pages
 * are already cached from a previous crawl that ran before the cache-first
 * code was deployed.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { url, pageUrls } = body;

    if (!url || typeof url !== 'string') {
      return NextResponse.json({ error: 'Missing required field: url' }, { status: 400 });
    }

    if (!Array.isArray(pageUrls) || pageUrls.length === 0) {
      return NextResponse.json({ error: 'Missing required field: pageUrls (non-empty array)' }, { status: 400 });
    }

    if (!isValidDocumentationUrl(url)) {
      return NextResponse.json(
        { error: 'Invalid URL. Must be from an allowed documentation domain' },
        { status: 400 }
      );
    }

    // Verify which page URLs are actually cached
    const cached = await cacheService.mget(pageUrls);
    const cachedUrls = pageUrls.filter(u => cached.get(u) !== null);
    const missingUrls = pageUrls.filter(u => cached.get(u) === null);

    if (cachedUrls.length === 0) {
      return NextResponse.json(
        { error: 'None of the provided page URLs are cached', missingUrls },
        { status: 404 }
      );
    }

    // Store only the cached URLs in the manifest
    await cacheService.setCrawlUrlMap(url, cachedUrls);

    console.info(
      `[SEED] URL manifest stored for ${url}: ${cachedUrls.length} cached, ${missingUrls.length} missing`
    );

    return NextResponse.json({
      success: true,
      url,
      stored: cachedUrls.length,
      missing: missingUrls.length,
      missingUrls: missingUrls.length > 0 ? missingUrls : undefined,
    });
  } catch (error) {
    console.error('Crawl Seed API Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
