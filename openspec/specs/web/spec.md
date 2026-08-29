# Spec: Frontend (apps/web)

Delta synced from `frontend-merge-backend-additions` (Engram #91).

## Requirements

### Requirement: Design system foundation
web SHALL add `tailwindcss`, `postcss`, `autoprefixer`, `@tabler/icons-webfont`; add `tailwind.config.ts`, `postcss.config.mjs`, `src/app/globals.css`; update `src/app/layout.tsx` (html/fonts/metadata); add `src/lib/types.ts` adapted to backend shapes (displayName, title/kind, CampaignStatus), replace `src/lib/api.ts` (ApiError class + same-origin proxy), add `src/lib/auth.ts` (useStaffSession + useLogout), copy `src/lib/roles.ts`.

- Scenario: build - GIVEN config files present - WHEN `next build` - THEN compiles with Tailwind + icons.

### Requirement: Staff shell + 11 components
SHALL replace `(staff)/layout.tsx` (Sidebar shell + session check), `login/page.tsx`; add 11 `components/staff/*` (Sidebar, StatCard, StatusPill, CampaignStatusPill, CommentThread, CreateCampaignModal, CreateClientModal, CreateCreativeModal, GenerateLinkModal, InviteUserModal, MagicLink). Components SHALL consume the adapted types (e.g. Sidebar uses `displayName`, StatusPill maps backend CreativeStatus).

- Scenario: sidebar renders user - GIVEN session - THEN name/role from adapters shown.
- Scenario: missing session - THEN redirect to /login.

### Requirement: Core CRUD pages
SHALL replace clients list/detail, campaigns list/detail, creatives detail (filmstrip+comments), upload view (progress via uploadWithProgress). Pages SHALL show loading skeletons, error banners with retry, and empty states.

- Scenario: empty clients - THEN empty-state shown.
- Scenario: fetch error - THEN error banner + retry.

### Requirement: New sections (dashboard, magic-links, settings)
SHALL add `dashboard` (4 StatCards + ActivityList infinite feed), `magic-links` (list + GenerateLinkModal + revoke confirmation), `settings` (AgencyTab, StaffTab, SecurityTab). Consume new endpoints; map backend enums to pills; empty/error/loading states.

- Scenario: stats load - THEN 4 cards render values.
- Scenario: logout shows confirmation - [per reference].
- Scenario: change password error - THEN inline error.

### Requirement: Client portal restyle
Existing `/c/*` routes SHALL be restyled with the design system while keeping existing API calls and tenancy semantics.

- Scenario: existing client URLs - GIVEN `/c/[token]` - THEN renders with new styles, same behavior.
