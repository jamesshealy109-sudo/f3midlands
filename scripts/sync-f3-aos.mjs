#!/usr/bin/env node

import { readFile, rename, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, '..');
const outputPath = path.join(repositoryRoot, 'src', 'data', 'aos.json');
const envPath = path.join(repositoryRoot, '.env');

await loadLocalEnv(envPath);

const API_BASE_URL = (process.env.F3_API_BASE_URL || 'https://api.f3nation.com/v1').replace(/\/$/, '');
const EVENTS_URL = process.env.F3_EVENTS_URL || `${API_BASE_URL}/map/event/all?statuses=active&eventCategories=first_f`;
const API_KEY = process.env.F3_NATION_API_KEY?.trim();
const API_CLIENT = process.env.F3_API_CLIENT?.trim() || 'f3-midlands-site';
const STRICT = /^true$/i.test(process.env.F3_SYNC_STRICT || 'false');
const DRY_RUN = /^true$/i.test(process.env.F3_SYNC_DRY_RUN || 'false');
const MIN_AO_COUNT = parsePositiveInteger(process.env.F3_MIN_AO_COUNT, 5);
const FIXTURE_PATH = process.env.F3_API_FIXTURE
  ? path.resolve(repositoryRoot, process.env.F3_API_FIXTURE)
  : null;
const TARGET_REGIONS = parseRegionNames(
  process.env.F3_REGION_NAMES || 'Lexington,Columbia,Lake Murray,Camden,Saluda',
);
const DAY_ORDER = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const syncTimestamp = new Date().toISOString();

try {
  const fallbackAos = await readExistingAos();
  let payload;

  if (FIXTURE_PATH) {
    payload = JSON.parse(await readFile(FIXTURE_PATH, 'utf8'));
    console.log(`Using F3 API fixture: ${path.relative(repositoryRoot, FIXTURE_PATH)}`);
  } else {
    if (!API_KEY) {
      throw new Error(
        'F3_NATION_API_KEY is not set. The existing src/data/aos.json file was left unchanged.',
      );
    }
    payload = await fetchF3Events(EVENTS_URL, API_KEY, API_CLIENT);
  }

  const { events, totalCount } = extractEvents(payload);

  if (Number.isFinite(totalCount) && totalCount > events.length) {
    throw new Error(
      `The F3 API reported ${totalCount} events but returned only ${events.length}; refusing to publish incomplete data.`,
    );
  }
  if (events.length === 0) {
    throw new Error(
      `The F3 API returned zero events from ${EVENTS_URL}. ` +
        `The API key was accepted, but this endpoint returned no data.`,
    );
  }

  const activeWorkoutEvents = events.filter(isActivePublicWorkout);
  const aos = buildAoDirectory(activeWorkoutEvents, fallbackAos);

  if (aos.length < MIN_AO_COUNT) {
    printDiagnosticSummary(events, activeWorkoutEvents, aos);
  }

  if (aos.length < MIN_AO_COUNT) {
    throw new Error(
      `The API produced only ${aos.length} matching AO records; refusing to replace the existing data. ` +
        `Expected at least ${MIN_AO_COUNT}. Check F3_REGION_NAMES and the API key's access.`,
    );
  }

  if (DRY_RUN) {
    console.log(`Dry run complete. ${aos.length} AO records validated; aos.json was not changed.`);
  } else {
    await writeJsonAtomically(outputPath, aos);
  }
  console.log(
    `F3 Nation sync complete: ${events.length} API events -> ` +
      `${activeWorkoutEvents.length} active public workout events -> ${aos.length} Midlands AOs.`,
  );
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`F3 Nation sync skipped: ${message}`);
  if (STRICT) process.exitCode = 1;
}

