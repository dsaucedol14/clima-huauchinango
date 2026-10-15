// Servidor local de Clima Huauchinango.
// Sirve la app móvil (PWA) de public/ y la API con Open-Meteo, SMN y Gemini.
// Sin dependencias: requiere Node 18 o superior.

const http = require('http');
const fs = require('fs');
const path = require('path');

cargarEnv(path.join(__dirname, '.env'));
const { GEMINI_API_KEY, GEMINI_MODELOS, obtenerFuentes, analizarConIA } = require('./lib/pronostico');

const PORT = Number(process.env.PORT) || 3000;
const CACHE_MIN = 30;

const cache = { fuentes: null, ia: null }; // { fecha, datos }
const enCurso = { fuentes: null, ia: null };

function cargarEnv(archivo) {
  if (!fs.existsSync(archivo)) return;
  for (const linea of fs.readFileSync(archivo, 'utf8').split(/\r?\n/)) {
    const m = linea.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

// Ejecuta tarea() una sola vez aunque lleguen varias peticiones, y guarda el
// resultado CACHE_MIN minutos. Los errores no se guardan.
async function conCache(clave, forzar, tarea) {
  const c = cache[clave];
  if (!forzar && c && Date.now() - c.fecha < CACHE_MIN * 60e3) return c.datos;
  if (!enCurso[clave]) {
    enCurso[clave] = tarea()
      .then((datos) => {
        cache[clave] = { fecha: Date.now(), datos };
        return datos;
      })
      .finally(() => {
        enCurso[clave] = null;
      });
  }
  return enCurso[clave];
}

const fuentes = (forzar) => conCache('fuentes', forzar, obtenerFuentes);
const ia = (forzar) => conCache('ia', forzar, async () => analizarConIA(await fuentes(false)));

// ---------------------------------------------------------------- servidor HTTP

const TIPOS = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
};
const PUBLICO = path.join(__dirname, 'public');

http
  .createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');

    const api = { '/api/pronostico': fuentes, '/api/ia': ia }[url.pathname];
    if (api) {
      try {
        const datos = await api(url.searchParams.has('actualizar'));
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
        res.end(JSON.stringify(datos));
      } catch (e) {
        res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ error: e.message }));
      }
      return;
    }

    const ruta = path.normalize(path.join(PUBLICO, url.pathname === '/' ? 'index.html' : url.pathname));
    if (!ruta.startsWith(PUBLICO)) {
      res.writeHead(403).end();
      return;
    }
    fs.readFile(ruta, (err, contenido) => {
      if (err) {
        res.writeHead(404).end('No encontrado');
        return;
      }
      res.writeHead(200, { 'Content-Type': TIPOS[path.extname(ruta)] || 'application/octet-stream' });
      res.end(contenido);
    });
  })
  .listen(PORT, '0.0.0.0', () => {
    console.log(`Clima Huauchinango en http://localhost:${PORT}`);
    console.log(`Modelos de Gemini, en orden: ${GEMINI_MODELOS.join(', ')}`);
    if (!GEMINI_API_KEY) console.log('Aviso: sin GEMINI_API_KEY; la app funcionará sin el pronóstico de IA.');
  });
