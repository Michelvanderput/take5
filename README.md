# Take 5! Online

Multiplayer Take 5! (6 nimmt!) voor 2–10 spelers. Iedereen speelt in de eigen browser, op het eigen scherm, en ziet alleen de eigen hand.

```bash
npm install
npm start   # http://localhost:3000
```

- Eén speler maakt een kamer en deelt de 4-letterige code (of de link); anderen doen mee.
- De host kan bots toevoegen, de eindscore kiezen (30/45/66/100) en starten.
- Regels volgens de spelbeschrijving: gelijktijdig kiezen, laag→hoog verwerken, kleinste verschil, 6e kaart = rij nemen, te lage kaart = zelf rij kiezen.
- Een afwezige speler (>12 s geen contact) wordt automatisch gespeeld. Bedenktijd 60 s per beurt.
- Engine: `server/game.js` (puur, getest), kamerlogica: `server/room.js`, API: `server/api.js` + `api/game.js`. Tests: `npm test`.

## Deploy op Vercel (gratis)

Vercel kent geen WebSockets en functies zijn stateless. Daarom pollt de browser elke ~0,8 s `/api/game` en staat de spelstatus in een Postgres-database (gratis **Neon**).

1. Importeer de repo in Vercel (geen build-instellingen nodig; `public/` is de site, `api/` de functie).
2. Vercel → Storage / Marketplace → **Neon (Postgres)** → gratis plan, koppel aan het project. Dat zet `DATABASE_URL` automatisch. (Elke andere Postgres met `DATABASE_URL` werkt ook.)
3. Redeploy. De tabellen worden bij het eerste verzoek zelf aangemaakt; kamers ouder dan 6 uur worden opgeruimd.

Lokaal: `npm start` gebruikt geheugenopslag, geen database nodig.
Tests tegen echte Postgres: `TEST_PG_URL=postgres://... npm test` (vereist `npm i --no-save pg`).
