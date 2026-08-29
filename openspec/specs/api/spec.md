# Spec: Backend API (apps/api)

Delta synced from `frontend-merge-backend-additions` (Engram #91), aligned per verify warning #2: schema enum has no `PENDING`; "pending review" semantics are `ReviewStatus.NONE`.

## Requirements

### Requirement: Campaign status field
The Campaign model SHALL add `status CampaignStatus @default(ACTIVE)`; enum MUST be `ACTIVE | PAUSED | ARCHIVED`. Migration: `20260827000000_add_campaign_status`.

- Scenario: default on create - GIVEN a campaign is created without status - WHEN persisted - THEN `status` is `ACTIVE`.
- Scenario: existing rows - GIVEN pre-migration campaigns - WHEN migration runs - THEN all rows become `ACTIVE`.

### Requirement: GET /api/staff/session
Returns the authenticated staff user. SHALL require a valid STAFF session; response MUST be `{ id, displayName, email, role, agencyId }` from the session principal's user. Guarded by session + roles (all staff roles).

- Scenario: valid staff session - GIVEN logged-in staff - WHEN GET /api/staff/session - THEN 200 with the user's `id/displayName/email/role/agencyId`.
- Scenario: client session - GIVEN a CLIENT session - WHEN GET /api/staff/session - THEN 403/401 (non-staff denied).

### Requirement: GET /api/campaigns (flat list)
SHALL return all campaigns in the agency with `clientName` (join Campaign→Client) and `creativesCount` (count Campaign→Creative). Query: `?status=ACTIVE|PAUSED|ARCHIVED` filters; `?search=term` matches campaign name or client name (case-insensitive). Response `CampaignListItem[]`: `{ id, clientId, clientName, name, status, creativesCount, createdAt }`. Roles: all staff.

- Scenario: list with joins - GIVEN campaigns across clients - WHEN GET /api/campaigns - THEN each item has `clientName` and `creativesCount`.
- Scenario: status filter - GIVEN `?status=ARCHIVED` - THEN only ARCHIVED returned.
- Scenario: search - GIVEN `?search=acme` - THEN name/client match only.

### Requirement: GET /api/campaigns/:id (detail)
SHALL return a single campaign as `CampaignListItem` plus `creatives: CreativeSummary[]`; CreativeSummary `{ id, title, kind, status, currentVersionNo, updatedAt }` where `currentVersionNo` is the max versionNo of the creative. 404 if not in agency. Roles: all staff.

- Scenario: found - GIVEN existing campaign - THEN 200 with creatives (empty array if none).
- Scenario: not found / cross-agency - THEN 404.

### Requirement: PATCH /api/campaigns/:id (update name+status)
SHALL accept body `{ name?: string, status?: CampaignStatus }`; validate `status` against the enum; at least one field required; returns updated campaign. Roles: existing convention (all staff). Empty update MUST 400.

- Scenario: update status - GIVEN `{ status: "PAUSED" }` - THEN 200 with PAUSED.
- Scenario: invalid status - GIVEN `{ status: "BOGUS" }` - THEN 400.
- Scenario: empty body - THEN 400.

### Requirement: GET /api/clients/:id (detail + counts)
SHALL add a detail route to ClientsController returning the client plus `campaigns: CampaignSummary[]` (`{ id, name, status, creativesCount }`), `activeCampaigns: number`, `totalCreatives: number`. 404 if not in agency. Roles: all staff.

- Scenario: detail with counts - GIVEN client with campaigns/creatives - THEN 200 with campaigns array and both counts.
- Scenario: not found - THEN 404.

### Requirement: GET /api/magic-links (flat list)
SHALL return all magic links in the agency joined to Client for `clientName`. Query `?clientId=` filters by client; `?status=active|revoked` derives from `revokedAt` (active = `revokedAt IS NULL`). Response `MagicLinkListItem[]`: `{ id, clientId, clientName, recipientEmail, createdAt, expiresAt, lastUsedAt, revokedAt }`. Roles: SUPER_ADMIN, ACCOUNT_MANAGER.

- Scenario: list with clientName - THEN each item has `clientName`.
- Scenario: status filter active - GIVEN `?status=active` - THEN only non-revoked returned.
- Scenario: clientId filter - THEN only that client's links.

### Requirement: GET /api/dashboard/stats
SHALL return `{ pendingReview, approvedThisWeek, activeClients, unresolvedComments }` where: pendingReview = creativeVersions with `state=READY` and `reviewStatus=NONE` (schema-consistent "pending review" semantics — the schema enum is `NONE | APPROVED | REJECTED | CHANGES_REQUESTED`, with `ReviewStatus.NONE` used as the pending proxy; there is no `PENDING` value in the schema); approvedThisWeek = reviewEvents with decision APPROVED in current week; activeClients = distinct clients having creatives; unresolvedComments = comments with no reply. Roles: all staff.

- Scenario: aggregates computed - GIVEN seeded data - THEN correct count each field.
- Scenario: empty agency - THEN all zeros.

### Requirement: GET /api/dashboard/activity (cursor-paginated)
SHALL return `{ items: ActivityItem[], nextCursor: string|null }`; ActivityItem `{ id, creativeName, clientName, versionNumber, status, updatedAt }` via Version→Creative→Campaign→Client joins. Query `?cursor=`, `?limit=` (default 20, cap 50); `nextCursor` null when exhausted. Roles: all staff.

- Scenario: first page - GIVEN many versions - THEN up to `limit` items + cursor.
- Scenario: cursor page - THEN items after cursor.
- Scenario: last page - THEN nextCursor null.

### Requirement: Agency endpoints GET/PATCH /api/agency
GET SHALL return `{ id, name, createdAt }` for the current agency. PATCH SHALL accept `{ name }`, validate non-empty, return updated agency. Roles: all staff (GET); PATCH all staff (single agency).

- Scenario: get - THEN 200 with agency fields.
- Scenario: patch name - GIVEN valid name - THEN 200 updated.
- Scenario: patch empty name - THEN 400.

### Requirement: POST /api/staff/change-password
SHALL accept `{ currentPassword, newPassword }`; verify current password (argon2), newPassword min length 10; on success rehash and 200. Wrong current password SHALL 400/401. Roles: all staff.

- Scenario: correct current - THEN 200, hash updated.
- Scenario: wrong current - THEN 400/401.

### Requirement: PATCH /api/staff/me
SHALL accept `{ displayName }`, validate min length, update own user, return updated fields. Roles: all staff.

- Scenario: update own displayName - THEN 200.
- Scenario: empty displayName - THEN 400.

### Requirement: DELETE campaign with creatives (unchanged)
(Previously: campaign delete blocked when creatives exist — unchanged.)

- Scenario: [existing] still enforced.

## Test scenarios (new endpoints)
1. staff/session: staff 200 / client 401 / no cookie 401.
2. campaigns list: joins, status filter, search; 200.
3. campaigns detail: 200 with creatives; 404 cross-agency.
4. campaigns PATCH: status ok, invalid 400, empty 400.
5. clients detail: counts + campaigns; 404.
6. magic-links list: clientName; status/clientId filters.
7. dashboard/stats: per-field counts; empty = zeros.
8. dashboard/activity: pagination + cursor + limit cap.
9. agency: GET; PATCH valid + empty 400.
10. change-password: success, wrong current, short new.
11. staff/me: valid + empty 400.
12. tenancy: cross-agency ids return 404 (not data leak).
