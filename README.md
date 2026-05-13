# anphuni.com MVP

Rhythm Reactions CIC pipeline MVP with:
- registration/login and session auth
- protected workflow endpoints
- client-scope enforcement (`rhythm-reactions-cic`)
- max 2 registered users for this stage

## Run

```bash
npm run mvp:server
```

Server starts on `http://localhost:8787`.

## Scripts

- `npm run mvp:server` start API
- `npm run mvp:loop` run one full evidence loop
- `npm run mvp:handoff` export handoff + runbook artifacts

Artifacts are written to `artifacts/`.
Runtime data is stored in `data/state.json`.
