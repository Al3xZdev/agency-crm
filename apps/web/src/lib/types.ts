/**
 * Frontend type adapters — BACKEND shapes, never the reference's names.
 *
 * The API is the source of truth and keeps Prisma field names: `displayName`
 * (not `name`), `title`/`kind` on creatives (not `name`/`type`), `revokedAt`
 * (not `revoked`), ISO `createdAt`. Components consume these fields directly.
 */

export type StaffRole = 'SUPER_ADMIN' | 'ACCOUNT_MANAGER' | 'CREATIVE';

export interface StaffUser {
  id: string;
  displayName: string;
  email: string;
  role: StaffRole;
  agencyId: string;
}

export interface StaffMember extends StaffUser {
  isActive: boolean;
  createdAt: string;
}

export type CreativeKind = 'IMAGE' | 'VIDEO' | 'TEXT';

export type CampaignStatus = 'ACTIVE' | 'PAUSED' | 'ARCHIVED';

/** Backend CreativeStatus (schema.prisma) — DRAFT/PROCESSING/IN_REVIEW/
 * APPROVED/REJECTED/CHANGES_REQUESTED/UPLOAD_FAILED. */
export type CreativeStatus =
  | 'DRAFT'
  | 'PROCESSING'
  | 'IN_REVIEW'
  | 'APPROVED'
  | 'REJECTED'
  | 'CHANGES_REQUESTED'
  | 'UPLOAD_FAILED';

export type CommentAnchor = 'PLAIN' | 'PIN' | 'RANGE';

export type ActorType = 'STAFF' | 'CLIENT';

export type VersionState = 'PROCESSING' | 'READY' | 'FAILED';

export type ReviewStatus = 'NONE' | 'APPROVED' | 'REJECTED' | 'CHANGES_REQUESTED';

export type ReviewDecision = 'APPROVED' | 'REJECTED' | 'REQUEST_CHANGES';

// ---- clients ----

/** GET /api/clients — flat row. */
export interface Client {
  id: string;
  name: string;
  email: string | null;
  contact: string | null;
  contactName: string | null;
  phone: string | null;
  industry: string | null;
  notes: string | null;
  createdAt: string;
}

/** GET /api/clients/:id — client + campaigns + counts (PR2 detail). */
export interface ClientDetail extends Client {
  campaigns: CampaignSummary[];
  activeCampaigns: number;
  totalCreatives: number;
}

export interface CampaignSummary {
  id: string;
  name: string;
  status: CampaignStatus;
  creativesCount: number;
}

// ---- campaigns ----

/** GET /api/campaigns — flat agency-wide list item. */
export interface Campaign {
  id: string;
  clientId: string;
  clientName: string;
  name: string;
  status: CampaignStatus;
  creativesCount: number;
  createdAt: string;
}

/** GET /api/campaigns/:id — list item + creatives. */
export interface CampaignDetail extends Campaign {
  creatives: CreativeSummary[];
}

export interface CreativeSummary {
  id: string;
  title: string;
  kind: CreativeKind;
  status: CreativeStatus;
  currentVersionNo: number;
  updatedAt: string;
}

// ---- creatives ----

/** GET /api/creatives — agency-wide aggregate list row. */
export interface CreativeListItem {
  id: string;
  title: string;
  kind: CreativeKind;
  status: CreativeStatus;
  clientName: string;
  campaignName: string;
  createdAt: string;
  updatedAt: string;
}

/** GET /api/creatives/:id — backend detail shape. */
export interface Creative {
  id: string;
  clientId: string;
  campaignId: string;
  title: string;
  kind: CreativeKind;
  status: CreativeStatus;
  createdAt: string;
}

/** Composed client-side view: backend creative detail + its versions
 * fetched separately (GET /api/creatives/:id/versions). */
export interface CreativeDetail extends Creative {
  versions: CreativeVersionSummary[];
}

/** GET /api/creatives/:id/versions — version list row. */
export interface CreativeVersionSummary {
  id: string;
  versionNo: number;
  state: VersionState;
  reviewStatus: ReviewStatus;
  textBody: string | null;
  createdAt: string;
}

// ---- comments ----

/** GET/POST /api/versions/:versionId/comments — backend comment row. */
export interface Comment {
  id: string;
  anchor: CommentAnchor;
  posX: number | null;
  posY: number | null;
  startMs: number | null;
  endMs: number | null;
  body: string;
  authorType: ActorType;
  authorLabel: string;
  createdAt: string;
}

// ---- magic links ----

/** POST /api/clients/:clientId/magic-links — minted link. The absolute
 * `url` is returned exactly once; the raw token is never stored. */
export interface MagicLink {
  id: string;
  url: string;
  expiresAt: string | null;
}

/** GET /api/magic-links — flat list item (token hash never selected). */
export interface MagicLinkListItem {
  id: string;
  clientId: string;
  clientName: string;
  recipientEmail: string;
  createdAt: string;
  expiresAt: string | null;
  lastUsedAt: string | null;
  revokedAt: string | null;
}

// ---- dashboard ----

/** GET /api/dashboard/stats. */
export interface DashboardStats {
  pendingReview: number;
  approvedThisWeek: number;
  activeClients: number;
  unresolvedComments: number;
}

/** GET /api/dashboard/activity — cursor-paginated feed row.
 * `status` carries the version state string (PROCESSING/READY/FAILED). */
export interface ActivityItem {
  id: string;
  creativeName: string;
  clientName: string;
  versionNumber: number;
  status: string;
  updatedAt: string;
}

export interface DashboardActivity {
  items: ActivityItem[];
  nextCursor: string | null;
}

// ---- agency ----

/** GET/PATCH /api/agency — current agency settings (single-agency). */
export interface Agency {
  id: string;
  name: string;
  createdAt: string;
}