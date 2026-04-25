import ensureProjectionThreadTeamTaskNativeSource from "./039_ProjectionThreadTeamTaskNativeSource.ts";

// Existing local Dynamo databases may already contain migration id 39 from a
// prior fork state. Re-run the idempotent native task DDL at a higher id so
// those databases get the columns without manual migration receipt cleanup.
export default ensureProjectionThreadTeamTaskNativeSource;
