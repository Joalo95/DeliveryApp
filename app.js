const STORAGE_KEYS = {
  orders: 'mesa-lista.orders.v1',
  merchant: 'mesa-lista.merchant.v1',
};

const form = document.querySelector('#order-form');
const merchantInput = document.querySelector('#merchant');
const customerInput = document.querySelector('#customer');
const contactInput = document.querySelector('#contact');
const addressInput = document.querySelector('#address');
const sharedLocationInput = document.querySelector('#shared-location');
const sharedLocationStatus = document.querySelector('#shared-location-status');
const addressSuggestions = document.querySelector('#address-suggestions');
const addressSearch = document.querySelector('.address-search');
const amountInput = document.querySelector('#amount');
const notesInput = document.querySelector('#notes');
const locateButton = document.querySelector('#locate-button');
const locationStatus = document.querySelector('#location-status');
const mapFrame = document.querySelector('#map-frame');
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
let sharedLocationTimer;
let sharedLocationController = null;
let lastProcessedSharedLink = '';
const osmWayCache = new Map();

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
    addressSearchController?.abort();
    hideAddressSuggestions();
    mapFrame.src = makeOpenStreetMapEmbedUrl(location.latitude, location.longitude);
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

function parseIntersectionQuery(query) {
  const cleanedQuery = query
    .replace(/^\s*(?:esquina|intersecci[oó]n(?:\s+de)?|cruce\s+de)\s+/i, '')
    .trim();
  const streets = cleanedQuery.split(/\s+(?:esquina|esq\.?|y)\s+|\s*&\s*|\s*\/\s*/i)
    .map((street) => street.trim().replace(/^(?:calle|c\.|avenida|av\.|bulevar|blvd\.)\s+/i, ''));
  return streets.length === 2 && streets.every((street) => street.length >= 2)
    ? streets
    : null;
}

