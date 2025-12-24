Project:
- Project Key: NOTION
- Project Name: Notion-API
- Repository: Notion-API
- Default Branch: main
- Status: Active
- Description: Internal engineering project that provides deterministic tooling to sync Git activity and Markdown specs into Notion Projects and Tickets without MCP or agent state.

Tickets:
- Title: Spec Init
  Ticket Number: 1001
  Priority: Medium
  Status: Done
  Type: Feature
  Branch: chore/spec-init
  Dev Notes: Establish the Notion-API markdown spec format, initialize the project schema, and document the immutable ticket numbering rules for ongoing sync.
- Title: Diff Sync
  Ticket Number: 1002
  Priority: High
  Status: Review
  Type: Feature
  Branch: chore/diff-sync
  Dev Notes: Implement diff-based reconciliation so spec edits update Notion ticket fields without recreating tickets, while preserving ticket numbers as immutable identifiers.
- Title: Git Log
  Ticket Number: 1003
  Priority: Medium
  Status: Done
  Type: Feature
  Branch: chore/git-log
  Dev Notes: Wire git log ingestion to classify commits by branch and prepare per-ticket comment payloads for Notion sync.
- Title: Last Sync
  Ticket Number: 1004
  Priority: Medium
  Status: Review
  Type: Feature
  Branch: chore/last-sync
  Dev Notes: Add last-sync baseline tracking to ensure incremental syncs only append new commits and avoid duplicate Notion comments.
- Title: CLI UX
  Ticket Number: 1005
  Priority: Medium
  Status: Done
  Type: Feature
  Branch: chore/cli-ux
  Dev Notes: Refine CLI commands, usage output, and error handling so init and sync workflows are predictable and safe to rerun.
- Title: Infra Hardening
  Ticket Number: 1006
  Priority: Low
  Status: Done
  Type: Tech Debt
  Branch: techdebt/infra-hardening
  Dev Notes: Harden infra reliability with defensive checks, stable defaults, and clearer failure modes for Notion API responses.
- Title: Ticket Guard
  Ticket Number: 1007
  Priority: Medium
  Status: Done
  Type: Tech Debt
  Branch: techdebt/ticket-immutability
  Dev Notes: Enforce ticket-number immutability in tooling to prevent accidental overwrites or duplicate creation across sync cycles.
- Title: Notion Errors
  Ticket Number: 1008
  Priority: Low
  Status: Done
  Type: Tech Debt
  Branch: techdebt/notion-error-handling
  Dev Notes: Improve error parsing and surfaced messages for Notion API failures so operators can diagnose issues quickly.
