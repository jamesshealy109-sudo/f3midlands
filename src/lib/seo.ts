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
  email?: string;
  phone?: string;
  sourceUrl?: string;
  schedule?: AoSchedule[];
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
