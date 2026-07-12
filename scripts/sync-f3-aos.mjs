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
const API_KEY = process.env.F3_NATION_API_KEY?.trim();
const API_CLIENT = process.env.F3_API_CLIENT?.trim() || 'f3-midlands-site';
const TARGET_ORG_IDS = parseIntegerList(process.env.F3_TARGET_ORG_IDS || '');
const TARGET_ORG_NAMES = parseCsv(
  process.env.F3_TARGET_ORG_NAMES || 'Lexington,Columbia,Lake Murray,Camden,Saluda',
);
const MIN_AO_COUNT = parsePositiveInteger(process.env.F3_MIN_AO_COUNT, 5);
const DRY_RUN = /^true$/i.test(process.env.F3_SYNC_DRY_RUN || 'false');
const FIXTURE_DIR = process.env.F3_API_FIXTURE_DIR
  ? path.resolve(repositoryRoot, process.env.F3_API_FIXTURE_DIR)
  : null;
const DAY_ORDER = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const syncTimestamp = new Date().toISOString();

if (!API_KEY && !FIXTURE_DIR) {
  fail('F3_NATION_API_KEY is not set. No generated AO data was written.');
}

try {
  const payloads = FIXTURE_DIR
    ? await loadFixturePayloads(FIXTURE_DIR)
    : await fetchAllSourcePayloads();

  const regions = extractCollection(payloads.regions, 'orgs');
  const areas = extractCollection(payloads.areas, 'orgs');
  const sectors = extractCollection(payloads.sectors, 'orgs');
  const aos = extractCollection(payloads.aos, 'orgs');
  const events = extractCollection(payloads.events, 'events');
  const markerRows = extractArrayPayload(payloads.markers);

  const allOrgs = [...regions, ...areas, ...sectors, ...aos];
  const orgById = new Map(allOrgs.map((org) => [Number(org.id), org]));
  const targetOrgs = resolveTargetOrganizations(allOrgs);
  const targetOrgIds = new Set(targetOrgs.map((org) => Number(org.id)));
  const targetById = new Map(targetOrgs.map((org) => [Number(org.id), org]));

  console.log(
    `F3 target organizations: ${targetOrgs
      .map((org) => `${org.name} [${org.orgType} #${org.id}]`)
      .join(', ')}`,
  );

  const aoAssignments = new Map();
  for (const ao of aos) {
    if (toBoolean(ao.isActive, true) === false) continue;
    const target = findTargetAncestor(ao, orgById, targetOrgIds, targetById);
    if (target) aoAssignments.set(Number(ao.id), target);
  }

  const targetAoIds = new Set(aoAssignments.keys());
  const targetEvents = events.filter((event) => {
    if (!isActivePublicFirstFEvent(event)) return false;
    const parentIds = getEventAoIds(event);
    return parentIds.some((id) => targetAoIds.has(id));
  });

  const markers = buildMarkerIndex(markerRows);
  const directory = buildDirectory({
    aos,
    events: targetEvents,
    markers,
    aoAssignments,
    targetOrgs,
  });

  if (directory.length < MIN_AO_COUNT) {
    printDiagnostics({
      allOrgs,
      targetOrgs,
      aos,
      aoAssignments,
      events,
      targetEvents,
      directory,
    });
    throw new Error(
      `F3 Nation produced ${directory.length} active AO listings for the configured organizations; ` +
        `expected at least ${MIN_AO_COUNT}. The existing deployed site was not replaced.`,
    );
  }

  if (DRY_RUN) {
    console.log(`Dry run complete: ${directory.length} API-backed AO listings validated.`);
  } else {
    await writeJsonAtomically(outputPath, directory);
  }

  const counts = countBy(directory, (ao) => ao.region);
  console.log(
    `F3 Nation sync complete: ${directory.length} active AO listings from ${targetEvents.length} active public 1st F events.`,
  );
  console.log(`F3 Nation AO counts: ${Object.entries(counts).map(([name, count]) => `${name}=${count}`).join(', ')}`);
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}

async function fetchAllSourcePayloads() {
  const urls = {
    regions: `${API_BASE_URL}/org?orgTypes=region&statuses=active`,
    areas: `${API_BASE_URL}/org?orgTypes=area&statuses=active`,
    sectors: `${API_BASE_URL}/org?orgTypes=sector&statuses=active`,
    aos: `${API_BASE_URL}/org?orgTypes=ao&statuses=active`,
    events: `${API_BASE_URL}/map/event/all?statuses=active&eventCategories=first_f`,
    markers: `${API_BASE_URL}/map/location/events-and-locations`,
  };

  const entries = await Promise.all(
    Object.entries(urls).map(async ([key, url]) => [key, await fetchJson(url)]),
  );
  return Object.fromEntries(entries);
}

async function fetchJson(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 45_000);

  try {
    const response = await fetch(url, {
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${API_KEY}`,
        client: API_CLIENT,
      },
      signal: controller.signal,
    });

    if (!response.ok) {
      const body = (await response.text()).replace(/\s+/g, ' ').slice(0, 500);
      throw new Error(`F3 API request failed: ${response.status} ${url}${body ? ` — ${body}` : ''}`);
    }

    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
}