async function loadLocalEnv(filePath) {
  if (!existsSync(filePath)) return;

  const contents = await readFile(filePath, 'utf8');
  for (const line of contents.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const separator = trimmed.indexOf('=');
    if (separator < 1) continue;

    const key = trimmed.slice(0, separator).trim();
    let value = trimmed.slice(separator + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    if (!(key in process.env)) process.env[key] = value;
  }
}

async function fetchF3Events(url, apiKey, apiClient) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);

  try {
    const response = await fetch(url, {
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${apiKey}`,
        client: apiClient,
      },
      signal: controller.signal,
    });

    if (!response.ok) {
      const body = (await response.text()).replace(/\s+/g, ' ').slice(0, 300);
      throw new Error(`F3 API request failed with HTTP ${response.status}${body ? `: ${body}` : ''}`);
    }

    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
}

function extractEvents(payload) {
  const candidates = [
    payload,
    payload?.data,
    payload?.data?.json,
    payload?.json,
    payload?.result,
    payload?.result?.data,
    payload?.result?.data?.json,
  ];

  for (const candidate of candidates) {
    if (Array.isArray(candidate)) {
      return { events: candidate, totalCount: candidate.length };
    }

    if (Array.isArray(candidate?.events)) {
      const totalCount = Number(candidate.totalCount);
      return {
        events: candidate.events,
        totalCount: Number.isFinite(totalCount) ? totalCount : candidate.events.length,
      };
    }
  }

  throw new Error('The F3 API response did not contain an events array.');
}

function isActivePublicWorkout(event) {
  if (!event || toBoolean(event.isActive, true) === false || toBoolean(event.isPrivate, false) === true) {
    return false;
  }
  if (!event.dayOfWeek || !event.startTime) return false;

  const eventTypes = Array.isArray(event.eventTypes) ? event.eventTypes : [];
  if (eventTypes.length === 0) return true;

  return eventTypes.some((eventType) => isFirstFCategory(eventType?.eventCategory, eventType?.eventTypeName));
}

function isFirstFCategory(categoryValue, typeNameValue = '') {
  const category = normalizeText(categoryValue || '');
  const typeName = normalizeText(typeNameValue || '');

  if (!category) {
    return !/^2nd f|^second f|^3rd f|^third f/.test(typeName);
  }

  return (
    category === 'first f' ||
    category === '1st f' ||
    category === 'firstf' ||
    category.startsWith('first f ') ||
    category.startsWith('1st f ')
  );
}

function buildAoDirectory(events, fallbackAos) {
  const fallbackIndex = buildFallbackIndex(fallbackAos);
  const fallbackCityIndex = buildFallbackCityIndex(fallbackAos);
  const groups = new Map();

  for (const event of events) {
    const aoName = resolveAoName(event);
    if (!aoName) continue;

    const fallbackMatches = fallbackIndex.get(normalizeText(aoName)) || [];
    const region = resolveRegion(event, fallbackMatches, fallbackCityIndex);
    if (!region) continue;

    const day = normalizeDay(event.dayOfWeek);
    if (!day) continue;

    const startTime = normalize24HourTime(event.startTime);
    const endTime = normalize24HourTime(event.endTime);
    if (!startTime) continue;

    const workoutType = getWorkoutType(event, aoName);
    const location = cleanText(event.locationName) || cleanText(event.location) || 'See official F3 map';
    const streetAddress = joinNonEmpty([event.locationAddress, event.locationAddress2], ', ');
    const city = cleanText(event.locationCity);
    const stateZip = joinNonEmpty([event.locationState, event.locationZip], ' ');
    const locality = joinNonEmpty([city, stateZip], ', ');
    const address = joinNonEmpty([location, streetAddress, locality], ', ');
    const mapUrl = buildMapUrl(address || location);
    const time = formatTimeRange(startTime, endTime);

    const key = `${normalizeText(region)}|${normalizeText(aoName)}`;
    if (!groups.has(key)) {
      groups.set(key, {
        name: aoName,
        region,
        descriptions: new Set(),
        eventTypes: new Set(),
        sourceEventIds: new Set(),
        schedule: [],
        fallback: chooseFallback(fallbackMatches, region),
      });
    }

    const group = groups.get(key);
    const description = stripHtml(event.description);
    if (description) group.descriptions.add(description);
    if (workoutType) group.eventTypes.add(workoutType);
    if (event.id !== undefined && event.id !== null) group.sourceEventIds.add(event.id);

    const scheduleKey = [day, startTime, endTime, normalizeText(location), normalizeText(address)].join('|');
    if (!group.schedule.some((item) => item._key === scheduleKey)) {
      group.schedule.push({
        _key: scheduleKey,
        day,
        time,
        startTime,
        endTime,
        type: workoutType,
        location,
        address,
        streetAddress,
        city,
        latitude: null,
        longitude: null,
        mapUrl,
        sourceEventId: event.id ?? null,
      });
    }
  }

  return [...groups.values()]
    .map(finalizeAo)
    .sort((a, b) => {
      const regionDifference = TARGET_REGIONS.indexOf(a.region) - TARGET_REGIONS.indexOf(b.region);
      return regionDifference || a.name.localeCompare(b.name);
    });
}

function finalizeAo(group) {
  const schedule = group.schedule
    .sort((a, b) => {
      const dayDifference = DAY_ORDER.indexOf(a.day) - DAY_ORDER.indexOf(b.day);
      return dayDifference || a.startTime.localeCompare(b.startTime);
    })
    .map(({ _key, ...item }) => item);

  const first = schedule[0] || {};
  const days = unique(schedule.map((item) => item.day));
  const times = unique(schedule.map((item) => item.time));
  const eventTypes = unique([...group.eventTypes]);
  const type = eventTypes.length ? eventTypes.join(' / ') : 'Workout';
  const descriptions = unique([...group.descriptions]);
  const notes =
    descriptions.join(' ') ||
    cleanText(group.fallback?.notes) ||
    'Official active workout listing synced from F3 Nation.';

  const locations = uniqueBy(
    schedule.map((item) => ({
      location: item.location,
      address: item.address,
      streetAddress: item.streetAddress,
      city: item.city,
      latitude: item.latitude,
      longitude: item.longitude,
      mapUrl: item.mapUrl,
    })),
    (item) => normalizeText(item.address || item.location),
  );

  return {
    id: `${slugify(group.region)}-${slugify(group.name)}`,
    name: group.name,
    region: group.region,
    city: first.city || cleanText(group.fallback?.city),
    type,
    days: days.join(', '),
    time: times.join(', '),
    scheduleSummary: schedule.map((item) => `${item.day}: ${item.time}`).join('; '),
    location: first.location || cleanText(group.fallback?.location),
    address: first.address || cleanText(group.fallback?.address),
    streetAddress: first.streetAddress || cleanText(group.fallback?.streetAddress),
    latitude: null,
    longitude: null,
    notes,
    active: true,
    verified: true,
    showOnWebsite: true,
    needsReview: false,
    source: 'F3 Nation API',
    sourceUrl: 'https://map.f3nation.com/',
    mapUrl: first.mapUrl || buildMapUrl(first.address || first.location),
    apiEventIds: [...group.sourceEventIds].sort((a, b) => Number(a) - Number(b)),
    lastSyncedAt: syncTimestamp,
    schedule,
    locations,
  };
}

function resolveAoName(event) {
  return (
    cleanText(event?.parent) ||
    cleanText(event?.aoName) ||
    cleanText(event?.ao?.name) ||
    cleanText(event?.aos?.[0]?.aoName) ||
    cleanText(event?.parents?.[0]?.parentName) ||
    cleanText(event?.name)
  );
}

function resolveRegion(event, fallbackMatches, fallbackCityIndex) {
  const candidates = [
    event?.regionName,
    event?.region,
    event?.region?.name,
    ...(Array.isArray(event.regions) ? event.regions.map((item) => item?.regionName || item?.name) : []),
  ].filter(Boolean);

  for (const target of TARGET_REGIONS) {
    const targetNormalized = normalizeText(target);
    if (
      candidates.some((candidate) => {
        const normalized = normalizeText(candidate).replace(/^f3\s+/, '');
        return normalized.includes(targetNormalized) || targetNormalized.includes(normalized);
      })
    ) {
      return target;
    }
  }

  const fallbackRegions = unique(
    fallbackMatches.map((item) => item?.region).filter((region) => TARGET_REGIONS.includes(region)),
  );
  if (fallbackRegions.length === 1) return fallbackRegions[0];

  const city = normalizeText(event?.locationCity || event?.city);
  return city ? fallbackCityIndex.get(city) || null : null;
}

function getWorkoutType(event, aoName) {
  const names = unique(
    (Array.isArray(event.eventTypes) ? event.eventTypes : [])
      .filter((item) => {
        return isFirstFCategory(item?.eventCategory, item?.eventTypeName);
      })
      .map((item) => cleanText(item?.eventTypeName))
      .filter(Boolean),
  );

  if (names.length) return names.join(' / ');
  const eventName = cleanText(event.name);
  return eventName && normalizeText(eventName) !== normalizeText(aoName) ? eventName : 'Workout';
}

function buildFallbackIndex(aos) {
  const index = new Map();
  for (const ao of Array.isArray(aos) ? aos : []) {
    const key = normalizeText(ao?.name);
    if (!key) continue;
    if (!index.has(key)) index.set(key, []);
    index.get(key).push(ao);
  }
  return index;
}

function buildFallbackCityIndex(aos) {
  const regionSets = new Map();

  for (const ao of Array.isArray(aos) ? aos : []) {
    const city = normalizeText(ao?.city);
    const region = cleanText(ao?.region);
    if (!city || !TARGET_REGIONS.includes(region)) continue;
    if (!regionSets.has(city)) regionSets.set(city, new Set());
    regionSets.get(city).add(region);
  }

  const index = new Map();
  for (const [city, regions] of regionSets) {
    if (regions.size === 1) index.set(city, [...regions][0]);
  }
  return index;
}

function chooseFallback(matches, region) {
  return matches.find((item) => item?.region === region) || matches[0] || null;
}

function printDiagnosticSummary(events, activeWorkoutEvents, aos) {
  const categories = unique(
    events.flatMap((event) =>
      (Array.isArray(event?.eventTypes) ? event.eventTypes : []).map(
        (item) => cleanText(item?.eventCategory) || '(blank)',
      ),
    ),
  ).slice(0, 20);

  const regions = unique(
    events.flatMap((event) => [
      cleanText(event?.regionName),
      typeof event?.region === 'string' ? cleanText(event.region) : cleanText(event?.region?.name),
      ...(Array.isArray(event?.regions)
        ? event.regions.map((item) => cleanText(item?.regionName || item?.name))
        : []),
    ]),
  )
    .filter(Boolean)
    .slice(0, 40);

  const sample = events.slice(0, 5).map((event) => ({
    id: event?.id ?? null,
    name: cleanText(event?.name),
    parent: cleanText(event?.parent || event?.parents?.[0]?.parentName),
    dayOfWeek: cleanText(event?.dayOfWeek),
    startTime: cleanText(event?.startTime),
    regions: Array.isArray(event?.regions)
      ? event.regions.map((item) => cleanText(item?.regionName || item?.name)).filter(Boolean)
      : [],
    categories: Array.isArray(event?.eventTypes)
      ? event.eventTypes.map((item) => cleanText(item?.eventCategory)).filter(Boolean)
      : [],
  }));

  console.error(
    `F3 API diagnostics: ${events.length} total events, ` +
      `${activeWorkoutEvents.length} active public scheduled 1st F events, ${aos.length} matched AOs.`,
  );
  console.error(`F3 API categories seen: ${categories.join(', ') || '(none)'}`);
  console.error(`F3 API regions seen: ${regions.join(', ') || '(none)'}`);
  console.error(`F3 API sample events: ${JSON.stringify(sample)}`);
}

function toBoolean(value, fallback) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    if (/^true$/i.test(value)) return true;
    if (/^false$/i.test(value)) return false;
  }
  return fallback;
}

async function readExistingAos() {
  try {
    const parsed = JSON.parse(await readFile(outputPath, 'utf8'));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function writeJsonAtomically(filePath, value) {
  const temporaryPath = `${filePath}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  await rename(temporaryPath, filePath);
}

function parseRegionNames(value) {
  const regions = unique(
    value
      .split(',')
      .map((item) => cleanText(item))
      .filter(Boolean),
  );
  if (!regions.length) throw new Error('F3_REGION_NAMES must contain at least one region.');
  return regions;
}

function parsePositiveInteger(value, fallback) {
  const parsed = Number.parseInt(value || '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function normalizeDay(value) {
  const normalized = normalizeText(value);
  return DAY_ORDER.find((day) => normalizeText(day) === normalized) || null;
}

function normalize24HourTime(value) {
  const match = String(value || '').match(/^(\d{1,2}):(\d{2})/);
  if (!match) return '';
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return '';
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

function formatTimeRange(startTime, endTime) {
  const start = format12HourTime(startTime);
  const end = format12HourTime(endTime);
  return end ? `${start} - ${end}` : start;
}

function format12HourTime(value) {
  const [hourText, minuteText] = String(value || '').split(':');
  const hour = Number(hourText);
  const minute = Number(minuteText);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return '';
  const suffix = hour >= 12 ? 'PM' : 'AM';
  const displayHour = hour % 12 || 12;
  return `${displayHour}:${String(minute).padStart(2, '0')} ${suffix}`;
}

function buildMapUrl(query) {
  return query
    ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`
    : 'https://map.f3nation.com/';
}

function stripHtml(value) {
  return cleanText(
    String(value || '')
      .replace(/<br\s*\/?>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/gi, ' ')
      .replace(/&amp;/gi, '&')
      .replace(/&quot;/gi, '"')
      .replace(/&#39;/gi, "'"),
  );
}

function cleanText(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function normalizeText(value) {
  return cleanText(value)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function slugify(value) {
  return normalizeText(value).replace(/\s+/g, '-') || 'ao';
}

function joinNonEmpty(values, separator) {
  return values.map(cleanText).filter(Boolean).join(separator);
}

function unique(values) {
  return [...new Set(values)];
}

function uniqueBy(values, keyFunction) {
  const seen = new Set();
  return values.filter((value) => {
    const key = keyFunction(value);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
