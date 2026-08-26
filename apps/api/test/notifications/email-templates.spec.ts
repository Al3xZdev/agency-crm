import { describe, expect, it } from 'vitest';
import {
  renderVersionNew,
  renderCommentNew,
  renderDecisionCast,
  renderApprovalReminder,
  renderWeeklyDigest,
  renderTemplate,
} from '../../src/notifications/email-templates';

describe('email-templates (slice 11a)', () => {
  describe('renderVersionNew', () => {
    it('includes creative title and version number', () => {
      const html = renderVersionNew({ creativeTitle: 'Banner Ad', versionNo: 3 });
      expect(html).toContain('Banner Ad');
      expect(html).toContain('v3');
      expect(html).toContain('ready for your review');
    });

    it('includes review URL as CTA when provided', () => {
      const html = renderVersionNew({
        creativeTitle: 'Video',
        versionNo: 1,
        reviewUrl: 'https://app.test/review/123',
      });
      expect(html).toContain('https://app.test/review/123');
      expect(html).toContain('Review now');
    });

    it('escapes HTML in creative title', () => {
      const html = renderVersionNew({ creativeTitle: '<script>alert(1)</script>', versionNo: 1 });
      expect(html).toContain('&lt;script&gt;');
      expect(html).not.toContain('<script>');
    });
  });

  describe('renderCommentNew', () => {
    it('includes author, comment body, and creative title', () => {
      const html = renderCommentNew({
        creativeTitle: 'Poster',
        versionNo: 2,
        authorLabel: 'John Doe',
        commentBody: 'Looks great!',
      });
      expect(html).toContain('John Doe');
      expect(html).toContain('Looks great!');
      expect(html).toContain('Poster');
      expect(html).toContain('v2');
    });

    it('escapes HTML in comment body', () => {
      const html = renderCommentNew({
        creativeTitle: 'Test',
        versionNo: 1,
        authorLabel: 'User',
        commentBody: '<img src=x onerror=alert(1)>',
      });
      expect(html).toContain('&lt;img');
      expect(html).not.toContain('<img');
    });
  });

  describe('renderDecisionCast', () => {
    it('renders APPROVED with green color', () => {
      const html = renderDecisionCast({
        creativeTitle: 'Banner',
        versionNo: 1,
        decision: 'APPROVED',
        actorLabel: 'Client Corp',
      });
      expect(html).toContain('approved');
      expect(html).toContain('#16a34a');
      expect(html).toContain('Client Corp');
    });

    it('renders REJECTED with red color', () => {
      const html = renderDecisionCast({
        creativeTitle: 'Banner',
        versionNo: 1,
        decision: 'REJECTED',
        actorLabel: 'Client Corp',
      });
      expect(html).toContain('rejected');
      expect(html).toContain('#dc2626');
    });

    it('renders REQUEST_CHANGES with amber color', () => {
      const html = renderDecisionCast({
        creativeTitle: 'Banner',
        versionNo: 1,
        decision: 'REQUEST_CHANGES',
        actorLabel: 'Client Corp',
      });
      expect(html).toContain('requested changes on');
      expect(html).toContain('#d97706');
    });
  });

  describe('renderApprovalReminder', () => {
    it('includes days pending and creative title', () => {
      const html = renderApprovalReminder({
        creativeTitle: 'Social Post',
        versionNo: 5,
        daysPending: 7,
      });
      expect(html).toContain('Social Post');
      expect(html).toContain('v5');
      expect(html).toContain('7 days');
      expect(html).toContain('pending approval');
    });
  });

  describe('renderWeeklyDigest', () => {
    it('renders pending versions table', () => {
      const html = renderWeeklyDigest({
        agencyName: 'Test Agency',
        pendingVersions: [
          { creativeTitle: 'Banner', versionNo: 1, daysPending: 3 },
          { creativeTitle: 'Video', versionNo: 2, daysPending: 5 },
        ],
      });
      expect(html).toContain('Test Agency');
      expect(html).toContain('2 version(s) pending');
      expect(html).toContain('Banner');
      expect(html).toContain('Video');
      expect(html).toContain('v1');
      expect(html).toContain('v2');
      expect(html).toContain('3d');
      expect(html).toContain('5d');
    });

    it('handles empty pending list', () => {
      const html = renderWeeklyDigest({
        agencyName: 'Agency',
        pendingVersions: [],
      });
      expect(html).toContain('0 version(s) pending');
    });
  });

  describe('renderTemplate', () => {
    it('routes to correct renderer by template name', () => {
      const html = renderTemplate('VERSION_NEW', {
        creativeTitle: 'Test',
        versionNo: 1,
      });
      expect(html).toContain('Test');
      expect(html).toContain('v1');
    });

    it('returns fallback for unknown template', () => {
      const html = renderTemplate('UNKNOWN', { bodyText: 'Hello' });
      expect(html).toContain('Hello');
    });
  });
});
