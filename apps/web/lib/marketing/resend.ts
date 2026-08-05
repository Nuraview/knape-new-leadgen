import { Resend } from 'resend';

let _resend: Resend | undefined;

export function getResend() {
  if (!_resend) {
    if (!process.env.RESEND_API_KEY) {
      console.warn('RESEND_API_KEY is not set. Email sending will not work.');
    }
    _resend = new Resend(process.env.RESEND_API_KEY);
  }
  return _resend;
}

// Keep backward-compatible lazy export
export const resend = new Proxy({} as Resend, {
  get(_, prop) {
    return (getResend() as any)[prop];
  },
});

export const FROM_EMAIL =
  process.env.RESEND_FROM_EMAIL || 'hello@hello.nuraview.com';
export const REPLY_TO =
  process.env.RESEND_REPLY_TO || 'hello@hello.nuraview.com';
export const WEBHOOK_SECRET = process.env.RESEND_WEBHOOK_SECRET || '';
