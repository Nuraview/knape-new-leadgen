'use client';

import { EMAIL_SIGNATURE_HTML } from '@/lib/marketing/email-signature';
import { buildCapPreviewUrl, extractCapVideoId, rescueCapEmbedFromBody } from '@/lib/videos/cap-link';
import { Autocomplete } from '@/components/marketing/ui/autocomplete';
import { Button } from '@/components/marketing/ui/button';
import { toast } from 'sonner';
import {
  AlertCircle,
  CheckCircle,
  ChevronDown,
  ChevronUp,
  Eye,
  Loader2,
  Send,
  Sparkles,
  ArrowLeft,
  Settings2,
  ShieldCheck,
  ShieldAlert,
  ShieldX,
} from 'lucide-react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import dynamic from 'next/dynamic';

// Dynamic import for CKEditor to disable SSR
const CkEditor = dynamic(
  () => import('@/components/marketing/ui/ck-editor').then((mod) => mod.CkEditor),
  { 
    ssr: false,
    loading: () => (
      <div className="min-h-[250px] rounded-lg border border-input bg-card px-4 py-3 flex items-center justify-center text-muted-foreground">
        Loading editor...
      </div>
    )
  }
);

type Contact = {
  id: number;
  firstName: string | null;
  lastName: string | null;
  email: string;
  company: string | null;
};

type Template = {
  id: number;
  name: string;
  subject: string | null;
  bodyText: string | null;
  variables: string[] | null;
};

type EmailValidationResult = {
  email: string;
  isValid: boolean;
  isValidFormat: boolean;
  hasMxRecords: boolean;
  isDisposable: boolean;
  isFreeProvider: boolean;
  domain: string;
  mxRecords: string[];
  issues: { type: string; severity: string; message: string }[];
  score: 'high' | 'medium' | 'low' | 'dangerous';
  smtpReachable?: 'safe' | 'risky' | 'invalid' | 'unknown';
  verification?: {
    reachable: 'safe' | 'risky' | 'invalid' | 'unknown';
    acceptsMail?: boolean;
    canConnectSmtp?: boolean;
    isDeliverable?: boolean;
    isDisabled?: boolean;
    hasFullInbox?: boolean;
    isCatchAll?: boolean;
    isRoleAccount?: boolean;
    isDisposable?: boolean;
    gravatarUrl?: string | null;
    breached?: boolean | null;
  };
};

