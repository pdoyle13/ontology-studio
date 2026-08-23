// Compatibility shim — the driver layer now lives in server/connectors/
// (pluggable: drop a module exporting { meta, create } into that directory).

export { createDriver, safeDescriptor, connectorKinds } from './connectors/registry.mjs';
export { pgTypeName } from './connectors/postgres.mjs';
