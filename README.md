# intervals-mcp

Server MCP per [intervals.icu](https://intervals.icu): legge i dati di allenamento e crea
allenamenti strutturati sul calendario, da cui intervals.icu li spinge sull'orologio
(Garmin, Wahoo, Zwift, Coros, Suunto).

Usa l'API pubblica ufficiale (`https://intervals.icu/api/v1`, Basic auth con API key).

## Setup

```bash
npm install
npm run build
cp .env.example .env    # e incolla la tua API key
```

L'API key si trova su intervals.icu → **Settings** → **Developer Settings** → *API Key*.
L'athlete id (`i123456`) viene rilevato automaticamente dalla key; se serve forzarlo, c'è
`INTERVALS_ATHLETE_ID` nel `.env`.

Verifica che tutto risponda:

```bash
npm run smoke            # solo lettura
npm run smoke -- --write # crea un allenamento di test domani, lo verifica e lo cancella
```

### Registrazione in Claude Code

```bash
claude mcp add intervals -- node /percorso/assoluto/intervals-mcp/dist/index.js
```

La key non va nella config del client: il server legge il `.env` accanto al package.
In alternativa, per tenerla nella config: `claude mcp add intervals --env INTERVALS_API_KEY=... -- node .../dist/index.js`.

Per Claude Desktop, in `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "intervals": {
      "command": "node",
      "args": ["/percorso/assoluto/intervals-mcp/dist/index.js"]
    }
  }
}
```

In sviluppo: `npm run dev` (tsx, senza build).

## Deploy remoto su Vercel (opzionale)

Serve solo se vuoi usarlo **senza il Mac acceso** — da claude.ai, dal telefono, o per condividerlo.
In locale lo stdio resta più semplice e la chiave non si muove dalla tua macchina.

`api/mcp.ts` è una Vercel Node function che espone lo stesso server su Streamable HTTP, in
modalità **stateless** (server e transport costruiti per richiesta, `enableJsonResponse`): l'unica
che funziona su serverless, senza Redis né sessioni in memoria. Nessun framework: niente Next.js,
solo la function e l'SDK ufficiale.

```bash
npm run token       # genera un segreto da 32 byte base64url
vercel env add MCP_AUTH_TOKEN production
vercel env add INTERVALS_API_KEY production
vercel --prod
```

Env var richieste sul server: `INTERVALS_API_KEY`, `MCP_AUTH_TOKEN`, opzionale
`INTERVALS_ATHLETE_ID`. **La API key di intervals.icu resta lato server**: nel client finisce solo
il token.

### Due modi per autenticarsi, perché i client differiscono

```bash
# Claude Code: header custom (supportati)
claude mcp add --transport http intervals-remote https://<deploy>/mcp \
  --header "Authorization: Bearer <token>"
```

Per i client che non mandano header custom — su claude.ai l'auth via request header esiste ma è in
beta/rollout — il token va nel path, che è solo un URL:

```
https://<deploy>/mcp/<token>
```

Le rewrite in `vercel.json` mappano `/mcp` e `/mcp/:token` sulla function. Il server accetta il
token da `Authorization: Bearer`, `x-api-key`, `x-auth-token`, dal path o da `?token=`.

**Preferisci l'header:** un segreto nel path finisce nei log di richiesta. Il confronto è a tempo
costante su digest SHA-256, il 401 risponde con `WWW-Authenticate` e non rivela nulla, e il server
**si rifiuta di partire** senza `MCP_AUTH_TOKEN` (o con un token più corto di 24 caratteri):
meglio un 500 che un endpoint aperto che scrive sul tuo account.

Il token vale quanto la API key — chi lo ha legge e scrive sul tuo intervals.icu. Rotazione =
cambio env var + redeploy. Per condividere il server con altri servirebbe OAuth vero, con il
client_id da richiedere a david@intervals.icu.

`npm test` copre i casi di autenticazione (token valido/errato/assente, le varie vie, rotta non
confusa per token).

## Tool disponibili

### Lettura
| Tool | Cosa fa |
|---|---|
| `get_athlete` | Profilo + soglie per sport (FTP, indoor FTP, LTHR, max HR, threshold pace, zone) + configurazione push Garmin |
| `list_activities` | Attività completate in un intervallo di date (default: ultimi 30 giorni) |
| `get_activity` | Dettaglio di una attività: load, intensità, tempo in zona, decoupling, EF, running dynamics |
| `get_activity_intervals` | Intervalli/lap rilevati, con potenza, HR, passo, cadenza, load per ripetuta |
| `search_activities` | Ricerca per nome o `#tag` |
| `get_wellness` | Fitness (CTL), Fatigue (ATL), Form (TSB), peso, HRV, sonno, readiness… (default: 14 giorni) |
| `list_calendar_events` | Allenamenti pianificati e altri eventi; con `resolve=true` mostra i target già convertiti in watt/bpm/m·s⁻¹ |
| `get_event` | Un singolo evento del calendario |
| `workout_syntax_guide` | Riferimento completo della sintassi workout di intervals.icu |

### Scrittura
| Tool | Cosa fa |
|---|---|
| `create_workout` | Crea un allenamento strutturato sul calendario e (default) lo rilegge con i target risolti per verifica |
| `create_workouts` | Versione bulk: una settimana o un blocco in una sola chiamata, con `upsert` su `external_id` |
| `update_workout` | Modifica un evento esistente (solo i campi passati) |
| `delete_event` | Cancella un evento |
| `set_wellness` | Aggiorna i valori wellness di una data |
| `check_garmin_push` | Diagnostica del push: upload attivo?, ultimo upload, range applicati, `push_errors` sugli allenamenti in arrivo |

## Come arrivano gli allenamenti sul Garmin

1. `create_workout` scrive un evento `category: "WORKOUT"` sul calendario; il campo
   `description` contiene l'allenamento nella sintassi testuale di intervals.icu.
2. intervals.icu lo interpreta e ne costruisce la struttura (`workout_doc`).
3. Se su intervals.icu → Settings, nel box Garmin, è attivo **Upload planned workouts**
   (con Garmin Connect autorizzato), i prossimi giorni di calendario vengono caricati su
   Garmin Connect e da lì arrivano all'orologio.
4. Eventuali problemi finiscono in `push_errors` sull'evento → `check_garmin_push`.

Scrivendo i target in **percentuale** (di FTP / LTHR / max HR / threshold pace) l'allenamento
segue automaticamente le soglie correnti dell'atleta: la conversione in watt/bpm/passo avviene
al momento del push, e Garmin riceve un *range* (ampiezza configurabile nelle impostazioni
Garmin di intervals.icu).

Esempio di `description` per una sessione di corsa:

```
Warmup
- 12m 70% Pace

Main set 5x
- 1km 100% Pace
- 90s 60% Pace

Cooldown
- 8m 65% Pace
```

Attenzione: `m` significa **minuti**, i metri si scrivono `mtr` (`400mtr`).
La sintassi completa è in `src/workout-syntax.ts`, esposta anche come tool
(`workout_syntax_guide`) e come risorsa MCP (`intervals://workout-syntax`).

## Troubleshooting: l'allenamento arriva sul Garmin senza target

Sintomo: sull'orologio gli step ci sono, con distanze e nomi giusti, ma ognuno mostra
"No Target". Su intervals.icu il `workout_doc` sembra perfetto.

Causa: **manca la soglia del tipo di target usato** nelle sport settings di quello sport
(threshold pace per il passo, FTP per la potenza). In quel caso intervals.icu elimina i target
dal file che manda al dispositivo — **anche quando l'allenamento usa valori assoluti**, dove
la soglia non servirebbe a niente. L'HR non ne soffre se LTHR o max HR sono impostate.

Verificato decodificando il FIT generato:

```bash
curl -s -u "API_KEY:$INTERVALS_API_KEY" \
  "https://intervals.icu/api/v1/athlete/0/events/<eventId>/download.fit" -o w.fit
python3 scripts/fitdump.py w.fit
```

Senza threshold pace ogni step esce `target=open`; impostata la soglia, lo stesso evento
esporta `target=speed` con i range corretti. `create_workout` ora fa questo controllo da sé e
restituisce un `device_export_warning` prima che il problema arrivi all'orologio.

Nota: l'upload parte a fronte di una **modifica dell'evento**. Sistemare la soglia non
ricarica necessariamente un allenamento già spinto — va toccato l'evento (basta riscriverne la
description) per far ripartire il push.

## Struttura

```
src/
  index.ts             bootstrap del server MCP (stdio) + risorsa sintassi
  client.ts            client HTTP: Basic auth, athlete id, errori parlanti
  format.ts            riduzione dei payload (Activity ha 183 campi) e formattazione
  dates.ts             date locali dell'atleta
  workout-syntax.ts    cheat sheet + guida completa
  tools/               athlete, activities, wellness, events
scripts/smoke.ts       verifica end-to-end sull'API reale
```

## Note sull'API

- Auth: Basic, username letterale `API_KEY`, password = la tua key.
- Le date sono sempre **locali** dell'atleta, senza timezone (`2026-08-20`, `2026-08-20T18:30:00`).
- Le liste accettano `fields=` per ridurre il payload: qui è già usato con set di campi curati.
- Spec OpenAPI completa (117 endpoint): <https://intervals.icu/api/v1/docs/>.
