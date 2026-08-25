-- Slice-3.5 hardening (audit finding 10): revokeSessions() filters by userId;
-- without this index every deactivation/logout-cascade full-scans Session.
CREATE INDEX "Session_userId_idx" ON "Session"("userId");
