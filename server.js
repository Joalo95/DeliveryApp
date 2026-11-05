const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const HOST = '127.0.0.1';
const PORT = Number(process.env.PORT) || 4173;
const ROOT = __dirname;
const MAX_BODY_BYTES = 4096;
const MAX_REDIRECTS = 7;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const ALLOWED_MAP_HOSTS = new Set([
  'maps.app.goo.gl',
  'goo.gl',
  'maps.google.com',
  'google.com',
  'www.google.com',
  'maps.apple',
  'maps.apple.com',
]);
const STATIC_FILES = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/index.html', ['index.html', 'text/html; charset=utf-8']],
  ['/app.js', ['app.js', 'text/javascript; charset=utf-8']],
  ['/styles.css', ['styles.css', 'text/css; charset=utf-8']],
]);

function sendJson(response, statusCode, data) {
  response.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  response.end(JSON.stringify(data));
}

function isAllowedMapUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && ALLOWED_MAP_HOSTS.has(url.hostname.toLowerCase());
  } catch {
    return false;
  }
}

function parseCoordinates(value) {
  const match = String(value).match(/(-?\d{1,2}(?:\.\d+)?)\s*[,;]\s*(-?\d{1,3}(?:\.\d+)?)/);
  if (!match) return null;
  const latitude = Number(match[1]);
  const longitude = Number(match[2]);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)
    || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return null;
  return { latitude, longitude };
}

function extractCoordinates(value) {
  const text = String(value || '').replaceAll('&amp;', '&');
  const decoded = (() => {
    try { return decodeURIComponent(text); } catch { return text; }
  })();
  const coordinatePatterns = [
    /!3d(-?\d{1,2}(?:\.\d+)?)!4d(-?\d{1,3}(?:\.\d+)?)/,
    /@(-?\d{1,2}(?:\.\d+)?),\s*(-?\d{1,3}(?:\.\d+)?)/,
    /(?:ll|center|query|q|daddr)=([^&#\s"'<>]+)/i,
  ];
  for (const pattern of coordinatePatterns) {
    const match = decoded.match(pattern);
    if (!match) continue;
    const coordinates = parseCoordinates(match[0].includes('!3d') || match[0].includes('@')
      ? `${match[1]},${match[2]}`
      : match[1]);
    if (coordinates) return coordinates;
  }

  const urls = text.match(/https?:[^\s"'<>\\]+/g) || [];
  for (const candidate of urls) {
    try {
      const url = new URL(candidate.replaceAll('\\u0026', '&'));
      for (const key of ['ll', 'query', 'q', 'center', 'sll', 'daddr']) {
        const coordinates = parseCoordinates(url.searchParams.get(key));
        if (coordinates) return coordinates;
      }
      const byPath = extractCoordinates(url.pathname);
      if (byPath) return byPath;
    } catch {
      // Ignore malformed URLs found in the map page markup.
    }
  }
  return null;
}

async function readLimitedBody(response, limit = 1024 * 1024) {
  if (!response.body) return '';
  const reader = response.body.getReader();
  const chunks = [];
  let bytesRead = 0;
  try {
    while (bytesRead < limit) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = value.subarray(0, Math.min(value.length, limit - bytesRead));
      chunks.push(Buffer.from(chunk));
      bytesRead += chunk.length;
      if (chunk.length < value.length) break;
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  return Buffer.concat(chunks).toString('utf8');
}

async function resolveShortMapLink(inputUrl) {
  if (!isAllowedMapUrl(inputUrl)) {
    return { statusCode: 400, error: 'Solo se aceptan enlaces HTTPS de Google Maps o Apple Maps.' };
  }

  let currentUrl = new URL(inputUrl).toString();
  for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount += 1) {
    if (!isAllowedMapUrl(currentUrl)) {
      return { statusCode: 400, error: 'La redirección salió de los dominios permitidos de Maps.' };
    }

    let response;
    try {
      response = await fetch(currentUrl, {
        redirect: 'manual',
        signal: AbortSignal.timeout(10000),
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
          Accept: 'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8',
        },
      });
    } catch {
      return { statusCode: 502, error: 'No se pudo abrir el enlace. Revisá la conexión o pegá un enlace completo.' };
    }

    if (REDIRECT_STATUSES.has(response.status)) {
      const location = response.headers.get('location');
      await response.body?.cancel().catch(() => {});
      if (!location) return { statusCode: 502, error: 'El servicio de mapas devolvió una redirección incompleta.' };
      currentUrl = new URL(location, currentUrl).toString();
      continue;
    }

    if (!response.ok) {
      await response.body?.cancel().catch(() => {});
      return { statusCode: 502, error: `Maps no permitió resolver el enlace (HTTP ${response.status}).` };
    }

    const coordinates = extractCoordinates(currentUrl);
    if (coordinates) {
      await response.body?.cancel().catch(() => {});
      return { ...coordinates };
    }

    const pageMarkup = await readLimitedBody(response);
    const pageCoordinates = extractCoordinates(pageMarkup);
    if (pageCoordinates) return pageCoordinates;
    return { statusCode: 422, error: 'Se abrió el mapa, pero el enlace no expone coordenadas. Compartí el pin o un enlace completo.' };
  }

  return { statusCode: 502, error: 'El enlace tuvo demasiadas redirecciones y no se pudo resolver.' };
}

async function readJsonBody(request) {
  let body = '';
  for await (const chunk of request) {
    body += chunk;
    if (Buffer.byteLength(body) > MAX_BODY_BYTES) throw new Error('El cuerpo de la solicitud supera el tamaño permitido.');
  }
  return JSON.parse(body || '{}');
}

const server = http.createServer(async (request, response) => {
  const requestUrl = new URL(request.url, `http://${HOST}:${PORT}`);
  if (requestUrl.pathname === '/api/resolve-map-link') {
    if (request.method !== 'POST') {
      response.setHeader('Allow', 'POST');
      sendJson(response, 405, { error: 'Método no permitido.' });
      return;
    }
    try {
      const body = await readJsonBody(request);
      if (typeof body.url !== 'string' || body.url.length > 2048) {
        sendJson(response, 400, { error: 'Pegá un enlace de Maps válido.' });
        return;
      }
      const result = await resolveShortMapLink(body.url);
      const statusCode = result.statusCode || 200;
      sendJson(response, statusCode, result);
    } catch (error) {
      sendJson(response, error instanceof SyntaxError ? 400 : 413, {
        error: error instanceof SyntaxError ? 'La solicitud no tiene JSON válido.' : error.message,
      });
    }
    return;
  }

  if (request.method !== 'GET' && request.method !== 'HEAD') {
    response.writeHead(405, { Allow: 'GET, HEAD' });
    response.end('Method Not Allowed');
    return;
  }
  const staticFile = STATIC_FILES.get(requestUrl.pathname);
  if (!staticFile) {
    response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.end('Not Found');
    return;
  }

  const [fileName, contentType] = staticFile;
  const filePath = path.join(ROOT, fileName);
  fs.readFile(filePath, (error, contents) => {
    if (error) {
      response.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
      response.end('Unable to read application file');
      return;
    }
    response.writeHead(200, {
      'Content-Type': contentType,
      'Content-Length': contents.length,
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
    });
    response.end(request.method === 'HEAD' ? undefined : contents);
  });
});

server.listen(PORT, HOST, () => {
  console.log(`Mesa Lista está disponible en http://${HOST}:${PORT}`);
});