async function loadFixturePayloads(directory) {
  const filenames = {
    regions: 'regions.json',
    areas: 'areas.json',
    sectors: 'sectors.json',
    aos: 'aos.json',
    events: 'events.json',
    markers: 'markers.json',
  };

  const entries = await Promise.all(
    Object.entries(filenames).map(async ([key, filename]) => {
      const filePath = path.join(directory, filename);
      return [key, JSON.parse(await readFile(filePath, 'utf8'))];
    }),
  );
  console.log(`Using F3 API fixture directory: ${path.relative(repositoryRoot, directory)}`);
  return Object.fromEntries(entries);
}

function resolveTargetOrganizations(allOrgs) {
  const eligible = allOrgs.filter(
    (org) => org && org.id != null && org.orgType !== 'ao' && toBoolean(org.isActive, true) !== false,
  );

  if (TARGET_ORG_IDS.length) {
    const byId = new Map(eligible.map((org) => [Number(org.id), org]));
    const missing = TARGET_ORG_IDS.filter((id) => !byId.has(id));
    if (missing.length) {
      throw new Error(`Configured F3_TARGET_ORG_IDS were not found or inactive: ${missing.join(', ')}`);
    }
    return TARGET_ORG_IDS.map((id) => byId.get(id));
  }

  if (!TARGET_ORG_NAMES.length) {
    throw new Error('Set F3_TARGET_ORG_NAMES or F3_TARGET_ORG_IDS to define the official F3 organizations shown on the site.');
  }

  const resolved = [];
  for (const requestedName of TARGET_ORG_NAMES) {
    const requestedKey = canonicalOrgName(requestedName);
    const exact = eligible.filter((org) => canonicalOrgName(org.name) === requestedKey);

    if (exact.length === 1) {
      resolved.push(exact[0]);
      continue;
    }

    const tokenMatches = eligible.filter((org) => {
      const candidate = canonicalOrgName(org.name);
      return candidate === requestedKey || candidate.endsWith(` ${requestedKey}`) || candidate.startsWith(`${requestedKey} `);
    });

    if (tokenMatches.length === 1) {
      resolved.push(tokenMatches[0]);
      continue;
    }

    const candidates = [...exact, ...tokenMatches]
      .filter((org, index, array) => array.findIndex((item) => item.id === org.id) === index)
      .map((org) => `${org.name} [${org.orgType} #${org.id}]`);

    if (candidates.length > 1) {
      throw new Error(
        `F3 target name "${requestedName}" is ambiguous. Set F3_TARGET_ORG_IDS instead. Matches: ${candidates.join(', ')}`,
      );
    }

    const suggestions = eligible
      .filter((org) => canonicalOrgName(org.name).includes(requestedKey) || requestedKey.includes(canonicalOrgName(org.name)))
      .slice(0, 10)
      .map((org) => `${org.name} [${org.orgType} #${org.id}]`);
    throw new Error(
      `Official F3 organization "${requestedName}" was not found. ` +
        `${suggestions.length ? `Possible matches: ${suggestions.join(', ')}` : 'Use F3_TARGET_ORG_IDS for exact selection.'}`,
    );
  }

  return uniqueBy(resolved, (org) => Number(org.id));
}

function findTargetAncestor(ao, orgById, targetOrgIds, targetById) {
  let currentId = Number(ao.parentId);
  const visited = new Set();

  while (Number.isFinite(currentId) && currentId > 0 && !visited.has(currentId)) {
    visited.add(currentId);
    if (targetOrgIds.has(currentId)) return targetById.get(currentId);
    const parent = orgById.get(currentId);
    if (!parent || parent.parentId == null) return null;
    currentId = Number(parent.parentId);
  }

  return null;
}

