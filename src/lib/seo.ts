export interface AoSchedule {
  day?: string;
  time?: string;
  startTime?: string;
  endTime?: string;
  type?: string;
  location?: string;
  address?: string;
  streetAddress?: string;
  city?: string;
  state?: string;
  zip?: string;
  latitude?: number;
  longitude?: number;
  mapUrl?: string;
}

export interface AoLocation {
  locationLogoUrl?: string;
}

export interface AoListing {
  id: string;
  apiAoId?: number;
  name: string;
  region: string;
  city: string;
  type: string;
  days: string;
  time: string;
  scheduleSummary?: string;
  location?: string;
  address: string;
  streetAddress?: string;
  latitude?: number;
  longitude?: number;
  notes?: string;
  active?: boolean;
  verified?: boolean;
  showOnWebsite?: boolean;
  mapUrl?: string;
  f3MapUrl?: string;
  website?: string;
  email?: string;
  phone?: string;
  logoUrl?: string;
  imageUrl?: string;
  imageSource?: string;
  twitter?: string;
  facebook?: string;
  instagram?: string;
  sourceUrl?: string;
  schedule?: AoSchedule[];
  locations?: AoLocation[];
}

export type AoLinkPlatform = 'website' | 'twitter' | 'facebook' | 'instagram';

export interface AoOfficialLink {
  label: string;
  url: string;
}

export const SITE_URL = 'https://f3midlands.com';

export function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/^f3\s+/, '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

export function regionSlug(region: string) {
  return slugify(region);
}

export function aoSlug(ao: AoListing) {
  const uniqueId = ao.apiAoId || ao.id.replace(/^f3-ao-/, '');
  return slugify(`${ao.city}-${ao.name}-${uniqueId}`);
}

export function regionName(region: string) {
  return region.replace(/^F3\s+/i, '').replace(/\s+-\s+SC$/i, ', SC').trim();
}

export function stateFromAo(ao: AoListing) {
  return ao.schedule?.find((item) => item.state)?.state || 'SC';
}

export function zipFromAo(ao: AoListing) {
  const fromSchedule = ao.schedule?.find((item) => item.zip)?.zip;
  return fromSchedule || ao.address.match(/\b\d{5}(?:-\d{4})?\b/)?.[0] || '';
}

export function visibleListings(input: AoListing[]) {
  return input.filter((ao) => ao.showOnWebsite !== false && ao.active !== false && ao.verified !== false);
}

export function externalAoUrl(value: unknown, platform: AoLinkPlatform) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (/^https?:\/\//i.test(raw)) return raw;

  const withoutAt = raw.replace(/^@/, '').replace(/^\/+|\/+$/g, '');
  if (/^(?:www\.)?[^\s]+\.[a-z]{2,}(?:\/.*)?$/i.test(withoutAt)) {
    return `https://${withoutAt}`;
  }

  const platformBases: Partial<Record<AoLinkPlatform, string>> = {
    twitter: 'https://x.com/',
    facebook: 'https://www.facebook.com/',
    instagram: 'https://www.instagram.com/',
  };
  const platformBase = platformBases[platform];
  return platformBase ? `${platformBase}${withoutAt}` : '';
}

export function aoImageUrl(ao: AoListing) {
  return (
    ao.imageUrl ||
    ao.logoUrl ||
    ao.locations?.find((location) => location.locationLogoUrl)?.locationLogoUrl ||
    ''
  );
}

export function aoOfficialLinks(ao: AoListing): AoOfficialLink[] {
  return [
    { label: 'Website', url: externalAoUrl(ao.website, 'website') },
    { label: 'Instagram', url: externalAoUrl(ao.instagram, 'instagram') },
    { label: 'Facebook', url: externalAoUrl(ao.facebook, 'facebook') },
    { label: 'X', url: externalAoUrl(ao.twitter, 'twitter') },
  ].filter((link) => link.url);
}
