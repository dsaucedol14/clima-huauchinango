# Clima Huauchinango

App móvil (PWA) con el pronóstico del clima para Huauchinango, Puebla.

- **Open-Meteo**: condiciones actuales, 48 h por hora y 7 días, y por separado los modelos ECMWF, GFS, ICON y GEM.
- **SMN / CONAGUA**: pronóstico oficial por municipio (estado 21, municipio 71), 4 días.
- **Gemini**: compara las fuentes, corrige sesgos conocidos de la Sierra Norte (lluvia orográfica, niebla, nortes) y entrega un pronóstico consensuado con nivel de confianza, alertas y recomendaciones.

**Sitio:** https://dsaucedol14.github.io/clima-huauchinango/

## Uso local

```bash
cp .env.example .env     # y escribe tu GEMINI_API_KEY
npm start                # http://localhost:3000
```

Requiere Node 18 o superior. No tiene dependencias.

En el celular (misma red Wi-Fi) abre `http://IP-DE-TU-PC:3000`. Para instalarla como app
("Agregar a pantalla de inicio" con modo sin conexión) el navegador exige HTTPS, así que publícala en un
servicio con HTTPS, como la versión de GitHub Pages.

## GitHub Pages

GitHub Pages no ejecuta Node, así que `.github/workflows/pages.yml` corre `scripts/generar.js` cada hora:
consulta Open-Meteo y el SMN, pide a Gemini un análisis nuevo cada 3 horas y publica `public/` junto con
`data/pronostico.json`. La llave se guarda como secret del repositorio (`GEMINI_API_KEY`) y nunca llega al navegador.
Para forzar un análisis nuevo: pestaña **Actions → Publicar en GitHub Pages → Run workflow**.

GitHub pausa los workflows programados de un repositorio sin actividad durante 60 días; si el sitio deja de
actualizarse, reactívalo en la pestaña Actions.

## Estructura

- `lib/pronostico.js`: consulta Open-Meteo y el SMN, y arma el análisis con Gemini.
- `server.js`: servidor local; guarda el resultado 30 minutos en caché (`/api/pronostico`, `?actualizar` lo fuerza).
- `scripts/generar.js`: genera el JSON para GitHub Pages.
- `public/`: la app (HTML, CSS, JS, manifest y service worker).

La llave de Gemini solo vive en el servidor; nunca se envía al teléfono.
