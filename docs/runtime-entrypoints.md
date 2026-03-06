# Runtime Entrypoints

## Production Web Runtime
- `apps/web/index.html` loads `src/main.tsx`
- `apps/web/src/App.tsx` is the production workspace shell
- `apps/web/src/components/Editor.tsx` is the production document editor surface

## Prototype / Experimental Runtime
- `apps/web/src/main.js` is a BlockSuite sandbox prototype
- `apps/web/src/components/agent-dashboard/*` is experimental showcase UI, not the production entrypoint
- `notion-ui-prototype.html` is a prototype artifact, not part of the production runtime

## Server Runtime
- `apps/server/src/index.ts` is the production server entrypoint
- route registration happens from `apps/server/src/index.ts`

## Rule
- ship production changes through `main.tsx` / `App.tsx`
- do not wire `main.js` into the production runtime without a separate integration plan
