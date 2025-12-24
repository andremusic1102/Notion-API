Project:
- Project Key: NOTION-REINIT
- Project Name: Notion-API Reinit
- Repository: Notion-API
- Default Branch: main
- Status: Active
- Description: Deterministic tooling to sync Git activity and Markdown specs into Notion Projects and Tickets for the Notion-API repo.

Tickets:
- Title: Project-aware Init
  Ticket Number: 001
  Priority: High
  Status: Backlog
  Type: Feature
  Branch: chore/project-aware-init
  Dev Notes: Initialize Notion-API with a project-aware spec flow and ensure repo root detection stays stable for future re-runs.
- Title: Spec Generation
  Ticket Number: 002
  Priority: High
  Status: Backlog
  Type: Feature
  Branch: chore/spec-generation
  Dev Notes: Generate a clear markdown spec derived from README and folder layout for consistent Notion project setup.
- Title: Sync Pipeline
  Ticket Number: 003
  Priority: High
  Status: Backlog
  Type: Feature
  Branch: chore/sync-pipeline
  Dev Notes: Keep sync behavior deterministic for project creation, ticket updates, and spec-driven field updates.
- Title: Git Log Ingestion
  Ticket Number: 004
  Priority: Medium
  Status: Backlog
  Type: Feature
  Branch: chore/git-log-ingestion
  Dev Notes: Map git commits to ticket branches and ensure comments are appended without duplication.
- Title: Last Sync Baseline
  Ticket Number: 005
  Priority: Medium
  Status: Backlog
  Type: Feature
  Branch: chore/last-sync-baseline
  Dev Notes: Maintain last-sync state to support incremental sync runs and avoid repeated writes.
- Title: Ticket Number Guard
  Ticket Number: 006
  Priority: Medium
  Status: Backlog
  Type: Tech Debt
  Branch: techdebt/ticket-number-guard
  Dev Notes: Enforce immutable ticket numbers across init and sync to prevent duplicates.
- Title: Error Handling
  Ticket Number: 007
  Priority: Low
  Status: Backlog
  Type: Tech Debt
  Branch: techdebt/error-handling
  Dev Notes: Improve Notion API error reporting for predictable operator response.