function buildDirectory({ aos, events, markers, aoAssignments, targetOrgs }) {
  const eventsByAoId = new Map();
  for (const event of events) {
    for (const aoId of getEventAoIds(event)) {
      if (!aoAssignments.has(aoId)) continue;
      if (!eventsByAoId.has(aoId)) eventsByAoId.set(aoId, []);
      eventsByAoId.get(aoId).push(event);
    }
  }

  const directory = [];
  for (const ao of aos) {
    const aoId = Number(ao.id);
    const target = aoAssignments.get(aoId);
    const aoEvents = eventsByAoId.get(aoId) || [];
    if (!target || aoEvents.length === 0) continue;

    const schedules = aoEvents
      .map((event) => buildSchedule(event, markers))
      .filter(Boolean)
      .sort(compareSchedules);

    if (!schedules.length) continue;

    const first = schedules[0];
    const eventTypeNames = unique(
      aoEvents.flatMap((event) =>
        (Array.isArray(event.eventTypes) ? event.eventTypes : [])
          .filter((type) => isFirstFCategory(type?.eventCategory))
          .map((type) => cleanText(type?.eventTypeName))
          .filter(Boolean),
      ),
    );
    const eventDescriptions = unique(aoEvents.map((event) => stripHtml(event.description)).filter(Boolean));
    const locations = uniqueBy(
      schedules.map((schedule) => ({
        locationId: schedule.locationId,
        location: schedule.location,
        address: schedule.address,
        streetAddress: schedule.streetAddress,
        city: schedule.city,
        state: schedule.state,
        zip: schedule.zip,
        latitude: schedule.latitude,
        longitude: schedule.longitude,
        mapUrl: schedule.mapUrl,
        f3MapUrl: schedule.f3MapUrl,
        locationLogoUrl: schedule.locationLogoUrl,
      })),
      (location) => location.locationId || `${location.latitude}|${location.longitude}|${location.address}`,
    );

    const days = unique(schedules.map((schedule) => schedule.day));
    const times = unique(schedules.map((schedule) => schedule.time));
    const officialDescription = stripHtml(ao.description);

    directory.push({
      id: `f3-ao-${aoId}`,
      apiAoId: aoId,
      name: cleanText(ao.name),
      region: cleanText(target.name),
      regionId: Number(target.id),
      regionType: cleanText(target.orgType),
      city: first.city,
      type: eventTypeNames.join(' / ') || '1st F Workout',
      days: days.join(', '),
      time: times.join(', '),
      scheduleSummary: schedules.map((schedule) => `${schedule.day}: ${schedule.time}`).join('; '),
      location: first.location,
      address: first.address,
      streetAddress: first.streetAddress,
      latitude: first.latitude,
      longitude: first.longitude,
      notes: officialDescription || eventDescriptions.join(' ') || 'Official active AO from F3 Nation.',
      active: toBoolean(ao.isActive, true),
      verified: true,
      showOnWebsite: true,
      needsReview: false,
      mapUrl: first.mapUrl,
      f3MapUrl: first.f3MapUrl,
      website: cleanText(ao.website),
      email: cleanText(ao.email),
      phone: cleanText(ao.phone),
      logoUrl: cleanText(ao.logoUrl),
      twitter: cleanText(ao.twitter),
      facebook: cleanText(ao.facebook),
      instagram: cleanText(ao.instagram),
      lastAnnualReview: ao.lastAnnualReview || null,
      meta: ao.meta ?? null,
      created: ao.created || null,
      source: 'F3 Nation API',
      sourceUrl: first.f3MapUrl || 'https://map.f3nation.com/',
      apiEventIds: unique(aoEvents.map((event) => Number(event.id)).filter(Number.isFinite)).sort((a, b) => a - b),
      lastSyncedAt: syncTimestamp,
      schedule: schedules,
      locations,
      official: {
        ao: copyOfficialOrgFields(ao),
        organization: copyOfficialOrgFields(target),
        events: aoEvents.map(copyOfficialEventFields),
      },
    });
  }

  const targetOrder = new Map(targetOrgs.map((org, index) => [Number(org.id), index]));
  return directory.sort((left, right) => {
    const orderDifference = (targetOrder.get(left.regionId) ?? 999) - (targetOrder.get(right.regionId) ?? 999);
    return orderDifference || left.name.localeCompare(right.name);
  });
}


