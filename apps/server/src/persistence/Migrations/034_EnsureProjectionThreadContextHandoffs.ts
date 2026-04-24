import createProjectionThreadContextHandoffs from "./029_ProjectionThreadContextHandoffs.ts";

// Existing Dynamo databases may already contain fork-only migration ids above
// 29 from before the upstream merge. Re-run the idempotent handoff DDL at a
// higher id so those databases get the table without manual cleanup.
export default createProjectionThreadContextHandoffs;
