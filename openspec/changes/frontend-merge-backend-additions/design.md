# Design: Frontend Merge + Backend API Completion

## Technical Approach

Extend the existing NestJS modules (Campaigns, Clients, Staff, MagicLinks) with new endpoints following the established `TenancyService.scoped()` + `@Roles()` pattern. Add a Prisma migration for `CampaignStatus`. On the frontend, copy reference files into the monorepo structure, replacing inline `apiJson` with the reference's `apiFetch`/`ApiError` pattern, and adapting field names via a thin adapter layer in `types.ts`.

## Architecture Decisions

### Decision: Extend existing modules vs. new Dashboard/Agency modules

| Option | Tradeoff | Decision |
|--------|----------|----------|
| Add routes to existing CampaignsController/ClientsController | Smaller diff; mixes concerns | Partially: campaigns list/detail/patch go in CampaignsModule; clients detail goes in ClientsModule |
| New `dashboard.controller.ts` + `dashboard.module.ts` | Clean separation for aggregate queries that span campaigns/clients/versions | **Chosen** — dashboard stats/activity queries span multiple models; a dedicated module keeps the tenancy-scoped queries colocated |
| New `agency.controller.ts` + `agency.module.ts` | Clean separation for agency settings | **Chosen** — agency GET/PATCH is a distinct resource |

### Decision: Staff session endpoint location

**Choice**: Add `GET /staff/session` to existing `StaffController`
**Rationale**: StaffController already handles staff CRUD at `@Controller('staff')`; session is staff-specific. SessionGuard already resolves the principal — handler just reads `currentPrincipal()` and queries `User`.

### Decision: Frontend type adapter vs. matching backend to reference names

**Choice**: Adapt in frontend `types.ts` — keep backend field names as-is
**Rationale**: Backend uses Prisma `displayName` consistently across User model and audit trail. Changing it would touch every migration, service, and test. The adapter layer is 5 lines of mapping.

### Decision: Frontend apiFetch vs. apiJson

**Choice**: Replace current `apiJson` with reference-style `apiFetch<T>` + `ApiError`
**Rationale**: `ApiError` carries `status` and `fieldErrors` for richer error handling. The `apiJson` wrapper is redundant — `apiFetch` already does JSON parsing. The 401→redirect logic belongs in the fetch layer.

## Data Flow

```
StaffLayout (SSR)
  ├── getSession() → fetch /api/staff/session → StaffUser
  ├── Sidebar(user) → renders nav + avatar + logout
  └── children (client components)
        ├── useQuery → apiFetch<T>('/api/...') → same-origin proxy → NestJS
        ├── SessionGuard → CsrfGuard → RolesGuard → ContextInterceptor(ALS)
        └── Controller → TenancyService.scoped() → Prisma $extends(tenancy)
```

## File Changes

### Backend (apps/api)

| File | Action | Description |
|------|--------|-------------|
| `prisma/schema.prisma` | Modify | Add `CampaignStatus` enum + `status` field to Campaign |
| `prisma/migrations/20260827000000_add_campaign_status/migration.sql` | Create | `ALTER TABLE "Campaign" ADD COLUMN "status" "CampaignStatus" DEFAULT 'ACTIVE'` |
| `src/campaigns/campaigns.module.ts` | Modify | Add `listFlat()`, `getDetail()`, `updateWithStatus()` to CampaignsService; add `GET /campaigns`, `GET /campaigns/:id`, update `PATCH /campaigns/:id` |
| `src/clients/clients.module.ts` | Modify | Add `getDetail()` to ClientsService; add `GET /clients/:id` |
| `src/staff/staff.controller.ts` | Modify | Add `GET /staff/session`, `POST /staff/change-password`, `PATCH /staff/me` |
| `src/magic-links/magic-links.controller.ts` | Modify | Add `GET /magic-links` list endpoint |
| `src/magic-links/magic-links.service.ts` | Modify | Add `listFlat()` method |
| `src/dashboard/dashboard.controller.ts` | Create | `GET /dashboard/stats`, `GET /dashboard/activity` |
| `src/dashboard/dashboard.service.ts` | Create | Aggregate queries for stats + cursor-paginated activity |
| `src/dashboard/dashboard.module.ts` | Create | Module wiring |
| `src/agency/agency.controller.ts` | Create | `GET /agency`, `PATCH /agency` |
| `src/agency/agency.service.ts` | Create | Agency CRUD |
| `src/agency/agency.module.ts` | Create | Module wiring |
| `src/app.module.ts` | Modify | Import DashboardModule, AgencyModule |
| `test/campaigns/campaigns-extended.spec.ts` | Create | Tests for listFlat, detail, patchWithStatus |
| `test/clients/clients-detail.spec.ts` | Create | Tests for client detail + counts |
| `test/staff/staff-session.spec.ts` | Create | Tests for session, change-password, me |
| `test/magic-links/magic-links-list.spec.ts` | Create | Tests for magic links flat list |
| `test/dashboard/dashboard.spec.ts` | Create | Tests for stats + activity |
| `test/agency/agency.spec.ts` | Create | Tests for GET/PATCH agency |