function buildSchedule(event, markers) {
  const day = normalizeDay(event.dayOfWeek);
  const startTime = normalize24HourTime(event.startTime);
  if (!day || !startTime) return null;

  const endTime = normalize24HourTime(event.endTime);
  const marker = markers.get(Number(event.locationId));
  const locationName = cleanText(event.locationName) || marker?.name || 'Official F3 Nation location';
  const address = cleanText(event.location) || marker?.fullAddress || buildAddressFromEvent(event);
  const latitude = finiteNumber(marker?.latitude);
  const longitude = finiteNumber(marker?.longitude);
  const mapUrl = buildDirectionsUrl(latitude, longitude, address);
  const f3MapUrl = buildF3MapUrl(latitude, longitude);
  const eventTypes = unique(
    (Array.isArray(event.eventTypes) ? event.eventTypes : [])
      .filter((type) => isFirstFCategory(type?.eventCategory))
      .map((type) => cleanText(type?.eventTypeName))
      .filter(Boolean),
  );

  return {
    sourceEventId: Number(event.id),
    eventName: cleanText(event.name),
    description: stripHtml(event.description),
    day,
    time: formatTimeRange(startTime, endTime),
    startTime,
    endTime,
    type: eventTypes.join(' / ') || cleanText(event.name) || '1st F Workout',
    locationId: Number(event.locationId),
    location: locationName,
    address,
    streetAddress: joinNonEmpty([event.locationAddress, event.locationAddress2], ', '),
    city: cleanText(event.locationCity),
    state: cleanText(event.locationState),
    zip: cleanText(event.locationZip),
    latitude,
    longitude,
    mapUrl,
    f3MapUrl,
    contactEmail: cleanText(event.email),
    locationLogoUrl: marker?.logo || '',
    eventTypes: (Array.isArray(event.eventTypes) ? event.eventTypes : []).map((type) => ({
      id: Number(type?.eventTypeId ?? type?.id),
      name: cleanText(type?.eventTypeName ?? type?.name),
      category: cleanText(type?.eventCategory),
    })),
  };
}

function buildMarkerIndex(rows) {
  const index = new Map();
  for (const row of rows) {
    if (Array.isArray(row)) {
      const [id, name, logo, latitude, longitude, fullAddress] = row;
      index.set(Number(id), {
        id: Number(id),
        name: cleanText(name),
        logo: cleanText(logo),
        latitude: finiteNumber(latitude),
        longitude: finiteNumber(longitude),
        fullAddress: cleanText(fullAddress),
      });
      continue;
    }

    if (row && row.id != null) {
      index.set(Number(row.id), {
        id: Number(row.id),
        name: cleanText(row.name || row.locationName),
        logo: cleanText(row.logo || row.logoUrl),
        latitude: finiteNumber(row.lat ?? row.latitude),
        longitude: finiteNumber(row.lon ?? row.longitude),
        fullAddress: cleanText(row.fullAddress || row.location || row.address),
      });
    }
  }
  return index;
}

function getEventAoIds(event) {
  const ids = [];
  if (Array.isArray(event?.parents)) {
    for (const parent of event.parents) {
      const id = Number(parent?.parentId ?? parent?.aoId ?? parent?.id);
      if (Number.isFinite(id)) ids.push(id);
    }
  }
  if (Array.isArray(event?.aos)) {
    for (const ao of event.aos) {
      const id = Number(ao?.aoId ?? ao?.id);
      if (Number.isFinite(id)) ids.push(id);
    }
  }
  const direct = Number(event?.aoId ?? event?.parentId);
  if (Number.isFinite(direct)) ids.push(direct);
  return unique(ids);
}

function isActivePublicFirstFEvent(event) {
  if (!event || toBoolean(event.isActive, true) === false || toBoolean(event.isPrivate, false) === true) return false;
  if (!event.dayOfWeek || !event.startTime || event.locationId == null) return false;
  const types = Array.isArray(event.eventTypes) ? event.eventTypes : [];
  return types.length === 0 || types.some((type) => isFirstFCategory(type?.eventCategory));
}

