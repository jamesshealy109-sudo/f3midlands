import rawAos from '../data/aos.json';
import { aoSlug, regionSlug, SITE_URL, visibleListings, type AoListing } from '../lib/seo';

export function GET() {
  const listings = visibleListings(rawAos as unknown as AoListing[]);
  const regions = [...new Set(listings.map((ao) => ao.region))];
  const paths = [
    '/',
    ...regions.map((region) => `/regions/${regionSlug(region)}/`),
    ...listings.map((ao) => `/workouts/${aoSlug(ao)}/`),
  ];
  const urls = paths.map((path) => `  <url><loc>${SITE_URL}${path}</loc></url>`).join('\n');
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>`;

  return new Response(xml, { headers: { 'Content-Type': 'application/xml; charset=utf-8' } });
}
