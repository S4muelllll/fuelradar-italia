# FuelRadar Italia

Sito web full-stack per confrontare prezzi carburante italiani con dati live dell'Osservaprezzi del Ministero delle Imprese e del Made in Italy (MIMIT).

## Cosa fa
- geolocalizzazione browser o ricerca città/indirizzo/CAP;
- confronto di benzina, diesel, GPL e metano;
- ordinamento dal prezzo più basso;
- distanza e modalità self/servito;
- mappa OpenStreetMap + Leaflet;
- aggiornamento automatico ogni 2 minuti mentre la pagina è aperta;
- avvisi quando il miglior prezzo cambia oltre la soglia configurata;
- notifiche browser opzionali;
- link alle indicazioni stradali.

## Avvio

```bash
npm install
npm start
```

Apri `http://localhost:8787`.

## Dati
Il backend usa l'endpoint pubblico dell'Osservaprezzi MIMIT `https://carburanti.mise.gov.it/ospzApi/search/zone` come sorgente dei dati nella zona selezionata. La chiave API non è necessaria.

Il progetto fa da proxy lato server per evitare di esporre direttamente il servizio ministeriale nel browser e per poter controllare caching e timeout.

## Nota sugli "avvisi in tempo reale"
Il Ministero descrive l'Osservaprezzi come servizio per la consultazione in tempo reale dei prezzi praticati. Il sito controlla la fonte a intervalli di 2 minuti mentre è aperto; non è un sistema push del Ministero e quindi un cambio viene rilevato al successivo controllo.

## Deploy
Funziona su servizi Node standard (Render, Railway, Fly.io, VPS, ecc.). Imposta il port `PORT` se il provider lo richiede.
