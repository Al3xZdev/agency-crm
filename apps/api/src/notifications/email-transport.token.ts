/**
 * Injection token for the email transport port.
 * Defined here (not in the module) to avoid circular imports between
 * notifications.service.ts and notifications.module.ts.
 */
export const EMAIL_TRANSPORT = 'EMAIL_TRANSPORT';