function isFirstFCategory(value) {
  const normalized = normalizeText(value).replace(/[_-]+/g, ' ');
  return !normalized || normalized === 'first f' || normalized === '1st f' || normalized === 'firstf';
}

function extractCollection(payload, key) {
  const candidates = unwrapCandidates(payload);
  for (const candidate of candidates) {
    if (Array.isArray(candidate?.[key])) return candidate[key];
    if (Array.isArray(candidate)) return candidate;
  }
  throw new Error(`F3 API response did not contain a ${key} array.`);
}

function extractArrayPayload(payload) {
  for (const candidate of unwrapCandidates(payload)) {
    if (Array.isArray(candidate)) return candidate;
  }
  throw new Error('F3 API map-location response did not contain an array.');
}

function unwrapCandidates(payload) {
  return [
    payload,
    payload?.data,
    payload?.data?.json,
    payload?.json,
    payload?.result,
    payload?.result?.data,
    payload?.result?.data?.json,
  ].filter((value) => value != null);
}

function copyOfficialOrgFields(org) {
  return {
    id: Number(org.id),
    parentId: org.parentId == null ? null : Number(org.parentId),
    name: cleanText(org.name),
    orgType: cleanText(org.orgType),
    defaultLocationId: org.defaultLocationId == null ? null : Number(org.defaultLocationId),
    description: stripHtml(org.description),
    isActive: toBoolean(org.isActive, true),
    logoUrl: cleanText(org.logoUrl),
    website: cleanText(org.website),
    email: cleanText(org.email),
    phone: cleanText(org.phone),
    twitter: cleanText(org.twitter),
    facebook: cleanText(org.facebook),
    instagram: cleanText(org.instagram),
    lastAnnualReview: org.lastAnnualReview || null,
    aoCount: org.aoCount == null ? null : Number(org.aoCount),
    meta: org.meta ?? null,
    created: org.created || null,
  };
}

function copyOfficialEventFields(event) {
  return {
    id: Number(event.id),
    name: cleanText(event.name),
    description: stripHtml(event.description),
    isActive: toBoolean(event.isActive, true),
    isPrivate: toBoolean(event.isPrivate, false),
    parent: cleanText(event.parent),
    locationId: event.locationId == null ? null : Number(event.locationId),
    startDate: event.startDate || null,
    dayOfWeek: cleanText(event.dayOfWeek),
    startTime: cleanText(event.startTime),
    endTime: cleanText(event.endTime),
    email: cleanText(event.email),
    created: event.created || null,
    locationName: cleanText(event.locationName),
    locationAddress: cleanText(event.locationAddress),
    locationAddress2: cleanText(event.locationAddress2),
    locationCity: cleanText(event.locationCity),
    locationState: cleanText(event.locationState),
    locationZip: cleanText(event.locationZip),
    location: cleanText(event.location),
    parents: Array.isArray(event.parents) ? event.parents : [],
    regions: Array.isArray(event.regions) ? event.regions : [],
    eventTypes: Array.isArray(event.eventTypes) ? event.eventTypes : [],
  };
}

function printDiagnostics({ allOrgs, targetOrgs, aos, aoAssignments, events, targetEvents, directory }) {
  console.error(
    `F3 diagnostics: ${allOrgs.length} active organizations fetched; ${targetOrgs.length} target organizations; ` +
      `${aos.length} active AOs; ${aoAssignments.size} descendant AOs; ${events.length} active API events; ` +
      `${targetEvents.length} target events; ${directory.length} publishable AO listings.`,
  );
  console.error(
    `Target descendants without matching events: ${[...aoAssignments.keys()]
      .filter((aoId) => !targetEvents.some((event) => getEventAoIds(event).includes(aoId)))
      .slice(0, 30)
      .join(', ') || '(none)'}`,
  );
  console.error(
    `Target event time samples: ${targetEvents
      .slice(0, 12)
      .map((event) => `${event.startTime ?? '(none)'}-${event.endTime ?? '(none)'}`)
      .join(', ') || '(none)'}`,
  );
}

