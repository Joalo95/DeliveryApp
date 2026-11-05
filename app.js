const STORAGE_KEYS = {
  orders: 'mesa-lista.orders.v1',
  merchant: 'mesa-lista.merchant.v1',
};

const form = document.querySelector('#order-form');
const merchantInput = document.querySelector('#merchant');
const customerInput = document.querySelector('#customer');
const contactInput = document.querySelector('#contact');
const addressInput = document.querySelector('#address');
const cornerInput = document.querySelector('#corner');
const sharedLocationInput = document.querySelector('#shared-location');
const sharedLocationStatus = document.querySelector('#shared-location-status');
const addressSuggestions = document.querySelector('#address-suggestions');
const cornerSuggestions = document.querySelector('#corner-suggestions');
const addressSearch = document.querySelector('.address-search');
const amountInput = document.querySelector('#amount');
const notesInput = document.querySelector('#notes');
const locationStatus = document.querySelector('#location-status');
const cornerStatus = document.querySelector('#corner-status');
const mapFrame = document.querySelector('#map-frame');
const mapTiles = document.querySelector('#map-tiles');
const mapLabel = document.querySelector('#map-label');
const ordersBody = document.querySelector('#orders-body');
const emptyState = document.querySelector('#empty-state');
const toast = document.querySelector('#toast');

const currencyFormatter = new Intl.NumberFormat('es-UY', {
  style: 'currency',
  currency: 'UYU',
  minimumFractionDigits: 2,
});
const dateFormatter = new Intl.DateTimeFormat('es-UY', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
});
const timeFormatter = new Intl.DateTimeFormat('es-UY', {
  hour: '2-digit',
  minute: '2-digit',
});

let orders = readStoredOrders();
let resolvedLocation = null;
let toastTimer;
let addressSearchTimer;
let addressSearchController = null;
let addressMatches = [];
let highlightedSuggestion = -1;
let cornerSearchTimer;
let cornerSearchController = null;
let cornerMatches = [];
let highlightedCornerSuggestion = -1;
let automaticLocateTimer;
let sharedLocationTimer;
let sharedLocationController = null;
let lastProcessedSharedLink = '';
const osmWayCache = new Map();
const photonQueryCache = new Map();

function readStoredOrders() {
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEYS.orders) || '[]');
    return Array.isArray(stored) ? stored : [];
  } catch {
    return [];
  }
}

function saveOrders() {
  try {
    localStorage.setItem(STORAGE_KEYS.orders, JSON.stringify(orders));
  } catch {
    showToast('No se pudieron guardar los pedidos en este navegador.', true);
  }
}

function localDateKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function showToast(message, isError = false, action = null) {
  window.clearTimeout(toastTimer);
  toast.replaceChildren(document.createTextNode(message));
  if (action) {
    const link = document.createElement('a');
    link.href = action.href;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.textContent = action.label;
    toast.append(' ', link);
  }
  toast.classList.toggle('is-error', isError);
  toast.classList.add('is-visible');
  toastTimer = window.setTimeout(() => toast.classList.remove('is-visible'), 3000);
}

function updateMerchantIndicator() {
  const savedMerchant = merchantInput.value.trim();
  document.querySelector('#merchant-indicator').textContent = savedMerchant || 'Aún sin comercio';
}

function saveMerchantPreference() {
  updateMerchantIndicator();
  try {
    localStorage.setItem(STORAGE_KEYS.merchant, merchantInput.value.trim());
  } catch {
    // The form remains usable when browser storage is disabled.
  }
}

function updateDashboard() {
  const todayOrders = orders.filter((order) => order.dateKey === localDateKey());
  document.querySelector('#today-count').textContent = String(todayOrders.length);
  document.querySelector('#total-orders').textContent = `${orders.length} ${orders.length === 1 ? 'pedido' : 'pedidos'}`;
  document.querySelector('#today-label').textContent = new Intl.DateTimeFormat('es-UY', {
    weekday: 'long', day: 'numeric', month: 'long',
  }).format(new Date());
  updateMerchantIndicator();
  renderOrders();
}

function appendCell(row, value, className = '') {
  const cell = document.createElement('td');
  cell.textContent = value;
  if (className) cell.className = className;
  row.append(cell);
}

function renderOrders() {
  ordersBody.replaceChildren();
  const sortedOrders = [...orders].sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  for (const order of sortedOrders) {
    const row = document.createElement('tr');
    appendCell(row, timeFormatter.format(new Date(order.createdAt)));
    appendCell(row, order.customer);
    appendCell(row, order.address);
    appendCell(row, order.contact);
    appendCell(row, order.paymentMethod || 'EFECTIVO');
    appendCell(row, `${Number(order.latitude).toFixed(5)}, ${Number(order.longitude).toFixed(5)}`, 'coordinates');
    appendCell(row, currencyFormatter.format(order.amount));
    appendCell(row, order.notes || '—');
    ordersBody.append(row);
  }

  emptyState.hidden = orders.length > 0;
}

function countWords(text) {
  return text.trim() ? text.trim().split(/\s+/).length : 0;
}

function updateWordCount() {
  const words = countWords(notesInput.value);
  document.querySelector('#word-count').textContent = String(words);
  if (words > 20) {
    const trimmed = notesInput.value.trim().split(/\s+/).slice(0, 20).join(' ');
    notesInput.value = trimmed;
    document.querySelector('#word-count').textContent = '20';
    showToast('Las observaciones tienen un máximo de 20 palabras.', true);
  }
}

function parseAmount(value) {
  const normalized = value.replace(/\./g, '').replace(',', '.');
  return Number(normalized);
}

function formatAmountInput() {
  const raw = amountInput.value.trim();
  if (!raw || !amountInput.validity.valid) return;
  const amount = parseAmount(raw);
  if (Number.isFinite(amount)) {
    amountInput.value = new Intl.NumberFormat('es-UY', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amount);
  }
}

