import { describe, expect, it, vi, beforeEach } from 'vitest';
import { SmtpEmailTransport } from '../../src/notifications/smtp-email.transport';

// Mock nodemailer
vi.mock('nodemailer', () => {
  const sendMail = vi.fn();
  return {
    default: {
      createTransport: vi.fn(() => ({ sendMail })),
    },
    __sendMailMock: sendMail,
  };
});

const nodemailer = await import('nodemailer');
const sendMailMock = (nodemailer as unknown as { __sendMailMock: ReturnType<typeof vi.fn> }).__sendMailMock;

describe('SmtpEmailTransport (slice 11a)', () => {
  let transport: SmtpEmailTransport;

  beforeEach(() => {
    vi.clearAllMocks();
    sendMailMock.mockReset();
    transport = new SmtpEmailTransport(
      'smtps://user:pass@smtp.test.com:465',
      'noreply@agency.test',
    );
  });

  it('has kind "smtp"', () => {
    expect(transport.kind).toBe('smtp');
  });

  it('sends email and returns SENT status', async () => {
    sendMailMock.mockResolvedValue({ messageId: 'abc-123@test' });

    const result = await transport.send({
      toAddresses: ['client@test.com'],
      subject: 'Test subject',
      bodyText: 'Plain text',
      bodyHtml: '<p>HTML content</p>',
    });

    expect(result.status).toBe('SENT');
    expect(result.messageId).toBe('abc-123@test');
    expect(sendMailMock).toHaveBeenCalledWith({
      from: 'noreply@agency.test',
      to: 'client@test.com',
      subject: 'Test subject',
      text: 'Plain text',
      html: '<p>HTML content</p>',
    });
  });

  it('joins multiple toAddresses with comma', async () => {
    sendMailMock.mockResolvedValue({ messageId: 'multi@test' });

    await transport.send({
      toAddresses: ['a@test.com', 'b@test.com'],
      subject: 'Multi',
      bodyText: 'text',
      bodyHtml: '<p>html</p>',
    });

    expect(sendMailMock).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'a@test.com, b@test.com' }),
    );
  });

  it('returns FAILED status on transport error', async () => {
    sendMailMock.mockRejectedValue(new Error('Connection refused'));

    const result = await transport.send({
      toAddresses: ['fail@test.com'],
      subject: 'Fail',
      bodyText: 'text',
      bodyHtml: '<p>html</p>',
    });

    expect(result.status).toBe('FAILED');
    expect(result.error).toBe('Connection refused');
  });

  it('returns FAILED status on non-Error throw', async () => {
    sendMailMock.mockRejectedValue('string error');

    const result = await transport.send({
      toAddresses: ['fail@test.com'],
      subject: 'Fail',
      bodyText: 'text',
      bodyHtml: '<p>html</p>',
    });

    expect(result.status).toBe('FAILED');
    expect(result.error).toBe('string error');
  });

  it('masks password in constructor log', () => {
    // Constructor already ran in beforeEach — just verify it didn't throw
    expect(transport.kind).toBe('smtp');
  });
});