async function fetchStreetWays(streetName) {
  const params = new URLSearchParams({
    q: `${streetName}, Durazno, Uruguay`,
    lat: '-33.3782',
    lon: '-56.5241',
    limit: '12',
  });
  const response = await fetch(`https://photon.komoot.io/api/?${params}`);
  if (!response.ok) throw new Error('No se pudieron consultar las calles de Durazno.');
  const result = await response.json();
  const normalizedName = streetName.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const seenWays = new Set();
  return (result.features || []).filter((feature) => {
    const place = feature.properties || {};
    const name = (place.name || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    if (place.osm_type !== 'W' || place.type !== 'street' || !isDuraznoCity(place)) return false;
    if (!name.includes(normalizedName) && !normalizedName.includes(name)) return false;
    if (seenWays.has(place.osm_id)) return false;
    seenWays.add(place.osm_id);
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
  const [firstWays, secondWays] = await Promise.all(streetNames.map(fetchStreetWays));
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

  const validatedIntersections = await Promise.all(intersections.slice(0, 8).map(async (intersection) => {
    const params = new URLSearchParams({
      lat: String(intersection.latitude),
      lon: String(intersection.longitude),
      lang: 'en',
    });
    const response = await fetch(`https://photon.komoot.io/reverse?${params}`);
    if (!response.ok) return null;
    const result = await response.json();
    return result.features?.some((feature) => isDuraznoCity(feature.properties || {}))
      ? intersection
      : null;
  }));
  return validatedIntersections.filter(Boolean);
}

function openOpenStreetMapSearch(query) {
  const search = `${query}, Durazno, Uruguay`;
  return `https://www.openstreetmap.org/search?query=${encodeURIComponent(search)}`;
}

function makeOpenStreetMapEmbedUrl(latitude, longitude, zoom = 16) {
  const longitudeOffset = zoom >= 16 ? 0.006 : 0.035;
  const latitudeOffset = zoom >= 16 ? 0.004 : 0.025;
  const bounds = [
    longitude - longitudeOffset,
    latitude - latitudeOffset,
    longitude + longitudeOffset,
    latitude + latitudeOffset,
  ].map((coordinate) => coordinate.toFixed(6));
  const params = new URLSearchParams({
    bbox: bounds.join(','),
    layer: 'mapnik',
    marker: `${latitude},${longitude}`,
  });
  return `https://www.openstreetmap.org/export/embed.html?${params}`;
}

function hideAddressSuggestions() {
  addressSuggestions.hidden = true;
  addressInput.setAttribute('aria-expanded', 'false');
  addressInput.removeAttribute('aria-activedescendant');
  highlightedSuggestion = -1;
}

function renderAddressSuggestions(features, query, message = '') {
  addressSuggestions.replaceChildren();
  addressMatches = features;
  highlightedSuggestion = -1;

  if (!features.length) {
    const empty = document.createElement('div');
    empty.className = 'suggestion-empty';
    empty.append(document.createTextNode(message || 'No encontramos coincidencias en Durazno. '));
    const googleLink = document.createElement('a');
    googleLink.href = openOpenStreetMapSearch(query);
    googleLink.target = '_blank';
    googleLink.rel = 'noopener noreferrer';
    googleLink.textContent = 'Buscar en OpenStreetMap';
    empty.append(googleLink);
    addressSuggestions.append(empty);
    locationStatus.textContent = 'No hay coincidencias en el callejero de Durazno. Podés comprobar el nombre en OpenStreetMap.';
    locationStatus.classList.add('location-error');
  } else {
    features.forEach((feature, index) => {
      const place = feature.type === 'intersection' ? feature : formatPhotonPlace(feature);
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
    locationStatus.textContent = 'Seleccioná una coincidencia para confirmar el pin en el mapa.';
    locationStatus.classList.remove('location-error');
  }

  addressSuggestions.hidden = false;
  addressInput.setAttribute('aria-expanded', 'true');
}

function selectAddressSuggestion(index) {
  const suggestion = addressMatches[index];
  if (!suggestion) return null;

  const place = suggestion.type === 'intersection' ? suggestion : formatPhotonPlace(suggestion);
  addressInput.value = place.address;
  resolvedLocation = place;
  mapFrame.src = makeOpenStreetMapEmbedUrl(place.latitude, place.longitude);
  mapLabel.textContent = place.displayName;
  locationStatus.textContent = `Ubicación confirmada en Durazno · ${place.latitude.toFixed(5)}, ${place.longitude.toFixed(5)}`;
  locationStatus.classList.remove('location-error');
  hideAddressSuggestions();
  addressInput.focus();
  showToast('Dirección seleccionada y ubicada en el mapa.');
  return place;
}

async function fetchAddressMatches(query, { showLoading = false } = {}) {
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

  try {
    const intersectionStreets = parseIntersectionQuery(cleanQuery);
    if (intersectionStreets) {
      const intersections = await findStreetIntersections(intersectionStreets);
      if (controller !== addressSearchController) return [];
      addressMatches = intersections;
      renderAddressSuggestions(intersections, cleanQuery, 'No encontramos esa intersección conectada en el mapa de Durazno. ');
      return intersections;
    }

    const params = new URLSearchParams({
      q: `${cleanQuery}, Durazno, Uruguay`,
      lat: '-33.3782',
      lon: '-56.5241',
      limit: '12',
    });
    const response = await fetch(`https://photon.komoot.io/api/?${params}`, { signal: controller.signal });
    if (!response.ok) throw new Error('No se pudo consultar el buscador de direcciones.');
    const result = await response.json();
    if (controller !== addressSearchController) return [];

    const normalizedQuery = cleanQuery.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    const features = (result.features || []).filter((feature) => {
      const place = feature.properties || {};
      const searchablePlace = [place.name, place.street, place.housenumber]
        .filter(Boolean)
        .join(' ')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase();
      const matchesQuery = searchablePlace.includes(normalizedQuery)
        || (searchablePlace.length >= 4 && normalizedQuery.includes(searchablePlace));
      return isDuraznoCity(place) && matchesQuery;
    });
    const uniqueFeatures = [];
    const seenPlaces = new Set();
    for (const feature of features) {
      const place = formatPhotonPlace(feature);
      const key = place.address.toLowerCase();
      if (!seenPlaces.has(key)) {
        seenPlaces.add(key);
        uniqueFeatures.push(feature);
      }
    }
    renderAddressSuggestions(uniqueFeatures.slice(0, 7), cleanQuery);
    return uniqueFeatures;
  } catch (error) {
    if (error.name === 'AbortError') return [];
    if (controller === addressSearchController) {
      renderAddressSuggestions([], cleanQuery, 'No se pudo consultar el buscador. ');
      locationStatus.textContent = 'No se pudo consultar el servicio de direcciones.';
      locationStatus.classList.add('location-error');
    }
    return [];
  }
}

async function locateAddress() {
  const streetAddress = addressInput.value.trim();
  if (!streetAddress) {
    addressInput.setCustomValidity('Ingresá una dirección para ubicarla.');
    addressInput.reportValidity();
    addressInput.setCustomValidity('');
    addressInput.focus();
    return null;
  }

  if (resolvedLocation?.address.toLowerCase() === streetAddress.toLowerCase()) return resolvedLocation;

  locateButton.disabled = true;
  locateButton.textContent = 'Buscando…';
  locationStatus.textContent = 'Buscando coincidencias en Durazno…';
  locationStatus.classList.remove('location-error');
  try {
    const matches = await fetchAddressMatches(streetAddress, { showLoading: true });
    const firstValidMatch = matches[0];
    if (!firstValidMatch) {
      resolvedLocation = null;
      locationStatus.textContent = 'No encontramos una coincidencia en Durazno. Elegí una sugerencia o revisá el nombre en OpenStreetMap.';
      locationStatus.classList.add('location-error');
      return null;
    }
    return selectAddressSuggestion(matches.indexOf(firstValidMatch));
  } finally {
    locateButton.disabled = false;
    locateButton.innerHTML = '<span aria-hidden="true">⌖</span> Ubicar';
  }
}

function buildWhatsAppMessage(order) {
  const coordinates = `${Number(order.latitude).toFixed(6)},${Number(order.longitude).toFixed(6)}`;
  const coordinateMatch = coordinates.match(/^(-?\d{1,2}\.\d{6}),(-?\d{1,3}\.\d{6})$/);
  const mapLink = coordinateMatch
    && Math.abs(Number(coordinateMatch[1])) <= 90
    && Math.abs(Number(coordinateMatch[2])) <= 180
    ? `https://www.google.com/maps?q=${coordinateMatch[1]},${coordinateMatch[2]}`
    : 'Ubicación no disponible';

  return [
    '\u{1F6F5} *NUEVO PEDIDO DE REPARTO*',
    '',
    `\u{1F3EA} *Comercio:* ${order.merchant}`,
    `\u{1F464} *Cliente:* ${order.customer}`,
    `\u{1F4DE} *Contacto:* ${order.contact}`,
    '',
    '\u{1F4CD} *DIRECCIÓN DE ENTREGA*',
    `${order.address}, Durazno, Uruguay`,
    `\u{1F5FA}\u{FE0F} *Mapa:* ${mapLink}`,
    '',
    `\u{1F4B3} *Método de pago:* ${order.paymentMethod}`,
    `\u{1F4B0} *Total:* ${currencyFormatter.format(order.amount)}`,
    '',
    `\u{1F4DD} *Observaciones:* ${order.notes || 'Sin observaciones'}`,
  ].join('\n');
}

function makeWhatsAppUrl(order) {
  const query = new URLSearchParams({ text: buildWhatsAppMessage(order) });
  return `https://wa.me/59893991330?${query}`;
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

  const location = resolvedLocation?.address.toLowerCase() === addressInput.value.trim().toLowerCase()
    ? resolvedLocation
    : null;
  if (!location) {
    showToast('Primero tocá “Ubicar” y confirmá la dirección en Durazno.', true);
    locateButton.focus();
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
    address: addressInput.value.trim(),
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
  lastProcessedSharedLink = '';
  sharedLocationInput.value = '';
  sharedLocationStatus.textContent = '';
  sharedLocationStatus.className = '';
  mapFrame.src = makeOpenStreetMapEmbedUrl(-33.3782, -56.5241, 13);
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
    if (resolvedLocation?.address.toLowerCase() !== addressInput.value.trim().toLowerCase()) resolvedLocation = null;
    locationStatus.classList.remove('location-error');
    locationStatus.textContent = addressInput.value.trim().length >= 3
      ? 'Buscando coincidencias en Durazno…'
      : 'Escribí para ver coincidencias de Durazno, Uruguay.';
    addressSearchTimer = window.setTimeout(() => {
      fetchAddressMatches(addressInput.value);
    }, 350);
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
  });
  locateButton.addEventListener('click', locateAddress);
  form.addEventListener('submit', handleSubmit);
  document.querySelector('#export-button').addEventListener('click', exportPdf);
  updateDashboard();
}

initialize();