function isValidEmail(email: string): boolean {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

function validateEmails(emailString: string): string[] {
  return emailString
    .split(',')
    .map(e => e.trim())
    .filter(Boolean)
    .filter(e => !isValidEmail(e));
}

function ComposeForm() {
  const searchParams = useSearchParams();

  const [contacts, setContacts] = useState<Contact[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<{ success?: boolean; error?: string } | null>(null);

  // Form state
  const [to, setTo] = useState(searchParams.get('to') || '');
  const [cc, setCc] = useState('');
  const [bcc, setBcc] = useState('');
  const [firstName, setFirstName] = useState(searchParams.get('name') || '');
  const [subject, setSubject] = useState(searchParams.get('subject') || '');
  const [body, setBody] = useState(searchParams.get('body') || '');
  const [videoLink, setVideoLink] = useState(searchParams.get('videoLink') || '');
  const [selectedTemplate, setSelectedTemplate] = useState<Template | null>(null);
  const [variables, setVariables] = useState<Record<string, string>>({});
  const [includeSignature, setIncludeSignature] = useState(true);
  const [showSignaturePreview, setShowSignaturePreview] = useState(true);
  const [enableFollowup, setEnableFollowup] = useState(true);
  const [senders, setSenders] = useState<{ id: string; label: string }[]>([]);
  const [senderId, setSenderId] = useState("auto");
  const [followup1Body, setFollowup1Body] = useState('<p>I trust you had a chance to review my previous email.</p><p>Have you had any further thoughts?</p><p>I completely understand that working with someone new can feel uncertain, if it helps, we can start with a small test project.</p><p>If you\'re considering, simply respond <strong>YES</strong> or schedule a quick call here:<br><a href="https://tidycal.com/vkumar">https://tidycal.com/vkumar</a></p><p>Thanks</p>');

  const [followup2Body, setFollowup2Body] = useState('<p>Should We Start with a Small Test? Just checking in again.</p><p>If scheduling a call feels difficult due to your current workload, feel free to reply directly here with:</p><p>1. Any questions you may have<br>2. A file or brief you\'d like us to review<br>3. Or even a small task we can execute as a test</p><p>We can evaluate it and either proceed with a test project or move forward with the actual scope, whatever feels more comfortable for you.</p><p>Happy to make this simple and low-risk.</p><p>Looking forward to your thoughts.</p>');

  const [followup3Body, setFollowup3Body] = useState('<p>I just wanted to quickly check in.</p><p>Is the hesitation around timing, trust, or has this project shifted in priority for now?</p><p>Completely understand either way, a quick reply would help me close the loop on my end.</p><p>If you\'d still like to explore, just reply <strong>YES</strong> and we\'ll move forward.</p><p>Thanks again.</p>');
  const [validationErrors, setValidationErrors] = useState<string[]>([]);
  const [showPreview, setShowPreview] = useState(false);
  const [showCcBcc, setShowCcBcc] = useState(false);

  // Deliverability check state
  const [checkingDeliverability, setCheckingDeliverability] = useState(false);
  const [deliverabilityResult, setDeliverabilityResult] = useState<EmailValidationResult | null>(null);
  const deliverabilityTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const checkDeliverability = useCallback(async (email: string) => {
    if (!email || !isValidEmail(email)) {
      setDeliverabilityResult(null);
      return;
    }
    setCheckingDeliverability(true);
    try {
      const res = await fetch('/api/marketing/validate-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      if (res.ok) {
        const data: EmailValidationResult = await res.json();
        setDeliverabilityResult(data);
      }
    } catch {
      // Silently fail — deliverability check is advisory
    } finally {
      setCheckingDeliverability(false);
    }
  }, []);

  // Auto-check deliverability when To field changes (debounced 800ms)
  useEffect(() => {
    setDeliverabilityResult(null);
    if (!to || !isValidEmail(to)) return;

    if (deliverabilityTimeoutRef.current) {
      clearTimeout(deliverabilityTimeoutRef.current);
    }
    deliverabilityTimeoutRef.current = setTimeout(() => {
      checkDeliverability(to);
    }, 800);

    return () => {
      if (deliverabilityTimeoutRef.current) {
        clearTimeout(deliverabilityTimeoutRef.current);
      }
    };
  }, [to, checkDeliverability]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        handleSend();
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [to, subject, body]);

  useEffect(() => {
    Promise.all([
      fetch('/api/marketing/contacts').then((r) => r.json()),
      fetch('/api/marketing/templates').then((r) => r.json()),
      fetch('/api/marketing/senders').then((r) => r.json()).catch(() => ({ senders: [] })),
    ]).then(([c, t, s]) => {
      setContacts(c);
      setTemplates(t);
      setSenders(s?.senders ?? []);
      setLoading(false);

      const templateId = searchParams.get('templateId');
      if (templateId) {
        const tmpl = t.find((x: Template) => x.id === parseInt(templateId));
        if (tmpl) applyTemplate(tmpl);
      }
    });
  }, []);

  const applyTemplate = (tmpl: Template) => {
    setSelectedTemplate(tmpl);
    setSubject(tmpl.subject || '');
    setBody(tmpl.bodyText || '');
    const vars: Record<string, string> = {};
    if (tmpl.variables) {
      for (const v of tmpl.variables as string[]) {
        vars[v] = variables[v] || '';
      }
    }
    if (firstName) vars['firstName'] = firstName;
    setVariables(vars);
  };

  const resolveVars = (text: string) => {
    return text.replace(/\{\{(\w+)\}\}/g, (_, key) => variables[key] || `{{${key}}}`);
  };

  // Users habitually paste Cap's iframe embed code into the editor (it can
  // never render in email). Convert it on the spot: strip the dead code from
  // the body and attach the video to the Cap-video-link field instead.
  const handleBodyChange = (next: string) => {
    const rescued = rescueCapEmbedFromBody(next);
    if (rescued) {
      setBody(rescued.cleaned);
      setVideoLink((prev) => prev || rescued.shareUrl);
      toast.success('Video embed code converted — attached as Cap video link');
      return;
    }
    setBody(next);
  };

  // Same conversion when embed code lands in the video-link field itself.
  const handleVideoLinkChange = (next: string) => {
    const id = extractCapVideoId(next);
    setVideoLink(id && next.includes('<') ? `https://cap.nuraview.com/s/${id}` : next);
  };

  const previewVideoId = videoLink.trim() ? extractCapVideoId(videoLink) : null;

  const validateForm = (): string[] => {
    const errors: string[] = [];
    if (!to.trim()) errors.push('To field is required');
    else if (!isValidEmail(to)) errors.push('To email is invalid');
    
    const invalidCc = validateEmails(cc);
    if (invalidCc.length > 0) errors.push(`Invalid CC emails: ${invalidCc.join(', ')}`);
    
    const invalidBcc = validateEmails(bcc);
    if (invalidBcc.length > 0) errors.push(`Invalid BCC emails: ${invalidBcc.join(', ')}`);
    
    if (!subject.trim()) errors.push('Subject is required');
    if (!body.replace(/<[^>]*>/g, '').trim()) errors.push('Body is required');
    
    // const emDashPattern = /—/g;
    // if (emDashPattern.test(subject)) {
    //   errors.push('Subject contains an em dash (—). Please use a regular hyphen (-) instead.');
    // }
    // if (emDashPattern.test(body)) {
    //   errors.push('Body contains an em dash (—). Please use a regular hyphen (-) instead.');
    // }
    // if (enableFollowup) {
    //   if (emDashPattern.test(followup1Body)) {
    //     errors.push('Follow-up #1 contains an em dash (—). Please use a regular hyphen (-) instead.');
    //   }
    //   if (emDashPattern.test(followup2Body)) {
    //     errors.push('Follow-up #2 contains an em dash (—). Please use a regular hyphen (-) instead.');
    //   }
    //   if (emDashPattern.test(followup3Body)) {
    //     errors.push('Follow-up #3 contains an em dash (—). Please use a regular hyphen (-) instead.');
    //   }
    // }
    
    return errors;
  };

  const handleSend = async () => {
    const errors = validateForm();
    if (errors.length > 0) {
      setValidationErrors(errors);
      setResult(null);
      errors.forEach(err => toast.error(err, {
        style: {
          background: '#fef2f2',
          border: '1px solid #fca5a5',
          color: '#dc2626',
        },
      }));
      return;
    }

    // Deliverability gate — check before sending
    if (!deliverabilityResult && isValidEmail(to)) {
      toast.error('Checking email deliverability... Please wait and try again.', {
        style: {
          background: '#fef2f2',
          border: '1px solid #fca5a5',
          color: '#dc2626',
        },
      });
      checkDeliverability(to);
      return;
    }

    if (deliverabilityResult?.score === 'dangerous') {
      const issues = deliverabilityResult.issues.map(i => i.message).join('; ');
      toast.error(`Cannot send to ${to}: ${issues}`, {
        style: {
          background: '#fef2f2',
          border: '1px solid #fca5a5',
          color: '#dc2626',
        },
      });
      return;
    }

    if (deliverabilityResult?.score === 'low') {
      const issueList = deliverabilityResult.issues.map(i => '\u2022 ' + i.message).join('\n');
      const confirmed = window.confirm('Warning: ' + to + ' has low deliverability.\n\n' + issueList + '\n\nSend anyway?');
      if (!confirmed) return;
    }
    
    setValidationErrors([]);
    setSending(true);
    setResult(null);

    const resolvedSubject = resolveVars(subject);
    const resolvedBody = resolveVars(body);

    const ccEmails = cc.split(',').map(e => e.trim()).filter(Boolean);
    const bccEmails = bcc.split(',').map(e => e.trim()).filter(Boolean);

    try {
      const res = await fetch('/api/marketing/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to,
          cc: ccEmails.length > 0 ? ccEmails : undefined,
          bcc: bccEmails.length > 0 ? bccEmails : undefined,
          subject: resolvedSubject,
          firstName: firstName || variables['firstName'] || undefined,
          bodyText: resolvedBody,
          bodyHtml: undefined,
          personalLine: variables['personalLine'] || undefined,
          portfolioLink: variables['portfolioLink'] || undefined,
          loomLink: videoLink.trim() || variables['loomLink'] || undefined,
          includeSignature,
          enableFollowup,
          followup1Body,
          followup2Body,
          followup3Body,
          fromSenderId: senderId,
        }),
      });

      const data = await res.json();
      if (res.ok && data.success) {
        setResult({ success: true });
        toast.success('Email sent successfully!', {
          style: {
            background: '#f0fdf4',
            border: '1px solid #86efac',
            color: '#166534',
          },
        });
        setTo('');
        setCc('');
        setBcc('');
        setFirstName('');
        setSubject('');
        setBody('');
        setVariables({});
        setSelectedTemplate(null);
        setDeliverabilityResult(null);
        window.scrollTo({ top: 0, behavior: 'smooth' });
      } else {
        setResult({ error: data.error || 'Failed to send email' });
        toast.error(data.error || 'Failed to send email', {
          style: {
            background: '#fef2f2',
            border: '1px solid #fca5a5',
            color: '#dc2626',
          },
        });
      }
    } catch {
      setResult({ error: 'Network error. Please try again.' });
    } finally {
      setSending(false);
    }
  };

  if (loading) {
    return <div className="flex h-full items-center justify-center text-muted-foreground"><Loader2 className="animate-spin" /></div>;
  }

  return (
    <div className="flex h-full flex-col bg-background align-middle items-center">
      {/* Header */}
      <div className="sticky top-0 z-30 flex h-[72px] w-full shrink-0 items-center justify-between border-b border-border/40 bg-background/80 px-8 backdrop-blur-md">
        <div className="flex items-center gap-4">
          <Link href="/marketing/dashboard" className="rounded-full p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
             <ArrowLeft size={20} />
          </Link>
          <h1 className="text-xl font-bold tracking-tight text-foreground">Compose Email</h1>
        </div>
        <Link href="/marketing/f/sent" className="text-sm font-medium text-muted-foreground transition-colors hover:text-primary">View Sent →</Link>
      </div>

      <div className="w-full grow overflow-auto p-8">
        <div className="mx-auto max-w-3xl space-y-6">
          
          {/* Status Messages */}
          {result?.success && (
            <div className="flex items-center gap-3 rounded-xl border border-green-200 bg-green-50 p-4 text-sm text-green-800 shadow-sm dark:border-green-900/30 dark:bg-green-900/10 dark:text-green-300">
              <CheckCircle size={20} className="shrink-0 text-green-600 dark:text-green-400" />
              <div>Email sent successfully!</div>
            </div>
          )}
          {result?.error && (
            <div className="flex items-center gap-3 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800 shadow-sm dark:border-red-900/30 dark:bg-red-900/10 dark:text-red-300">
              <AlertCircle size={20} className="shrink-0 text-red-600 dark:text-red-400" />
              <div>{result.error}</div>
            </div>
          )}
          {validationErrors.length > 0 && (
            <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800 shadow-sm dark:border-red-900/30 dark:bg-red-900/10 dark:text-red-300">
              <div className="flex items-center gap-2 font-semibold">
                <AlertCircle size={16} /> Please fix the following:
              </div>
              <ul className="mt-2 list-disc list-inside space-y-1 opacity-90">
                {validationErrors.map((err, i) => (
                  <li key={i}>{err}</li>
                ))}
              </ul>
            </div>
          )}

          {/* Main Card */}
          <div className="rounded-xl border border-border/50 bg-card p-6 shadow-sm">
            {/* Template selector */}
            {templates.length > 0 && (
              <div className="mb-6">
                <label className="mb-2 block text-xs font-semibold uppercase tracking-wider text-muted-foreground">Template</label>
                <div className="relative">
                  <select
                    value={selectedTemplate?.id || ''}
                    onChange={(e) => {
                      const tmpl = templates.find((t) => t.id === parseInt(e.target.value));
                      if (tmpl) applyTemplate(tmpl);
                      else { setSelectedTemplate(null); }
                    }}
                    className="w-full appearance-none rounded-lg border border-input bg-background px-4 py-2.5 text-sm text-foreground shadow-sm transition-colors focus:border-primary focus:ring-2 focus:ring-primary/20 focus:outline-none"
                  >
                    <option value="">— Start from scratch —</option>
                    {templates.map((t) => (
                      <option key={t.id} value={t.id}>{t.name}</option>
                    ))}
                  </select>
                  <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-4 text-muted-foreground">
                    <ChevronDown size={14} />
                  </div>
                </div>
              </div>
            )}

            <div className="space-y-5">
               {/* To field */}
              <Autocomplete
                contacts={contacts}
                value={to}
                onChange={setTo}
                label="To"
                placeholder="recipient@example.com"
              />

              {/* Deliverability Check */}
              {(checkingDeliverability || deliverabilityResult) && (
                <div className={`rounded-lg border p-3 animate-in fade-in slide-in-from-top-2 duration-200 ${
                  !deliverabilityResult ? 'border-border bg-muted/30' :
                  deliverabilityResult.score === 'high' ? 'border-green-200 bg-green-50 dark:border-green-900/30 dark:bg-green-900/10' :
                  deliverabilityResult.score === 'medium' ? 'border-yellow-200 bg-yellow-50 dark:border-yellow-900/30 dark:bg-yellow-900/10' :
                  deliverabilityResult.score === 'low' ? 'border-orange-200 bg-orange-50 dark:border-orange-900/30 dark:bg-orange-900/10' :
                  'border-red-200 bg-red-50 dark:border-red-900/30 dark:bg-red-900/10'
                }`}>
                  {checkingDeliverability ? (
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Loader2 size={16} className="animate-spin" />
                      Checking deliverability...
                    </div>
                  ) : deliverabilityResult && (
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          {deliverabilityResult.score === 'high' && <ShieldCheck size={18} className="text-green-600 dark:text-green-400" />}
                          {deliverabilityResult.score === 'medium' && <ShieldAlert size={18} className="text-yellow-600 dark:text-yellow-400" />}
                          {deliverabilityResult.score === 'low' && <ShieldAlert size={18} className="text-orange-600 dark:text-orange-400" />}
                          {deliverabilityResult.score === 'dangerous' && <ShieldX size={18} className="text-red-600 dark:text-red-400" />}
                          <span className={`text-sm font-medium ${
                            deliverabilityResult.score === 'high' ? 'text-green-800 dark:text-green-300' :
                            deliverabilityResult.score === 'medium' ? 'text-yellow-800 dark:text-yellow-300' :
                            deliverabilityResult.score === 'low' ? 'text-orange-800 dark:text-orange-300' :
                            'text-red-800 dark:text-red-300'
                          }`}>
                            {deliverabilityResult.score === 'high' && 'High Deliverability'}
                            {deliverabilityResult.score === 'medium' && 'Medium Deliverability'}
                            {deliverabilityResult.score === 'low' && 'Low Deliverability — Proceed with caution'}
                            {deliverabilityResult.score === 'dangerous' && 'Dangerous — Sending blocked'}
                          </span>
                        </div>
                        <button
                          type="button"
                          onClick={() => checkDeliverability(to)}
                          className="text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
                        >
                          Recheck
                        </button>
                      </div>

                      {deliverabilityResult.issues.length > 0 && (
                        <ul className="space-y-1 pl-6">
                          {deliverabilityResult.issues.map((issue, i) => (
                            <li key={i} className="flex items-start gap-2 text-xs">
                              <span className={`mt-0.5 inline-block h-1.5 w-1.5 shrink-0 rounded-full ${
                                issue.severity === 'error' ? 'bg-red-500' :
                                issue.severity === 'warning' ? 'bg-yellow-500' :
                                'bg-blue-500'
                              }`} />
                              <span className={
                                deliverabilityResult.score === 'high' ? 'text-green-700 dark:text-green-300' :
                                deliverabilityResult.score === 'medium' ? 'text-yellow-700 dark:text-yellow-300' :
                                deliverabilityResult.score === 'low' ? 'text-orange-700 dark:text-orange-300' :
                                'text-red-700 dark:text-red-300'
                              }>
                                {issue.message}
                              </span>
                              {issue.type === 'typo' && issue.message.includes('Did you mean') && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    const match = issue.message.match(/Did you mean (.+)\?/);
                                    if (match) {
                                      const corrected = to.replace(/@.+$/, `@${match[1]}`);
                                      setTo(corrected);
                                    }
                                  }}
                                  className="ml-1 shrink-0 rounded bg-primary/10 px-1.5 py-0.5 text-xs font-medium text-primary hover:bg-primary/20 transition-colors"
                                >
                                  Fix it
                                </button>
                              )}
                            </li>
                          ))}
                        </ul>
                      )}

                      {/* Full SMTP verification breakdown (Reacher) — every
                          sub-check, with an honest "—" where a provider (Gmail
                          /Outlook/Yahoo) blocks probing so we can't know. */}
                      {deliverabilityResult.verification && (() => {
                        const v = deliverabilityResult.verification!;
                        const hasData =
                          v.canConnectSmtp !== undefined ||
                          v.isDeliverable !== undefined ||
                          v.reachable !== 'unknown';
                        if (!hasData) {
                          return (
                            <p className="pl-6 text-xs italic text-muted-foreground">
                              SMTP mailbox probe not available for this provider
                              (Gmail/Outlook/Yahoo block it) — syntax + MX verified;
                              bounces auto-caught after send.
                            </p>
                          );
                        }
                        const yes = (b?: boolean): 'good' | 'bad' | 'unknown' =>
                          b === undefined ? 'unknown' : b ? 'good' : 'bad';
                        const no = (b?: boolean): 'good' | 'bad' | 'unknown' =>
                          b === undefined ? 'unknown' : b ? 'bad' : 'good';
                        const rows: { label: string; state: 'good' | 'bad' | 'unknown'; note?: string }[] = [
                          { label: 'Reachability', state: v.reachable === 'safe' ? 'good' : v.reachable === 'unknown' ? 'unknown' : 'bad', note: v.reachable },
                          { label: 'Syntax valid', state: yes(deliverabilityResult.isValidFormat) },
                          { label: 'Domain accepts mail (MX)', state: yes(v.acceptsMail ?? deliverabilityResult.hasMxRecords) },
                          { label: 'SMTP server reachable', state: yes(v.canConnectSmtp) },
                          { label: 'Mailbox deliverable', state: yes(v.isDeliverable) },
                          { label: 'Mailbox enabled', state: no(v.isDisabled) },
                          { label: 'Inbox has space', state: no(v.hasFullInbox) },
                          { label: 'Not a catch-all', state: no(v.isCatchAll) },
                          { label: 'Not a role account', state: no(v.isRoleAccount), note: v.isRoleAccount ? 'info@, support@…' : undefined },
                          { label: 'Not disposable', state: no(v.isDisposable) },
                          { label: 'Gravatar profile', state: v.gravatarUrl ? 'good' : 'unknown', note: v.gravatarUrl ? 'real person' : undefined },
                          { label: 'Not in known breach (HIBP)', state: v.breached == null ? 'unknown' : no(v.breached) },
                        ];
                        const passed = rows.filter((r) => r.state === 'good').length;
                        return (
                          <details className="pl-6">
                            <summary className="cursor-pointer select-none text-xs font-medium text-muted-foreground hover:text-foreground">
                              Verification details — {passed}/{rows.length} checks passed
                            </summary>
                            <div className="mt-2 grid grid-cols-1 gap-x-4 gap-y-1 sm:grid-cols-2">
                              {rows.map((r, i) => (
                                <div key={i} className="flex items-center justify-between gap-2 text-xs">
                                  <span className="text-muted-foreground">
                                    {r.label}
                                    {r.note ? <span className="opacity-60"> ({r.note})</span> : ''}
                                  </span>
                                  <span className={
                                    r.state === 'good' ? 'font-semibold text-green-600 dark:text-green-400' :
                                    r.state === 'bad' ? 'font-semibold text-red-600 dark:text-red-400' :
                                    'text-muted-foreground/50'
                                  }>
                                    {r.state === 'good' ? '✓' : r.state === 'bad' ? '✗' : '—'}
                                  </span>
                                </div>
                              ))}
                            </div>
                          </details>
                        );
                      })()}
                    </div>
                  )}
                </div>
              )}
              
              <div className="flex justify-end">
                  <button 
                    type="button" 
                    onClick={() => setShowCcBcc(!showCcBcc)}
                    className="text-xs font-medium text-primary hover:underline"
                  >
                    {showCcBcc ? 'Hide CC/BCC' : 'Show CC/BCC'}
                  </button>
              </div>

               {/* CC / BCC fields */}
              {showCcBcc && (
                <div className="grid gap-5 animate-in fade-in slide-in-from-top-2 duration-200">
                    <Autocomplete
                        contacts={contacts}
                        value={cc}
                        onChange={setCc}
                        label="CC"
                        placeholder="cc@example.com"
                        allowMultiple
                    />
                    <Autocomplete
                        contacts={contacts}
                        value={bcc}
                        onChange={setBcc}
                        label="BCC"
                        placeholder="bcc@example.com"
                        allowMultiple
                    />
                </div>
              )}

              {/* Subject */}
              <div>
                <label className="mb-2 block text-xs font-semibold uppercase tracking-wider text-muted-foreground">Subject</label>
                <input
                  type="text"
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  placeholder="Subject line..."
                  className="w-full rounded-lg border border-input bg-background px-4 py-2.5 text-sm text-foreground shadow-sm transition-colors placeholder:text-muted-foreground focus:border-primary focus:ring-2 focus:ring-primary/20 focus:outline-none"
                />
              </div>

              {/* Cap video link — embedded server-side as a clickable GIF card */}
              <div>
                <label className="mb-2 block text-xs font-semibold uppercase tracking-wider text-muted-foreground">Cap video link</label>
                <input
                  type="text"
                  value={videoLink}
                  onChange={(e) => handleVideoLinkChange(e.target.value)}
                  placeholder="https://cap.nuraview.com/s/…"
                  className="w-full rounded-lg border border-input bg-background px-4 py-2.5 text-sm text-foreground shadow-sm transition-colors placeholder:text-muted-foreground focus:border-primary focus:ring-2 focus:ring-primary/20 focus:outline-none"
                />
                <p className="mt-1.5 text-xs text-muted-foreground">
                  Paste the share link (or embed code — we convert it). Embedded at
                  the end of the email as a clickable animated preview; iframes never
                  render in email clients.
                </p>
              </div>

              {/* Variable inputs */}
              {selectedTemplate?.variables && (selectedTemplate.variables as string[]).length > 0 && (
                <div className="rounded-lg border border-blue-100 bg-blue-50/50 p-4 dark:border-blue-900/30 dark:bg-blue-900/10">
                  <div className="mb-3 flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-blue-600 dark:text-blue-400">
                    <Sparkles size={14} /> Personalize Variables
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    {(selectedTemplate.variables as string[]).map((v) => (
                      <div key={v}>
                        <label className="mb-1.5 block text-xs font-medium text-muted-foreground">{`{{${v}}}`}</label>
                        <input
                          value={variables[v] || ''}
                          onChange={(e) => setVariables((prev) => ({ ...prev, [v]: e.target.value }))}
                          placeholder={v}
                          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus:border-primary focus:ring-2 focus:ring-primary/20 focus:outline-none"
                        />
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Body */}
              <div>
                <div className="mb-2 flex items-center justify-between">
                  <label className="block text-xs font-semibold uppercase tracking-wider text-muted-foreground">Message</label>
                  <button
                    type="button"
                    onClick={() => setShowPreview(!showPreview)}
                    className={`flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium transition-colors ${
                        showPreview 
                        ? 'bg-primary/10 text-primary' 
                        : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                    }`}
                  >
                    <Eye size={14} /> {showPreview ? 'Edit' : 'Preview'}
                  </button>
                </div>
                
                {showPreview ? (
                  <div className="min-h-[300px] rounded-lg border border-input bg-white p-6 shadow-sm dark:bg-black/20">
                    <div className="prose prose-sm prose-slate max-w-none dark:prose-invert">
                      <div dangerouslySetInnerHTML={{ __html: resolveVars(body) }} />
                      {previewVideoId ? (
                        <div className="my-4 w-[480px] max-w-full">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={buildCapPreviewUrl(previewVideoId)}
                            alt="Video preview"
                            className="block w-full rounded-lg border border-border"
                          />
                          <p className="mt-2 text-sm font-semibold text-blue-600">
                            ▶ watch video (clickable in the sent email)
                          </p>
                        </div>
                      ) : videoLink.trim() ? (
                        <div className="my-4 flex w-[480px] max-w-full items-center justify-center rounded-lg border border-dashed border-border bg-muted/40 py-10 text-sm text-muted-foreground">
                          ▶ Video link isn&apos;t a Cap link — it will be sent as a plain link
                        </div>
                      ) : null}
                      {includeSignature && <div className="mt-8 border-t border-border pt-6" dangerouslySetInnerHTML={{ __html: EMAIL_SIGNATURE_HTML }} />}
                    </div>
                  </div>
                  ) : (
                    <CkEditor
                      content={body}
                      onChange={handleBodyChange}
                      placeholder="Write your email..."
                    />
                  )}
                
                {/* Signature Preview */}
                {includeSignature && !showPreview && (
                  <div className="mt-[-1px] rounded-b-lg border border-input border-t-0 bg-muted/30 px-4 py-3">
                     <button
                        type="button"
                        onClick={() => setShowSignaturePreview(!showSignaturePreview)}
                        className="flex cursor-pointer items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground"
                     >
                        {showSignaturePreview ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                        Signature Preview
                     </button>
                    {showSignaturePreview && (
                      <div className="mt-3 pt-3 border-t border-border/50">
                          <div
                            className="pointer-events-none origin-top-left scale-90 opacity-80"
                            dangerouslySetInnerHTML={{ __html: EMAIL_SIGNATURE_HTML }}
                          />
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Settings Card */}
          <div className="rounded-xl border border-border/50 bg-card p-5 shadow-sm">
             <div className="flex items-center gap-2 mb-4 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                <Settings2 size={14} /> Configuration
             </div>
             
             <div className="space-y-4">
                {/* Send from / provider picker */}
                <div className="rounded-lg border border-border p-3">
                    <label className="mb-2 block text-sm font-medium text-foreground">Send from</label>
                    <div className="relative">
                      <select
                        value={senderId}
                        onChange={(e) => setSenderId(e.target.value)}
                        className="w-full appearance-none rounded-lg border border-input bg-background px-4 py-2.5 text-sm text-foreground shadow-sm focus:border-primary focus:ring-2 focus:ring-primary/20 focus:outline-none"
                      >
                        <option value="auto">Default — creative-hive.co</option>
                        {senders.map((s) => (
                          <option key={s.id} value={s.id}>{s.label}</option>
                        ))}
                      </select>
                      <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-4 text-muted-foreground">
                        <ChevronDown size={14} />
                      </div>
                    </div>
                    <p className="mt-1.5 text-xs text-muted-foreground">
                      All email is sent from creative-hive.co via our SMTP server.
                    </p>
                </div>

                <label className="flex cursor-pointer items-center justify-between rounded-lg border border-border p-3 transition-colors hover:bg-muted/50 hover:border-border/80">
                    <span className="flex items-center gap-2 text-sm font-medium text-foreground">
                        Include email signature
                    </span>
                    <input
                    type="checkbox"
                    checked={includeSignature}
                    onChange={(e) => setIncludeSignature(e.target.checked)}
                    className="h-4 w-4 cursor-pointer rounded border-border text-primary focus:ring-primary/20"
                    />
                </label>

                <div className="space-y-3">
                    <label className="flex cursor-pointer items-start gap-4 rounded-lg border border-border p-3 transition-colors hover:bg-muted/50 hover:border-border/80">
                        <div className="grow">
                            <div className="flex items-center justify-between">
                                <span className="text-sm font-medium text-foreground">Enable 3-step follow-up</span>
                                <input
                                    type="checkbox"
                                    checked={enableFollowup}
                                    onChange={(e) => {
                                      if (!e.target.checked) {
                                        if (window.confirm('Are you sure you want to disable follow-up emails?')) {
                                          setEnableFollowup(false);
                                        }
                                      } else {
                                        setEnableFollowup(true);
                                      }
                                    }}
                                    className="h-4 w-4 cursor-pointer rounded border-border text-primary focus:ring-primary/20"
                                />
                            </div>
                            <p className="mt-1 text-xs text-muted-foreground">
                                Automatically sends follow-ups at 6h, 24h, and 36h if no reply.
                            </p>
                        </div>
                    </label>

                    {enableFollowup && (
                        <div className="space-y-3 rounded-lg border border-border p-4 bg-muted/20">
                            <p className="text-xs font-medium text-muted-foreground">Follow-up Messages</p>
                            <div className="space-y-4">
                                <div>
                                    <label className="text-xs text-muted-foreground">6 hours (Follow-up #1)</label>
                                    <div className="mt-1">
                                        <CkEditor
                                            content={followup1Body}
                                            onChange={setFollowup1Body}
                                            placeholder="Enter follow-up #1 message..."
                                        />
                                    </div>
                                </div>
                                <div>
                                    <label className="text-xs text-muted-foreground">24 hours (Follow-up #2)</label>
                                    <div className="mt-1">
                                        <CkEditor
                                            content={followup2Body}
                                            onChange={setFollowup2Body}
                                            placeholder="Enter follow-up #2 message..."
                                        />
                                    </div>
                                </div>
                                <div>
                                    <label className="text-xs text-muted-foreground">36 hours (Follow-up #3)</label>
                                    <div className="mt-1">
                                        <CkEditor
                                            content={followup3Body}
                                            onChange={setFollowup3Body}
                                            placeholder="Enter follow-up #3 message..."
                                        />
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}
                </div>
             </div>
          </div>
          
            {/* Action Bar */}
           <div className="flex justify-end gap-3 pt-2">
             <p className="hidden self-center text-xs text-muted-foreground sm:block">
                <kbd className="rounded bg-muted px-1.5 py-0.5 font-mono text-foreground">Cmd</kbd> + <kbd className="rounded bg-muted px-1.5 py-0.5 font-mono text-foreground">Enter</kbd> to send
             </p>
            <Button
              onClick={handleSend}
              disabled={sending || !to || !subject}
              size="lg"
              className="min-w-[140px] shadow-blue-500/20"
            >
              {sending ? <Loader2 size={18} className="animate-spin" /> : <Send size={18} />}
              {sending ? 'Sending...' : 'Send Email'}
            </Button>
          </div>
          
        </div>
      </div>
    </div>
  );
}

export default function ComposePage() {
  return (
    <Suspense fallback={<div className="flex h-full items-center justify-center text-muted-foreground"><Loader2 className="animate-spin" /></div>}>
      <ComposeForm />
    </Suspense>
  );
}
