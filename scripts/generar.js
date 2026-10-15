// Genera public/data/pronostico.json para la versión de GitHub Pages.
// Lo ejecuta GitHub Actions cada hora (.github/workflows/pages.yml).
// Gemini solo se consulta cada IA_CADA_H horas; entre tanto se reutiliza el
// último análisis publicado en SITIO_URL.

const fs = require('fs');
const path = require('path');
const { obtenerFuentes, analizarConIA } = require('../lib/pronostico');

const SITIO_URL = process.env.SITIO_URL || '';
const IA_CADA_H = Number(process.env.IA_CADA_H) || 3;
const FORZAR_IA = process.env.FORZAR_IA === 'true';
const SALIDA = path.join(__dirname, '..', 'public', 'data', 'pronostico.json');

async function iaAnterior() {
  if (!SITIO_URL) return null;
  try {
    const res = await fetch(new URL('data/pronostico.json', SITIO_URL), { signal: AbortSignal.timeout(20000) });
    if (!res.ok) return null;
    const ia = (await res.json()).ia;
    return ia?.resumen ? ia : null;
  } catch {
    return null;
  }
}

(async () => {
  const fuentes = await obtenerFuentes();
  console.log(`Open-Meteo: ok. SMN: ${fuentes.smn.length} días${fuentes.smnError ? ` (error: ${fuentes.smnError})` : ''}.`);

  const anterior = await iaAnterior();
  const edadH = anterior ? (Date.now() - new Date(anterior.generado).getTime()) / 3600e3 : Infinity;
  let ia;

  if (!FORZAR_IA && edadH < IA_CADA_H) {
    console.log(`IA: se reutiliza el análisis de hace ${edadH.toFixed(1)} h.`);
    ia = anterior;
  } else {
    try {
      ia = await analizarConIA(fuentes);
      console.log(`IA: nuevo análisis con ${ia.modelo}.`);
    } catch (e) {
      console.log(`IA: ${e.message}`);
      ia = anterior ?? { error: e.message };
    }
  }

  fs.mkdirSync(path.dirname(SALIDA), { recursive: true });
  fs.writeFileSync(SALIDA, JSON.stringify({ ...fuentes, ia }));
  console.log(`Escrito ${SALIDA}`);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