### Frontend (apps/web)

| File | Action | Description |
|------|--------|-------------|
| `tailwind.config.ts` | Create | Copy from reference; extend theme with ink/paper/accent colors |
| `postcss.config.mjs` | Create | Standard Tailwind PostCSS config |
| `src/app/globals.css` | Create | Copy from reference — CSS custom properties + Tailwind directives |
| `src/app/layout.tsx` | Modify | Add metadata, import globals.css, wrap with Providers |
| `src/app/providers.tsx` | Rename/Modify | Move from `src/app/layout.tsx` inline to separate file (already exists) |
| `src/lib/types.ts` | Create | Adapted from reference — maps `displayName→name`, `title→name`, `kind→type`, `revokedAt→revoked` |
| `src/lib/api.ts` | Replace | New `ApiError` class + `apiFetch<T>` + `uploadWithProgress` (from reference, adapted for same-origin proxy) |
| `src/lib/auth.ts` | Create | `useStaffSession` + `useLogout` hooks (from reference) |
| `src/lib/roles.ts` | Create | `roleLabel()` + `ROLE_OPTIONS` (copy from reference) |
| `src/app/(staff)/layout.tsx` | Replace | Server-side session check + Sidebar shell (from reference) |
| `src/app/login/page.tsx` | Replace | Styled login page (from reference) |
| `src/components/staff/Sidebar.tsx` | Create | Nav + user info + logout (from reference) |
| `src/components/staff/StatCard.tsx` | Create | Dashboard stat card |
| `src/components/staff/StatusPill.tsx` | Create | Creative status pill |
| `src/components/staff/CampaignStatusPill.tsx` | Create | Campaign status pill |
| `src/components/staff/CreateCampaignModal.tsx` | Create | Campaign creation modal |
| `src/components/staff/CreateClientModal.tsx` | Create | Client creation modal |
| `src/components/staff/CreateCreativeModal.tsx` | Create | Creative creation modal |
| `src/components/staff/GenerateLinkModal.tsx` | Create | Magic link generation modal |
| `src/components/staff/MagicLinkModal.tsx` | Create | Client-context magic link modal |
| `src/components/staff/InviteUserModal.tsx` | Create | Staff user invite modal |
| `src/components/staff/CommentThread.tsx` | Create | Comment list + form |
| `src/app/(staff)/page.tsx` | Modify | Redirect to `/dashboard` instead of `/clients` |
| `src/app/(staff)/dashboard/page.tsx` | Create | 4 StatCards + ActivityList |
| `src/app/(staff)/dashboard/ActivityList.tsx` | Create | Cursor-paginated activity feed |
| `src/app/(staff)/clients/page.tsx` | Replace | Grid view with search + create modal |
| `src/app/(staff)/clients/ClientsGrid.tsx` | Create | Client grid component |
| `src/app/(staff)/clients/[id]/page.tsx` | Replace | Client detail page |
| `src/app/(staff)/clients/[id]/ClientDetailView.tsx` | Create | Detail view with campaigns + creatives |
| `src/app/(staff)/campaigns/page.tsx` | Create | Campaigns list page |
| `src/app/(staff)/campaigns/CampaignsList.tsx` | Create | Campaigns list with filters |
| `src/app/(staff)/campaigns/[id]/page.tsx` | Replace | Campaign detail page |
| `src/app/(staff)/campaigns/[id]/CampaignDetailView.tsx` | Create | Detail with creatives + status menu |
| `src/app/(staff)/creatives/[id]/page.tsx` | Replace | Creative detail page |
| `src/app/(staff)/creatives/[id]/CreativeDetailView.tsx` | Create | Filmstrip + comments |
| `src/app/(staff)/upload/[creativeId]/page.tsx` | Replace | Upload page |
| `src/app/(staff)/upload/[creativeId]/UploadView.tsx` | Create | Drag-drop + text paste + progress |
| `src/app/(staff)/magic-links/page.tsx` | Create | Magic links list page |
| `src/app/(staff)/magic-links/MagicLinksList.tsx` | Create | Links list with filters + revoke |
| `src/app/(staff)/settings/page.tsx` | Create | Settings with tabs |
| `src/app/(staff)/settings/AgencyTab.tsx` | Create | Agency name form |
| `src/app/(staff)/settings/ProfileTab.tsx` | Create | Profile + change password |
| `src/app/(staff)/settings/UsersTab.tsx` | Create | Staff user management |

## Interfaces / Contracts

### Backend Response Shapes

