# src/domain/ — AGENTS.md

Core frontend domain layer. Manages the WebSocket transport, session state, and message routing between the React UI and the sidecar. This is where frontend↔sidecar communication is orchestrated.

## OVERVIEW

`sessionService.ts` is the central orchestrator: it owns the WebSocket lifecycle, sends `ClientMessage`s, and routes `ServerMessage`s to the appropriate Zustand stores. `sessionStore.ts` is the state machine that translates server messages into UI view models.

## STRUCTURE

```
domain/
├── transport.ts         # Transport interface (seam for mock vs real)
├── wsTransport.ts       # WsTransport: polls get_sidecar_info, opens WebSocket
├── sessionService.ts    # Central orchestrator (424 lines): connect, disconnect, send, receive routing
├── sessionStore.ts      # Zustand store (396 lines): sessions[], messages[], applyServerMessage() reducer
├── hooks.ts             # React hooks: useActiveSession(), useActiveMessages(), useActiveInterrupt()
└── index.ts             # Public API barrel
```

## DATA FLOW

```
WebSocket message
  → ws-client.ts (raw JSON)
    → wsTransport.ts (Transport interface)
      → sessionService.receive() (central routing)
        ├─→ sessionStore.apply() (session/message state)
        ├─→ fsStore.setEntries() / setPreview()
        ├─→ diffStore.setResult() / setCheckpoints()
        └─→ providersStore.setKeyConfigured()
```

## WHERE TO LOOK

| Task | File | Notes |
|------|------|-------|
| Add WS message handling | `sessionStore.ts` | `applyServerMessage()` — 150-line pure reducer, 20+ msg types |
| Connect/disconnect | `sessionService.ts` | `connect()`, `disconnect()`, WebSocket lifecycle |
| Session CRUD | `sessionService.ts` | `sendMessage()`, `createSession()`, `deleteSession()` |
| WS reconnect | Fetch → `src/ipc/ws-client.ts` | Exponential backoff (500ms→10s), epoch tracking |

## ANTI-PATTERNS

- **sessionService is constructed at import time** (module-level singleton) — `export const sessionService = new SessionService(new WsTransport())`
- **Connection type duplicated**: `ConnectionStatus` (transport.ts) and `Connection` (sessionStore.ts) are identical types with different names
