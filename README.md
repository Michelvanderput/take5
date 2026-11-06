# Take 5! Online

Multiplayer Take 5! (6 nimmt!) voor 2–10 spelers. Iedereen speelt in de eigen browser, op het eigen scherm, en ziet alleen de eigen hand.

```bash
npm install
npm start   # http://localhost:3000
```

- Eén speler maakt een kamer en deelt de 4-letterige code (of de link); anderen doen mee.
- De host kan bots toevoegen, de eindscore kiezen (30/45/66/100) en starten.
- Regels volgens de spelbeschrijving: gelijktijdig kiezen, laag→hoog verwerken, kleinste verschil, 6e kaart = rij nemen, te lage kaart = zelf rij kiezen.
- Verbroken verbinding: de sessie wordt hersteld bij herladen; een afwezige speler wordt automatisch gespeeld. Bedenktijd 60 s per beurt.
- Engine: `server/game.js` (puur, getest), netwerk: `server/index.js`. Tests: `npm test`.