function canonicalOrgName(value) {
  return normalizeText(value)
    .replace(/^f3\s+/, '')
    .replace(/\b(?:region|area|sector)\b/g, ' ')
    .replace(/\b(?:south carolina|sc)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function compareSchedules(left, right) {
  const dayDifference = DAY_ORDER.indexOf(left.day) - DAY_ORDER.indexOf(right.day);
  return dayDifference || left.startTime.localeCompare(right.startTime) || left.location.localeCompare(right.location);
}

function buildAddressFromEvent(event) {
  return joinNonEmpty(
    [
      event.locationName,
      joinNonEmpty([event.locationAddress, event.locationAddress2], ', '),
      joinNonEmpty([event.locationCity, event.locationState, event.locationZip], ', '),
    ],
    ', ',
  );
}

function buildDirectionsUrl(latitude, longitude, address) {
  const destination = Number.isFinite(latitude) && Number.isFinite(longitude)
    ? `${latitude},${longitude}`
    : cleanText(address);
  return destination
    ? `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(destination)}`
    : 'https://map.f3nation.com/';
}

function buildF3MapUrl(latitude, longitude) {
  return Number.isFinite(latitude) && Number.isFinite(longitude)
    ? `https://map.f3nation.com/?lat=${latitude}&lng=${longitude}&zoom=16`
    : 'https://map.f3nation.com/';
}

function normalizeDay(value) {
  const normalized = normalizeText(value);
  const match = DAY_ORDER.find((day) => day.toLowerCase() === normalized || day.toLowerCase().startsWith(normalized.slice(0, 3)));
  return match || '';
}

function normalize24HourTime(value) {
  const raw = cleanText(value);
  if (!raw) return '';

  // F3 Nation currently returns compact database-style times such as "0530"
  // and "0615" from the map event endpoint. Keep support for colon-delimited
  // values as well because other endpoints and fixtures may return "05:30"
  // or "05:30:00".
  const compact = raw.replace(/\s+/g, '');

  let hours;
  let minutes;

  const compactMatch = compact.match(/^(\d{3,4})$/);
  if (compactMatch) {
    const padded = compactMatch[1].padStart(4, '0');
    hours = Number(padded.slice(0, 2));
    minutes = Number(padded.slice(2, 4));
  } else {
    const colonMatch = compact.match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
    if (colonMatch) {
      hours = Number(colonMatch[1]);
      minutes = Number(colonMatch[2]);
    } else {
      const twelveHourMatch = raw.match(/^(\d{1,2}):(\d{2})\s*([ap]m)$/i);
      if (!twelveHourMatch) return '';
      hours = Number(twelveHourMatch[1]);
      minutes = Number(twelveHourMatch[2]);
      if (hours < 1 || hours > 12) return '';
      const suffix = twelveHourMatch[3].toLowerCase();
      hours = hours % 12 + (suffix === 'pm' ? 12 : 0);
    }
  }

  if (!Number.isInteger(hours) || !Number.isInteger(minutes) || hours > 23 || minutes > 59) return '';
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

function formatTimeRange(startTime, endTime) {
  const start = formatClockTime(startTime);
  const end = formatClockTime(endTime);
  return end ? `${start} - ${end}` : start;
}

function formatClockTime(time) {
  if (!time) return '';
  const [hourText, minuteText] = time.split(':');
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const suffix = hour >= 12 ? 'PM' : 'AM';
  const displayHour = hour % 12 || 12;
  return `${displayHour}:${String(minute).padStart(2, '0')} ${suffix}`;
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
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}

async function writeJsonAtomically(filePath, value) {
  const temporaryPath = `${filePath}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  await rename(temporaryPath, filePath);
}

function parseCsv(value) {
  return value.split(',').map((item) => item.trim()).filter(Boolean);
}

function parseIntegerList(value) {
  return parseCsv(value).map(Number).filter((number) => Number.isInteger(number) && number > 0);
}

function parsePositiveInteger(value, fallback) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : fallback;
}

function finiteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function cleanText(value) {
  return value == null ? '' : String(value).replace(/\s+/g, ' ').trim();
}

function normalizeText(value) {
  return cleanText(value)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function stripHtml(value) {
  return cleanText(value)
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim();
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
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function countBy(values, keyFunction) {
  return values.reduce((counts, value) => {
    const key = keyFunction(value);
    counts[key] = (counts[key] || 0) + 1;
    return counts;
  }, {});
}

function toBoolean(value, fallback) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    if (/^true$/i.test(value)) return true;
    if (/^false$/i.test(value)) return false;
  }
  return fallback;
}

function fail(message) {
  console.error(`F3 Nation sync failed: ${message}`);
  process.exit(1);
}