function isDuraznoCity(place) {
  const cityFields = [place.city, place.town, place.village, place.municipality, place.locality]
    .filter(Boolean)
    .map((value) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase());
  const countryCode = (place.countrycode || place.country_code || '').toLowerCase();
  const country = (place.country || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  return (countryCode === 'uy' || country === 'uruguay') && cityFields.includes('durazno');
}

function parseCoordinates(value) {
  if (!value) return null;
  const match = value.match(/(-?\d{1,2}(?:\.\d+)?)\s*[,;]\s*(-?\d{1,3}(?:\.\d+)?)/);
  if (!match) return null;
  const latitude = Number(match[1]);
  const longitude = Number(match[2]);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)
    || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return null;
  return { latitude, longitude };
}

function parseSharedMapLink(value) {
  const candidate = value.trim().match(/(?:https?:\/\/|maps:\/\/)[^\s<>"']+/i)?.[0]
    ?.replace(/[),.;]+$/, '');
  if (!candidate) return { error: 'Pegá un enlace completo de Google Maps o Apple Maps.' };

  let url;
  try {
    url = new URL(candidate);
  } catch {
    try {
      url = new URL(`https://${candidate}`);
    } catch {
      return { error: 'El enlace no tiene un formato válido.' };
    }
  }

  const host = url.hostname.toLowerCase();
  const isAppleMaps = host === 'maps.apple.com' || host === 'maps.apple' || url.protocol === 'maps:';
  const isGoogleMaps = host === 'maps.app.goo.gl'
    || (host === 'goo.gl' && url.pathname.toLowerCase().startsWith('/maps'))
    || host === 'google.com'
    || host.endsWith('.google.com');
  if (!isAppleMaps && !isGoogleMaps) {
    return { error: 'El enlace debe pertenecer a Google Maps o Apple Maps.' };
  }

  const candidates = [];
  const query = url.searchParams;
  for (const key of ['ll', 'query', 'q', 'center', 'sll', 'daddr']) {
    const parameter = query.get(key);
    if (parameter) candidates.push(parameter);
  }
  const decodedUrl = decodeURIComponent(url.href);
  const atCoordinates = decodedUrl.match(/@(-?\d{1,2}(?:\.\d+)?),\s*(-?\d{1,3}(?:\.\d+)?)/);
  if (atCoordinates) candidates.unshift(`${atCoordinates[1]},${atCoordinates[2]}`);
  const dataCoordinates = decodedUrl.match(/!3d(-?\d{1,2}(?:\.\d+)?)!4d(-?\d{1,3}(?:\.\d+)?)/);
  if (dataCoordinates) candidates.unshift(`${dataCoordinates[1]},${dataCoordinates[2]}`);

  const coordinates = candidates.map(parseCoordinates).find(Boolean);
  if (!coordinates) {
    const isShortLink = host === 'maps.app.goo.gl'
      || (host === 'goo.gl' && url.pathname.toLowerCase().startsWith('/maps'))
      || ((host === 'maps.apple' || host === 'maps.apple.com') && /^\/p\//i.test(url.pathname));
    if (isShortLink) return { shortLink: true, url: candidate };
    return {
      error: 'No se encontraron coordenadas en el enlace. Compartí el pin o un enlace que incluya la ubicación.',
    };
  }
  return { ...coordinates, url: candidate };
}

function formatReverseGeocodedAddress(place) {
  const street = place.street || place.name || '';
  const address = place.housenumber && street ? `${street} ${place.housenumber}` : street;
  return address || place.locality || place.city || 'Ubicación compartida';
}

async function resolveSharedMapLink(link) {
  const trimmedLink = link.trim();
  if (trimmedLink.length < 10 || trimmedLink === lastProcessedSharedLink) return;
  lastProcessedSharedLink = trimmedLink;
  sharedLocationController?.abort();
  const controller = new AbortController();
  sharedLocationController = controller;
  sharedLocationStatus.textContent = 'Leyendo el enlace y verificando que esté en Durazno…';
  sharedLocationStatus.className = '';

  let parsed = parseSharedMapLink(trimmedLink);
  if (parsed.error) {
    sharedLocationStatus.textContent = parsed.error;
    sharedLocationStatus.classList.add('is-error');
    return;
  }

  if (parsed.shortLink) {
    if (window.location.protocol === 'file:') {
      sharedLocationStatus.textContent = 'Para resolver enlaces cortos, iniciá la aplicación con el servidor local (node server.js).';
      sharedLocationStatus.classList.add('is-error');
      return;
    }
    try {
      const response = await fetch('/api/resolve-map-link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: parsed.url }),
        signal: controller.signal,
      });
      const result = await response.json();
      if (controller !== sharedLocationController) return;
      if (!response.ok) throw new Error(result.error || 'No se pudo resolver el enlace corto.');
      parsed = { latitude: result.latitude, longitude: result.longitude };
    } catch (error) {
      if (error.name === 'AbortError') return;
      if (controller === sharedLocationController) {
        sharedLocationStatus.textContent = error.message || 'No se pudo resolver el enlace corto.';
        sharedLocationStatus.classList.add('is-error');
      }
      return;
    }
  }

  try {
    const params = new URLSearchParams({
      lat: String(parsed.latitude),
      lon: String(parsed.longitude),
      lang: 'en',
    });
    const response = await fetch(`https://photon.komoot.io/reverse?${params}`, { signal: controller.signal });
    if (!response.ok) throw new Error('No se pudo consultar la ubicación.');
    const result = await response.json();
    if (controller !== sharedLocationController) return;
    const feature = result.features?.find((item) => isDuraznoCity(item.properties || {}));
    if (!feature) {
      sharedLocationStatus.textContent = 'La ubicación compartida está fuera de la ciudad de Durazno o no se pudo verificar.';
      sharedLocationStatus.classList.add('is-error');
      return;
    }

    const address = formatReverseGeocodedAddress(feature.properties || {});
    const location = {
      address,
      latitude: parsed.latitude,
      longitude: parsed.longitude,
      displayName: `${address}, Durazno, Uruguay`,
    };
    addressInput.value = address;
    resolvedLocation = location;
    setCornerRequired(false, 'Opcional si se encuentra la dirección con número.');
    addressSearchController?.abort();
    hideAddressSuggestions();
    updateMap(location.latitude, location.longitude);
    mapLabel.textContent = location.displayName;
    locationStatus.textContent = `Ubicación confirmada en Durazno · ${location.latitude.toFixed(5)}, ${location.longitude.toFixed(5)}`;
    locationStatus.classList.remove('location-error');
    sharedLocationStatus.textContent = 'Dirección y pin completados desde el enlace.';
    sharedLocationStatus.classList.add('is-success');
  } catch (error) {
    if (error.name === 'AbortError') return;
    if (controller === sharedLocationController) {
      sharedLocationStatus.textContent = 'No se pudo verificar el enlace. Revisá tu conexión e intentá nuevamente.';
      sharedLocationStatus.classList.add('is-error');
    }
  }
}

function formatPhotonPlace(feature) {
  const place = feature.properties;
  const street = place.street || place.name || '';
  const address = place.housenumber && place.street
    ? `${place.housenumber} ${place.street}`
    : street;
  const detail = [place.district, place.city, place.country].filter(Boolean).join(', ');
  return {
    address: address || place.city,
    displayName: [address || place.name, detail].filter(Boolean).join(', '),
    latitude: Number(feature.geometry.coordinates[1]),
    longitude: Number(feature.geometry.coordinates[0]),
  };
}

function normalizeAddressSearchText(value) {
  return value.normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeStreetName(value) {
  return normalizeAddressSearchText(value)
    .replace(/^(?:calle|c\.|avenida|av\.?|bulevar|blvd\.?)\s+/i, '');
}

function parseHouseNumberQuery(query) {
  const trimmedQuery = query.trim();
  const match = trimmedQuery.match(/\s+(\d+(?:\s*[a-z]+)?(?:[-/]\d+[a-z]?)?)\s*$/i);
  if (!match) return null;
  return {
    street: trimmedQuery.slice(0, match.index).trim(),
    houseNumber: normalizeAddressSearchText(match[1]).replace(/\s+/g, ''),
    query: trimmedQuery,
  };
}

function fetchPhotonFeatures(params) {
  const query = params.toString();
  if (photonQueryCache.has(query)) return photonQueryCache.get(query);

  const requestUrl = window.location.protocol === 'file:'
    ? `https://photon.komoot.io/api/?${query}`
    : `/api/photon?${query}`;
  const request = fetch(requestUrl)
    .then(async (response) => {
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'No se pudo consultar el buscador de direcciones.');
      return result;
    })
    .then((result) => result.features || [])
    .catch((error) => {
      photonQueryCache.delete(query);
      throw error;
    });
  photonQueryCache.set(query, request);
  if (photonQueryCache.size > 100) {
    photonQueryCache.delete(photonQueryCache.keys().next().value);
  }
  return request;
}

async function fetchStreetWays(streetName, { signal, exactOnly = false } = {}) {
  const params = new URLSearchParams({
    q: `${streetName}, Durazno, Uruguay`,
    lat: '-33.3782',
    lon: '-56.5241',
    limit: '12',
  });
  const features = await fetchPhotonFeatures(params);
  if (signal?.aborted) return [];
  const normalizedName = normalizeStreetName(streetName);
  const streets = features.filter((feature) => {
    const place = feature.properties || {};
    return place.osm_type === 'W'
      && place.type === 'street'
      && isDuraznoCity(place);
  });
  const exactStreets = streets.filter((feature) => (
    normalizeStreetName(feature.properties.name || '') === normalizedName
  ));
  if (exactOnly) return exactStreets.slice(0, 5);

  const matchingStreets = exactStreets.length
    ? exactStreets
    : streets.filter((feature) => {
      const name = normalizeStreetName(feature.properties.name || '');
      return name.includes(normalizedName) || normalizedName.includes(name);
    });
  const seenWays = new Set();
  return matchingStreets.filter((feature) => {
    const wayId = feature.properties.osm_id;
    if (seenWays.has(wayId)) return false;
    seenWays.add(wayId);
    return true;
  }).slice(0, 5);
}

function fetchOsmWayNodes(wayId) {
  if (!osmWayCache.has(wayId)) {
    const request = fetch(`https://api.openstreetmap.org/api/0.6/way/${wayId}/full.json`)
      .then((response) => {
        if (!response.ok) throw new Error('No se pudo consultar la geometría de una calle.');
        return response.json();
      })
      .then((data) => {
        const way = data.elements.find((element) => element.type === 'way');
        if (!way) throw new Error('No se encontró la geometría de la calle.');
        const nodes = new Map(data.elements
          .filter((element) => element.type === 'node')
          .map((node) => [node.id, { id: node.id, latitude: node.lat, longitude: node.lon }]));
        return { way, nodes };
      })
      .catch((error) => {
        osmWayCache.delete(wayId);
        throw error;
      });
    osmWayCache.set(wayId, request);
  }
  return osmWayCache.get(wayId);
}

async function findStreetIntersections(streetNames) {
  const [firstWays, secondWays] = await Promise.all(streetNames.map((street) => (
    fetchStreetWays(street, { exactOnly: true })
  )));
  const wayPairs = await Promise.all(firstWays.flatMap((firstFeature) => secondWays.map(async (secondFeature) => {
    const [firstData, secondData] = await Promise.all([
      fetchOsmWayNodes(firstFeature.properties.osm_id),
      fetchOsmWayNodes(secondFeature.properties.osm_id),
    ]);
    const secondNodeIds = new Set(secondData.way.nodes);
    const sharedNodes = firstData.way.nodes
      .filter((nodeId) => secondNodeIds.has(nodeId))
      .map((nodeId) => firstData.nodes.get(nodeId))
      .filter(Boolean);
    return sharedNodes.map((node) => ({
      address: `${firstFeature.properties.name} esquina ${secondFeature.properties.name}`,
      displayName: `${firstFeature.properties.name} esquina ${secondFeature.properties.name}, Durazno, Uruguay`,
      latitude: node.latitude,
      longitude: node.longitude,
      type: 'intersection',
    }));
  })));
  const seenIntersections = new Set();
  const intersections = wayPairs.flat().filter((intersection) => {
    const key = `${intersection.latitude.toFixed(7)}|${intersection.longitude.toFixed(7)}`;
    if (seenIntersections.has(key)) return false;
    seenIntersections.add(key);
    return true;
  });

  return intersections;
}

function updateMap(latitude, longitude, zoom = 16) {
  const tileCount = 2 ** zoom;
  const latitudeRadians = Math.max(-85.05112878, Math.min(85.05112878, latitude)) * Math.PI / 180;
  const tileX = ((longitude + 180) / 360) * tileCount;
  const tileY = ((1 - Math.asinh(Math.tan(latitudeRadians)) / Math.PI) / 2) * tileCount;
  const centerTileX = Math.floor(tileX);
  const centerTileY = Math.floor(tileY);
  const offsetX = (tileX - centerTileX) * 256;
  const offsetY = (tileY - centerTileY) * 256;
  const tileLayer = document.createElement('div');
  tileLayer.className = 'map-tile-layer';
  tileLayer.style.left = `calc(50% - ${256 + offsetX}px)`;
  tileLayer.style.top = `calc(50% - ${256 + offsetY}px)`;

  for (let row = -1; row <= 1; row += 1) {
    for (let column = -1; column <= 1; column += 1) {
      const y = centerTileY + row;
      if (y < 0 || y >= tileCount) continue;
      const x = (centerTileX + column + tileCount) % tileCount;
      const tile = document.createElement('img');
      tile.alt = '';
      tile.width = 256;
      tile.height = 256;
      tile.loading = 'eager';
      tile.referrerPolicy = 'no-referrer';
      tile.src = `https://tile.openstreetmap.de/${zoom}/${x}/${y}.png`;
      tileLayer.append(tile);
    }
  }

  mapTiles.replaceChildren(tileLayer);
  mapFrame.setAttribute('aria-label', `Mapa con ubicación en ${latitude.toFixed(5)}, ${longitude.toFixed(5)}`);
}

function hideAddressSuggestions() {
  addressSuggestions.hidden = true;
  addressInput.setAttribute('aria-expanded', 'false');
  addressInput.removeAttribute('aria-activedescendant');
  highlightedSuggestion = -1;
}

function hideCornerSuggestions() {
  cornerSuggestions.hidden = true;
  cornerInput.setAttribute('aria-expanded', 'false');
  cornerInput.removeAttribute('aria-activedescendant');
  highlightedCornerSuggestion = -1;
}

function setCornerRequired(required, message) {
  cornerInput.required = required;
  cornerStatus.textContent = message;
  if (!required) cornerInput.setCustomValidity('');
}

function scheduleAutomaticLocate(delay = 250) {
  window.clearTimeout(automaticLocateTimer);
  automaticLocateTimer = window.setTimeout(() => {
    if (!addressInput.value.trim()) return;
    if (!parseHouseNumberQuery(addressInput.value) && !cornerInput.value.trim()) return;
    locateAddress();
  }, delay);
}

function renderAddressSuggestions(features, message = '') {
  addressSuggestions.replaceChildren();
  addressMatches = features;
  highlightedSuggestion = -1;

  if (!features.length) {
    const empty = document.createElement('div');
    empty.className = 'suggestion-empty';
    empty.append(document.createTextNode(message || 'No encontramos coincidencias en Durazno. '));
    addressSuggestions.append(empty);
  } else {
    features.forEach((feature, index) => {
      const place = formatPhotonPlace(feature);
      const option = document.createElement('button');
      option.className = 'suggestion-option';
      option.type = 'button';
      option.id = `address-suggestion-${index}`;
      option.setAttribute('role', 'option');
      option.setAttribute('aria-selected', 'false');

      const title = document.createElement('span');
      title.className = 'suggestion-title';
      title.textContent = place.address;
      const detail = document.createElement('span');
      detail.className = 'suggestion-detail';
      detail.textContent = place.displayName;
      option.append(title, detail);
      option.addEventListener('click', () => selectAddressSuggestion(index));
      addressSuggestions.append(option);
    });
    locationStatus.textContent = features[0]?.properties?.type === 'street'
      ? 'Elegí una calle sugerida; para ubicarla necesitás indicar la otra calle.'
      : 'Seleccioná una coincidencia para confirmar el pin en el mapa.';
    locationStatus.classList.remove('location-error');
  }

  addressSuggestions.hidden = false;
  addressInput.setAttribute('aria-expanded', 'true');
}

function renderCornerSuggestions(features, message = '') {
  cornerSuggestions.replaceChildren();
  cornerMatches = features;
  highlightedCornerSuggestion = -1;

  if (!features.length) {
    const empty = document.createElement('div');
    empty.className = 'suggestion-empty';
    empty.textContent = message || 'No encontramos calles con ese nombre en Durazno.';
    cornerSuggestions.append(empty);
  } else {
    features.forEach((feature, index) => {
      const option = document.createElement('button');
      option.className = 'suggestion-option';
      option.type = 'button';
      option.id = `corner-suggestion-${index}`;
      option.setAttribute('role', 'option');
      option.setAttribute('aria-selected', 'false');

      const title = document.createElement('span');
      title.className = 'suggestion-title';
      title.textContent = feature.properties.name;
      const detail = document.createElement('span');
      detail.className = 'suggestion-detail';
      detail.textContent = 'Calle de Durazno, Uruguay';
      option.append(title, detail);
      option.addEventListener('click', () => {
        cornerInput.value = feature.properties.name;
        if (resolvedLocation?.type === 'intersection') resolvedLocation = null;
        hideCornerSuggestions();
        cornerStatus.textContent = 'Calle seleccionada. Buscando el cruce…';
        scheduleAutomaticLocate(100);
      });
      cornerSuggestions.append(option);
    });
  }

  cornerSuggestions.hidden = false;
  cornerInput.setAttribute('aria-expanded', 'true');
}

function uniqueStreetSuggestions(features) {
  const streets = new Map();
  for (const feature of features) {
    const name = normalizeStreetName(feature.properties.name || '');
    if (name && !streets.has(name)) streets.set(name, feature);
  }
  return [...streets.values()];
}

async function fetchCornerMatches(query, { showLoading = false } = {}) {
  const cleanQuery = query.trim();
  if (cleanQuery.length < 2) {
    hideCornerSuggestions();
    return [];
  }

  cornerSearchController?.abort();
  const controller = new AbortController();
  cornerSearchController = controller;
  if (showLoading) {
    cornerSuggestions.replaceChildren();
    const loading = document.createElement('div');
    loading.className = 'suggestion-empty';
    loading.textContent = 'Buscando calles de Durazno…';
    cornerSuggestions.append(loading);
    cornerSuggestions.hidden = false;
    cornerInput.setAttribute('aria-expanded', 'true');
  }

  try {
    const streets = uniqueStreetSuggestions(await fetchStreetWays(cleanQuery, { signal: controller.signal }));
    if (controller !== cornerSearchController) return [];
    renderCornerSuggestions(streets, 'No encontramos esa calle en Durazno. Revisá el nombre.');
    cornerStatus.textContent = streets.length
      ? 'Elegí una calle válida de Durazno.'
      : 'La esquina debe ser una calle registrada en Durazno.';
    return streets;
  } catch (error) {
    if (error.name === 'AbortError') return [];
    if (controller === cornerSearchController) {
      renderCornerSuggestions([], 'No se pudo consultar el callejero de Durazno.');
      cornerStatus.textContent = 'No se pudo consultar el callejero. Intentá nuevamente.';
    }
    return [];
  }
}

function selectAddressSuggestion(index) {
  const suggestion = addressMatches[index];
  if (!suggestion) return null;

  const place = suggestion.type === 'intersection'
    ? { ...suggestion }
    : formatPhotonPlace(suggestion);
  const addressNumber = parseHouseNumberQuery(addressInput.value);
  const sourceAddress = addressInput.value.trim();
  const sourceCorner = cornerInput.value.trim();
  if (suggestion.type !== 'intersection' && !addressNumber && suggestion.properties?.type === 'street') {
    addressInput.value = suggestion.properties.name || place.address;
    resolvedLocation = null;
    setCornerRequired(true, 'Completá la segunda calle para ubicar el cruce.');
    locationStatus.textContent = 'Calle seleccionada. Completá la otra calle para ubicar el pin.';
    hideAddressSuggestions();
    if (cornerInput.value.trim()) scheduleAutomaticLocate();
    return null;
  }

  if (suggestion.type === 'intersection') {
    place.address = `${sourceAddress} esquina ${sourceCorner}`;
    place.sourceCorner = sourceCorner;
    cornerStatus.textContent = 'Cruce confirmado en Durazno.';
  } else {
    place.address = addressNumber?.query || sourceAddress;
    setCornerRequired(false, 'Opcional si se encuentra la dirección con número.');
  }
  place.sourceAddress = sourceAddress;
  resolvedLocation = place;
  updateMap(place.latitude, place.longitude);
  mapLabel.textContent = place.displayName;
  locationStatus.textContent = `Ubicación confirmada en Durazno · ${place.latitude.toFixed(5)}, ${place.longitude.toFixed(5)}`;
  locationStatus.classList.remove('location-error');
  hideAddressSuggestions();
  hideCornerSuggestions();
  showToast(suggestion.type === 'intersection'
    ? 'Intersección seleccionada y ubicada en el mapa.'
    : 'Dirección con número seleccionada y ubicada en el mapa.');
  return place;
}

function getCurrentResolvedLocation() {
  if (!resolvedLocation) return null;
  const sourceAddress = resolvedLocation.sourceAddress || resolvedLocation.address;
  if (sourceAddress.toLowerCase() !== addressInput.value.trim().toLowerCase()) return null;
  if (resolvedLocation.type === 'intersection'
    && resolvedLocation.sourceCorner?.toLowerCase() !== cornerInput.value.trim().toLowerCase()) return null;
  return resolvedLocation;
}

async function fetchAddressMatches(query, { showLoading = false, autoLocate = false } = {}) {
  const cleanQuery = query.trim();
  if (cleanQuery.length < 3) {
    hideAddressSuggestions();
    return [];
  }

  addressSearchController?.abort();
  const controller = new AbortController();
  addressSearchController = controller;
  if (showLoading) {
    addressSuggestions.replaceChildren();
    const loading = document.createElement('div');
    loading.className = 'suggestion-empty';
    loading.textContent = 'Buscando coincidencias en Durazno…';
    addressSuggestions.append(loading);
    addressSuggestions.hidden = false;
    addressInput.setAttribute('aria-expanded', 'true');
  }

  const addressNumber = parseHouseNumberQuery(cleanQuery);
  if (!addressNumber) {
    setCornerRequired(true, 'Obligatoria para ubicar una dirección sin número.');
    try {
      const streets = uniqueStreetSuggestions(await fetchStreetWays(cleanQuery, { signal: controller.signal }));
      if (controller !== addressSearchController) return [];
      renderAddressSuggestions(streets, 'No encontramos esa calle en Durazno. Podés corregirla o indicar otra calle.');
      locationStatus.textContent = streets.length
        ? 'Elegí una calle sugerida. Para ubicar el pin, indicá también la calle que cruza.'
        : 'No encontramos esa calle. Revisá el nombre o completá la segunda calle.';
      locationStatus.classList.remove('location-error');
      return streets;
    } catch (error) {
      if (error.name === 'AbortError') return [];
      if (controller === addressSearchController) {
        renderAddressSuggestions([], 'No se pudo consultar el callejero de Durazno.');
        locationStatus.textContent = 'No se pudo consultar la dirección. Revisá tu conexión e intentá nuevamente.';
        locationStatus.classList.add('location-error');
      }
      return [];
    }
  }

  setCornerRequired(false, 'Opcional si se encuentra la dirección con número.');
  try {
    const params = new URLSearchParams({
      q: `${cleanQuery}, Durazno, Uruguay`,
      lat: '-33.3782',
      lon: '-56.5241',
      limit: '12',
    });
    const features = await fetchPhotonFeatures(params);
    if (controller !== addressSearchController) return [];

    const matchingFeatures = features.filter((feature) => {
      const place = feature.properties || {};
      const houseNumber = normalizeAddressSearchText(String(place.housenumber || '')).replace(/\s+/g, '');
      const streetNames = [place.street, place.name]
        .filter(Boolean)
        .map(normalizeStreetName);
      return isDuraznoCity(place)
        && houseNumber === addressNumber.houseNumber
        && streetNames.includes(normalizeStreetName(addressNumber.street));
    });
    const uniqueFeatures = [];
    const seenPlaces = new Set();
    for (const feature of matchingFeatures) {
      const place = formatPhotonPlace(feature);
      const key = place.address.toLowerCase();
      if (!seenPlaces.has(key)) {
        seenPlaces.add(key);
        uniqueFeatures.push(feature);
      }
    }
    if (uniqueFeatures.length) {
      setCornerRequired(false, 'Opcional si se encuentra la dirección con número.');
      locationStatus.textContent = 'Se encontró la dirección con número en Durazno.';
      locationStatus.classList.remove('location-error');
    } else {
      setCornerRequired(true, 'No encontramos ese número. Ingresá una esquina para ubicar el cruce.');
      locationStatus.textContent = 'No se encontró esa dirección con número. Completá Esquina para ubicar el cruce.';
      locationStatus.classList.add('location-error');
    }
    renderAddressSuggestions(uniqueFeatures.slice(0, 7), 'No encontramos esa dirección con número. Completá Esquina para ubicar el cruce.');
    if (autoLocate && uniqueFeatures.length) selectAddressSuggestion(0);
    else if (autoLocate && cornerInput.value.trim()) scheduleAutomaticLocate();
    return uniqueFeatures;
  } catch (error) {
    if (error.name === 'AbortError') return [];
    if (controller === addressSearchController) {
      setCornerRequired(true, 'No se pudo buscar el número. Ingresá una esquina para ubicar el cruce.');
      renderAddressSuggestions([], 'No se pudo consultar la dirección. Podés ingresar una esquina para ubicar el cruce.');
      locationStatus.textContent = 'No se pudo consultar la dirección con número. Revisá la conexión o completá Esquina.';
      locationStatus.classList.add('location-error');
    }
    return [];
  }
}

async function locateAddress() {
  window.clearTimeout(automaticLocateTimer);
  const streetAddress = addressInput.value.trim();
  if (!streetAddress) {
    addressInput.setCustomValidity('Ingresá una dirección para ubicarla.');
    addressInput.reportValidity();
    addressInput.setCustomValidity('');
    addressInput.focus();
    return null;
  }

  const cornerStreet = cornerInput.value.trim();
  const currentLocation = getCurrentResolvedLocation();
  if (currentLocation) return currentLocation;

  window.clearTimeout(addressSearchTimer);
  window.clearTimeout(cornerSearchTimer);
  cornerSearchController?.abort();
  hideCornerSuggestions();
  locationStatus.classList.remove('location-error');
  try {
    const addressNumber = parseHouseNumberQuery(streetAddress);
    if (addressNumber) {
      locationStatus.textContent = 'Buscando primero la dirección con número…';
      const numberedMatches = await fetchAddressMatches(streetAddress, { showLoading: true });
      if (numberedMatches.length) return selectAddressSuggestion(0);
      if (addressSearchController?.signal.aborted) return null;
    } else {
      setCornerRequired(true, 'Obligatoria para ubicar una dirección sin número.');
    }

    if (!cornerStreet) {
      resolvedLocation = null;
      setCornerRequired(true, addressNumber
        ? 'No encontramos ese número. Ingresá una esquina para ubicar el cruce.'
        : 'Obligatoria para ubicar una dirección sin número.');
      locationStatus.textContent = addressNumber
        ? 'No se encontró la dirección con número. Ingresá la calle de la esquina para ubicar el cruce.'
        : 'Ingresá la calle que cruza con la dirección para ubicar el cruce.';
      locationStatus.classList.add('location-error');
      return null;
    }

    const mainStreet = addressNumber?.street || streetAddress;
    if (normalizeStreetName(mainStreet) === normalizeStreetName(cornerStreet)) {
      resolvedLocation = null;
      locationStatus.textContent = 'Ingresá dos calles distintas para encontrar una esquina.';
      locationStatus.classList.add('location-error');
      cornerStatus.textContent = 'La esquina debe ser distinta de la dirección principal.';
      return null;
    }

    locationStatus.textContent = 'Buscando el cruce de las dos calles en Durazno…';
    const intersections = await findStreetIntersections([mainStreet, cornerStreet]);
    if (!intersections.length) {
      resolvedLocation = null;
      locationStatus.textContent = 'No encontramos el cruce. Verificá que ambas calles estén registradas en Durazno.';
      locationStatus.classList.add('location-error');
      cornerStatus.textContent = 'Elegí una calle válida de Durazno e intentá nuevamente.';
      return null;
    }

    addressMatches = intersections;
    return selectAddressSuggestion(0);
  } catch (error) {
    resolvedLocation = null;
    locationStatus.textContent = 'No se pudo consultar la dirección o el cruce. Revisá la conexión e intentá nuevamente.';
    locationStatus.classList.add('location-error');
    showToast(error.message || 'No se pudo ubicar la dirección.', true);
    return null;
  }
}

function buildWhatsAppMessage(order) {
  const emoji = (...codePoints) => String.fromCodePoint(...codePoints);
  const coordinates = `${Number(order.latitude).toFixed(6)},${Number(order.longitude).toFixed(6)}`;
  const coordinateMatch = coordinates.match(/^(-?\d{1,2}\.\d{6}),(-?\d{1,3}\.\d{6})$/);
  const mapLink = coordinateMatch
    && Math.abs(Number(coordinateMatch[1])) <= 90
    && Math.abs(Number(coordinateMatch[2])) <= 180
    ? `https://www.google.com/maps?q=${coordinateMatch[1]},${coordinateMatch[2]}`
    : 'Ubicación no disponible';

  return [
    `${emoji(0x1F6F5)} NUEVO PEDIDO DE REPARTO`,
    '',
    `${emoji(0x1F3EA)}Comercio: ${order.merchant}`,
    '',
    `${emoji(0x1F464)}Cliente: ${order.customer}`,
    `${emoji(0x1F4DE)} Contacto: ${order.contact}`,
    '',
    `${emoji(0x1F4CD)} DIRECCIÓN DE ENTREGA`,
    `${order.address}, Durazno, Uruguay`,
    `${emoji(0x1F5FA, 0xFE0F)} Mapa: ${mapLink}`,
    '',
    `${emoji(0x1F4B3)} Método de pago: ${order.paymentMethod}`,
    `${emoji(0x1F4B0)} Total: ${currencyFormatter.format(order.amount)}`,
    '',
    `${emoji(0x1F4DD)} Observaciones: ${order.notes || 'Sin observaciones'}`,
  ].join('\n');
}

function makeWhatsAppUrl(order) {
  const message = encodeURIComponent(buildWhatsAppMessage(order));
  return `https://api.whatsapp.com/send?phone=59893991330&text=${message}`;
}

function handleSubmit(event) {
  event.preventDefault();
  if (!form.reportValidity()) return;

  const amount = parseAmount(amountInput.value.trim());
  if (!Number.isFinite(amount) || amount < 0) {
    amountInput.setCustomValidity('Ingresá un monto válido, por ejemplo 1250,50.');
    amountInput.reportValidity();
    amountInput.setCustomValidity('');
    return;
  }
  if (countWords(notesInput.value) > 20) {
    notesInput.setCustomValidity('Las observaciones pueden tener hasta 20 palabras.');
    notesInput.reportValidity();
    notesInput.setCustomValidity('');
    return;
  }

  const location = getCurrentResolvedLocation();
  if (!location) {
    showToast('Esperá a que la dirección se confirme automáticamente en Durazno.', true);
    addressInput.focus();
    return;
  }

  const merchant = merchantInput.value.trim();
  try {
    localStorage.setItem(STORAGE_KEYS.merchant, merchant);
  } catch {
    showToast('No se pudo guardar el comercio en este navegador.', true);
  }

  const order = {
    id: crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`,
    merchant,
    customer: customerInput.value.trim(),
    contact: contactInput.value.trim(),
    paymentMethod: form.elements.paymentMethod.value,
    address: location.type === 'intersection' ? location.address : addressInput.value.trim(),
    latitude: location.latitude,
    longitude: location.longitude,
    amount,
    notes: notesInput.value.trim(),
    createdAt: new Date().toISOString(),
    dateKey: localDateKey(),
  };

  orders.push(order);
  saveOrders();
  updateDashboard();

  const whatsappUrl = makeWhatsAppUrl(order);
  const whatsappWindow = window.open(whatsappUrl, '_blank');
  if (whatsappWindow) {
    showToast('Pedido guardado. WhatsApp abrió el mensaje; tocá Enviar para completarlo.');
  } else {
    showToast('Pedido guardado. El navegador bloqueó la ventana de WhatsApp.', false, {
      href: whatsappUrl,
      label: 'Abrir WhatsApp',
    });
  }

  // Keep the merchant for the next order; clear only the per-order fields.
  form.reset();
  merchantInput.value = merchant;
  resolvedLocation = null;
  setCornerRequired(false, 'Opcional si se encuentra la dirección con número.');
  hideAddressSuggestions();
  hideCornerSuggestions();
  lastProcessedSharedLink = '';
  sharedLocationInput.value = '';
  sharedLocationStatus.textContent = '';
  sharedLocationStatus.className = '';
  updateMap(-33.3782, -56.5241, 13);
  mapLabel.textContent = 'Durazno, Uruguay';
  locationStatus.textContent = 'La zona de reparto está limitada a Durazno, Uruguay.';
  document.querySelector('#word-count').textContent = '0';
  customerInput.focus();
}

function exportPdf() {
  if (orders.length === 0) {
    showToast('Cargá al menos un pedido antes de exportar.', true);
    return;
  }
  if (!window.jspdf?.jsPDF) {
    showToast('No se pudo cargar el exportador PDF. Revisá tu conexión a internet.', true);
    return;
  }

  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  const today = new Intl.DateTimeFormat('es-UY', { dateStyle: 'long' }).format(new Date());
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(18);
  doc.setTextColor(36, 53, 46);
  doc.text('Repartos AJ · Pedidos de reparto', 14, 17);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(110, 122, 112);
  doc.text(`Comercio: ${merchantInput.value.trim() || '—'}    ·    ${today}    ·    ${orders.length} pedidos`, 14, 24);

  doc.autoTable({
    startY: 30,
    head: [['Fecha', 'Hora', 'Cliente', 'Dirección', 'Contacto', 'Método de pago', 'Coordenadas', 'Monto (UYU)', 'Observaciones']],
    body: [...orders]
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map((order) => [
        dateFormatter.format(new Date(order.createdAt)),
        timeFormatter.format(new Date(order.createdAt)),
        order.customer,
        `${order.address}, Durazno`,
        order.contact,
        order.paymentMethod || 'EFECTIVO',
        `${Number(order.latitude).toFixed(5)}, ${Number(order.longitude).toFixed(5)}`,
        currencyFormatter.format(order.amount),
        order.notes || '—',
      ]),
    styles: { font: 'helvetica', fontSize: 8, cellPadding: 3, textColor: [65, 78, 69], overflow: 'linebreak' },
    headStyles: { fillColor: [47, 104, 77], textColor: [255, 255, 255], fontStyle: 'bold' },
    alternateRowStyles: { fillColor: [247, 248, 243] },
    margin: { left: 14, right: 14 },
  });

  doc.save(`pedidos-repartosAJ-${localDateKey()}.pdf`);
  showToast('PDF exportado correctamente.');
}

function initialize() {
  updateMap(-33.3782, -56.5241, 13);
  try {
    merchantInput.value = localStorage.getItem(STORAGE_KEYS.merchant) || '';
  } catch {
    merchantInput.value = '';
  }

  merchantInput.addEventListener('input', saveMerchantPreference);
  contactInput.addEventListener('input', () => {
    contactInput.value = contactInput.value.replace(/\D/g, '').slice(0, 9);
  });
  amountInput.addEventListener('input', () => amountInput.setCustomValidity(''));
  amountInput.addEventListener('blur', formatAmountInput);
  notesInput.addEventListener('input', updateWordCount);
  addressInput.addEventListener('input', () => {
    addressSearchController?.abort();
    window.clearTimeout(addressSearchTimer);
    window.clearTimeout(automaticLocateTimer);
    if (resolvedLocation?.address.toLowerCase() !== addressInput.value.trim().toLowerCase()) resolvedLocation = null;
    const hasHouseNumber = Boolean(parseHouseNumberQuery(addressInput.value));
    if (!hasHouseNumber) {
      setCornerRequired(true, 'Obligatoria para ubicar una dirección sin número.');
    } else {
      setCornerRequired(false, 'Buscando primero la dirección con número.');
    }
    locationStatus.classList.remove('location-error');
    locationStatus.textContent = addressInput.value.trim().length >= 3
      ? hasHouseNumber
        ? 'Buscando la dirección con número en Durazno…'
        : 'Completá Esquina para ubicar el cruce en Durazno.'
      : 'Escribí para ver coincidencias de Durazno, Uruguay.';
    addressSearchTimer = window.setTimeout(() => {
      fetchAddressMatches(addressInput.value, { showLoading: true, autoLocate: true });
    }, 350);
  });
  addressInput.addEventListener('blur', () => {
    if (!parseHouseNumberQuery(addressInput.value) && cornerInput.value.trim()) {
      scheduleAutomaticLocate();
    }
  });
  addressInput.addEventListener('keydown', (event) => {
    if (addressSuggestions.hidden) return;
    const options = [...addressSuggestions.querySelectorAll('.suggestion-option')];
    if (event.key === 'ArrowDown' && options.length) {
      event.preventDefault();
      highlightedSuggestion = (highlightedSuggestion + 1) % options.length;
    } else if (event.key === 'ArrowUp' && options.length) {
      event.preventDefault();
      highlightedSuggestion = (highlightedSuggestion - 1 + options.length) % options.length;
    } else if (event.key === 'Enter' && options.length) {
      event.preventDefault();
      selectAddressSuggestion(highlightedSuggestion < 0 ? 0 : highlightedSuggestion);
      return;
    } else if (event.key === 'Escape') {
      hideAddressSuggestions();
      return;
    } else {
      return;
    }

    options.forEach((option, index) => {
      const isActive = index === highlightedSuggestion;
      option.setAttribute('aria-selected', String(isActive));
      if (isActive) {
        addressInput.setAttribute('aria-activedescendant', option.id);
        option.scrollIntoView({ block: 'nearest' });
      }
    });
  });
  addressInput.addEventListener('focus', () => {
    if (addressInput.value.trim().length >= 3 && !resolvedLocation) {
      fetchAddressMatches(addressInput.value, { showLoading: true });
    }
  });
  cornerInput.addEventListener('input', () => {
    cornerSearchController?.abort();
    window.clearTimeout(cornerSearchTimer);
    window.clearTimeout(automaticLocateTimer);
    if (resolvedLocation?.type === 'intersection'
      && resolvedLocation.sourceCorner?.toLowerCase() !== cornerInput.value.trim().toLowerCase()) {
      resolvedLocation = null;
    }
    if (cornerInput.value.trim().length < 2) {
      hideCornerSuggestions();
      cornerStatus.textContent = cornerInput.required
        ? 'Ingresá una calle válida de Durazno.'
        : 'Opcional si se encuentra la dirección con número.';
      return;
    }
    cornerStatus.textContent = 'Buscando calles de Durazno…';
    cornerSearchTimer = window.setTimeout(() => {
      fetchCornerMatches(cornerInput.value, { showLoading: true });
    }, 350);
  });
  cornerInput.addEventListener('blur', () => {
    if (addressInput.value.trim()) scheduleAutomaticLocate();
  });
  cornerInput.addEventListener('focus', () => {
    if (cornerInput.value.trim().length >= 2 && cornerSuggestions.hidden) {
      fetchCornerMatches(cornerInput.value, { showLoading: true });
    }
  });
  cornerInput.addEventListener('keydown', (event) => {
    if (cornerSuggestions.hidden) return;
    const options = [...cornerSuggestions.querySelectorAll('.suggestion-option')];
    if (event.key === 'ArrowDown' && options.length) {
      event.preventDefault();
      highlightedCornerSuggestion = (highlightedCornerSuggestion + 1) % options.length;
    } else if (event.key === 'ArrowUp' && options.length) {
      event.preventDefault();
      highlightedCornerSuggestion = (highlightedCornerSuggestion - 1 + options.length) % options.length;
    } else if (event.key === 'Enter' && options.length) {
      event.preventDefault();
      options[highlightedCornerSuggestion < 0 ? 0 : highlightedCornerSuggestion].click();
      return;
    } else if (event.key === 'Escape') {
      hideCornerSuggestions();
      return;
    } else {
      return;
    }

    options.forEach((option, index) => {
      const isActive = index === highlightedCornerSuggestion;
      option.setAttribute('aria-selected', String(isActive));
      if (isActive) {
        cornerInput.setAttribute('aria-activedescendant', option.id);
        option.scrollIntoView({ block: 'nearest' });
      }
    });
  });
  sharedLocationInput.addEventListener('input', () => {
    window.clearTimeout(sharedLocationTimer);
    sharedLocationController?.abort();
    lastProcessedSharedLink = '';
    sharedLocationStatus.textContent = '';
    sharedLocationStatus.className = '';
    const sharedLink = sharedLocationInput.value.trim();
    if (!sharedLink) return;
    sharedLocationTimer = window.setTimeout(() => resolveSharedMapLink(sharedLink), 450);
  });
  sharedLocationInput.addEventListener('paste', () => {
    window.setTimeout(() => {
      sharedLocationInput.dispatchEvent(new Event('input', { bubbles: true }));
    }, 0);
  });
  document.addEventListener('pointerdown', (event) => {
    if (!addressSearch.contains(event.target)) hideAddressSuggestions();
    if (!cornerSuggestions.parentElement.contains(event.target)) hideCornerSuggestions();
  });
  form.addEventListener('submit', handleSubmit);
  document.querySelector('#export-button').addEventListener('click', exportPdf);
  updateDashboard();
}

initialize();