```typescript
// GET /api/staff/session
{ id: string; displayName: string; email: string; role: StaffRole; agencyId: string }

// GET /api/campaigns
CampaignListItem[] = { id, clientId, clientName, name, status: CampaignStatus, creativesCount: number, createdAt }

// GET /api/campaigns/:id
CampaignDetail = CampaignListItem & { creatives: { id, title, kind, status, currentVersionNo, updatedAt }[] }

// PATCH /api/campaigns/:id  body: { name?: string, status?: CampaignStatus }

// GET /api/clients/:id
ClientDetail = { id, name, email, contact, createdAt,
  campaigns: { id, name, status, creativesCount }[],
  activeCampaigns: number, totalCreatives: number }

// GET /api/magic-links
MagicLinkListItem[] = { id, clientId, clientName, recipientEmail, createdAt, expiresAt, lastUsedAt, revokedAt }

// GET /api/dashboard/stats
{ pendingReview: number, approvedThisWeek: number, activeClients: number, unresolvedComments: number }

// GET /api/dashboard/activity?cursor=&limit=
{ items: { id, creativeName, clientName, versionNumber, status, updatedAt }[], nextCursor: string|null }

// GET /api/agency → { id, name, createdAt }
// PATCH /api/agency body: { name } → { id, name, createdAt }
// POST /api/staff/change-password body: { currentPassword, newPassword }
// PATCH /api/staff/me body: { displayName } → { id, displayName, email, role, agencyId }
```

### Frontend Type Adapters (types.ts)

```typescript
// Backend → Frontend mapping:
// User.displayName    → StaffUser.name
// Creative.title      → Creative.name
// Creative.kind       → Creative.type
// CreativeVersion.versionNo → Creative.currentVersion
// MagicLink.revokedAt → MagicLink.revoked (boolean)
// CreativeStatus uses backend enum directly (DRAFT/PROCESSING/IN_REVIEW/APPROVED/REJECTED/CHANGES_REQUESTED)

export interface StaffUser {
  id: string;
  name: string;          // ← backend displayName
  email: string;
  role: StaffRole;
  agencyId: string;
}

export interface Creative {
  id: string;
  name: string;          // ← backend title
  type: CreativeType;    // ← backend kind
  campaignId: string;
  campaignName: string;
  currentVersion: number; // ← backend currentVersionNo
  status: CreativeStatus;
}

export interface MagicLink {
  id: string;
  clientId: string;
  clientName: string;
  recipientEmail: string;
  createdAt: string;
  expiresAt: string | null;
  lastUsedAt: string | null;
  revoked: boolean;      // ← backend revokedAt !== null
}
```

### ApiError Class

```typescript
export class ApiError extends Error {
  constructor(message: string, public status: number, public fieldErrors?: Record<string, string>) {
    super(message);
  }
}
```

## Testing Strategy

| Layer | What to Test | Approach |
|-------|-------------|----------|
| Backend unit | Campaign status default, schema validation | Zod parse tests in existing spec style |
| Backend integration | All 12 endpoints × happy/error/tenancy paths | supertest + mocked Prisma (per auth.spec.ts pattern); ~48 test cases |
| Backend tenancy | Cross-agency IDs return 404 | Inject two agency principals, verify isolation |
| Frontend build | Tailwind compiles, types resolve | `next build` passes |
| Frontend components | Pill rendering, modal open/close, empty states | Vitest + @testing-library/react (future) |

### Test Matrix (backend)

1. `staff/session`: staff→200, client→403, no cookie→401
2. `campaigns list`: joins clientName + creativesCount; status filter; search; empty agency→[]
3. `campaigns detail`: 200 with creatives; 404 cross-agency
4. `campaigns PATCH`: status ok; invalid status→400; empty body→400
5. `clients detail`: counts + campaigns; 404
6. `magic-links list`: clientName join; status filter; clientId filter
7. `dashboard/stats`: correct counts; empty→zeros
8. `dashboard/activity`: pagination + cursor + limit cap
9. `agency GET/PATCH`: name valid; empty→400
10. `change-password`: correct→200; wrong→401; short→400
11. `staff/me`: update displayName; empty→400

## Threat Matrix

N/A — no routing, shell, subprocess, VCS/PR automation, executable-file classification, or process-integration boundary.

## Migration / Rollout

1. Run Prisma migration: `npx prisma migrate dev --name add_campaign_status`
2. Backfill: existing campaigns get `status = 'ACTIVE'` (migration DEFAULT handles this)
3. Frontend deploy is backward-compatible — new endpoints are consumed by new pages; old pages continue working until replaced

## Open Questions

- Should the `GET /api/clients` flat list (existing) also return `activeCampaigns`/`totalCreatives` counts, or only the detail endpoint? The spec only requires counts on detail; the grid view currently shows them — this implies the frontend needs to either call detail per card (N+1) or the list endpoint needs counts. **Recommendation**: Add counts to the list endpoint response.
- The reference frontend's `MagicLinksList` revokes via `PATCH /magic-links/:id` with `{revoked: true}`, but the backend only has `POST /magic-links/:id/revoke`. **Decision**: Use the existing backend endpoint (`POST /:id/revoke`) and adapt the frontend mutation accordingly.
- The reference frontend's `CreateCampaignModal` calls `POST /api/campaigns` (flat), but the backend only has `POST /clients/:clientId/campaigns`. **Decision**: Add a flat `POST /api/campaigns` route that accepts `{ clientId, name }` in the body.
