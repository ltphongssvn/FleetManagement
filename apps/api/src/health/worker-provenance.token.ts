// apps/api/src/health/worker-provenance.token.ts
// DI token for the worker-heartbeat reader.
//
// In its own file, mirroring database.tokens.ts: the module must import the
// token to bind a provider, and the controller must import it to inject one.
// Declaring it in the controller would make the module import the controller
// just to name a symbol, and a token that lives inside its own consumer is the
// usual seed of a circular import.
export const WORKER_PROVENANCE_READER = Symbol('WORKER_PROVENANCE_READER');
