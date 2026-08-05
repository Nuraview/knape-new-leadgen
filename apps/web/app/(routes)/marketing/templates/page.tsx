'use client';

import {
  createTemplateAction,
  deleteTemplateAction,
  updateTemplateAction,
} from '@/lib/marketing/template-actions';
import {
  Eye,
  FileText,
  Pencil,
  Plus,
  Send,
  Trash2,
  X,
  Loader2,
  Sparkles,
  Search,
} from 'lucide-react';
import Link from 'next/link';
import { useActionState, useEffect, useState } from 'react';
import { Button } from '@/components/marketing/ui/button';

type Template = {
  id: number;
  name: string;
  subject: string | null;
  bodyHtml: string | null;
  bodyText: string | null;
  variables: string[] | null;
  createdAt: Date | null;
  updatedAt: Date | null;
};

function TemplatePreviewModal({ template, onClose }: { template: Template; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-200">
      <div className="w-full max-w-2xl rounded-xl border border-border bg-card shadow-lg animate-in zoom-in-95 duration-200 flex flex-col max-h-[85vh]">
        <div className="flex items-center justify-between border-b border-border/40 px-6 py-4">
          <div>
              <h2 className="text-lg font-semibold text-foreground">Template Preview</h2>
              <p className="text-xs text-muted-foreground">{template.name}</p>
          </div>
          <button onClick={onClose} className="rounded-full p-1 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors">
            <X size={20} />
          </button>
        </div>
        <div className="overflow-auto p-6 space-y-6">
          <div className="space-y-1">
            <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Subject</p>
            <p className="font-medium text-foreground">{template.subject || '(No subject)'}</p>
          </div>
          <div className="space-y-2">
            <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Body Content</p>
            <div className="rounded-lg border border-border/50 bg-muted/20 p-4">
               <div className="whitespace-pre-wrap text-sm text-foreground leading-relaxed">{template.bodyText}</div>
            </div>
          </div>
          {template.variables && (template.variables as string[]).length > 0 && (
            <div className="space-y-2">
               <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Detected Variables</p>
              <div className="flex flex-wrap gap-2">
                {(template.variables as string[]).map((v) => (
                  <span key={v} className="inline-flex items-center gap-1 rounded-full bg-blue-100 px-2.5 py-0.5 text-xs font-medium text-blue-700 dark:bg-blue-900/30 dark:text-blue-300">
                     <Sparkles size={10} /> {`{{${v}}}`}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
        <div className="border-t border-border/40 p-4 flex justify-end gap-2">
             <Button variant="outline" onClick={onClose}>Close</Button>
             <Link href={`/marketing/compose?templateId=${template.id}`}>
                <Button className="shadow-blue-500/20"><Send size={14} className="mr-2" /> Use this Template</Button>
             </Link>
        </div>
      </div>
    </div>
  );
}

function TemplateForm({
  template,
  onClose,
}: {
  template?: Template;
  onClose: () => void;
}) {
  const action = template ? updateTemplateAction : createTemplateAction;
  const [state, formAction] = useActionState(action, { error: null } as { error: string | null; success?: boolean });
  const [bodyText, setBodyText] = useState(template?.bodyText || '');

  // Detect variables live
  const variableRegex = /\{\{(\w+)\}\}/g;
  const detectedVars = Array.from(new Set(Array.from(bodyText.matchAll(variableRegex), (m) => m[1])));

  useEffect(() => {
    if (state?.success) onClose();
  }, [state, onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-200">
      <div className="w-full max-w-2xl rounded-xl border border-border bg-card p-6 shadow-lg animate-in zoom-in-95 duration-200 flex flex-col max-h-[90vh]">
        <div className="mb-6 flex items-center justify-between shrink-0">
          <h2 className="text-lg font-semibold text-foreground">{template ? 'Edit Template' : 'New Template'}</h2>
          <button onClick={onClose} className="rounded-full p-1 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors">
            <X size={20} />
          </button>
        </div>
        <form action={formAction} className="flex flex-col gap-4 overflow-hidden grow">
          {template && <input type="hidden" name="id" value={template.id} />}
          
          <div className="space-y-1">
             <label className="text-xs font-medium text-muted-foreground">Template Name</label>
             <input name="name" defaultValue={template?.name} placeholder="e.g. Outreach - First Touch" required className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus:border-primary focus:ring-2 focus:ring-primary/20 focus:outline-none" />
          </div>
          
          <div className="space-y-1">
             <label className="text-xs font-medium text-muted-foreground">Subject Line</label>
             <input name="subject" defaultValue={template?.subject || ''} placeholder="Use {{firstName}} for dynamic variables" required className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus:border-primary focus:ring-2 focus:ring-primary/20 focus:outline-none" />
          </div>

          <div className="space-y-1 grow flex flex-col min-h-0">
            <label className="text-xs font-medium text-muted-foreground">Body Content</label>
            <textarea
              name="bodyText"
              value={bodyText}
              onChange={(e) => setBodyText(e.target.value)}
              placeholder={"Hi {{firstName}},\n\nHere's a quick message content.\n\nBest,\nYour Name"}
              required
              className="w-full grow resize-none rounded-lg border border-input bg-background px-3 py-2 font-mono text-sm shadow-sm placeholder:text-muted-foreground focus:border-primary focus:ring-2 focus:ring-primary/20 focus:outline-none"
            />
          </div>
          
          {detectedVars.length > 0 && (
             <div className="shrink-0 flex items-center gap-2 overflow-x-auto pb-1">
                <span className="text-xs font-medium text-muted-foreground shrink-0">Detected Variables:</span>
                {detectedVars.map((v) => (
                  <span key={v} className="shrink-0 rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-medium text-blue-700 dark:bg-blue-900/30 dark:text-blue-300">{`{{${v}}}`}</span>
                ))}
            </div>
          )}

          <input type="hidden" name="bodyHtml" value="" />
          {state?.error && (
             <div className="rounded-lg bg-red-50 p-3 text-sm text-red-600 dark:bg-red-900/20 dark:text-red-400">
               {state.error}
             </div>
          )}
          
          <div className="flex gap-2 shrink-0 pt-2">
            <Button variant="outline" onClick={onClose} type="button">Cancel</Button>
            <Button type="submit" className="grow shadow-blue-500/20">{template ? 'Update Template' : 'Create Template'}</Button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function TemplatesPage() {
  const [templatesList, setTemplatesList] = useState<Template[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<Template | undefined>();
  const [previewTemplate, setPreviewTemplate] = useState<Template | undefined>();
  const [search, setSearch] = useState('');

  const loadTemplates = async () => {
    const res = await fetch('/api/marketing/templates');
    const data = await res.json();
    setTemplatesList(data);
    setLoading(false);
  };

  // eslint-disable-next-line react-hooks/set-state-in-effect -- mount-time data load
  useEffect(() => { loadTemplates(); }, []);

  const handleEdit = (t: Template) => { setEditingTemplate(t); setShowForm(true); };
  const handleClose = () => { setShowForm(false); setEditingTemplate(undefined); loadTemplates(); };
  const handleDelete = async (id: number) => {
    if (!confirm('Delete this template?')) return;
    await deleteTemplateAction(id);
    loadTemplates();
  };

  const filtered = templatesList.filter((t) => 
     t.name.toLowerCase().includes(search.toLowerCase()) || 
     t.subject?.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="flex h-full flex-col bg-background">
      {/* Header */}
      <div className="sticky top-0 z-30 flex h-[72px] shrink-0 items-center justify-between border-b border-border/40 bg-background/80 px-8 backdrop-blur-md">
        <div className="flex items-center gap-3">
          <div className="rounded-lg bg-indigo-500/10 p-2 text-indigo-500">
             <FileText size={20} />
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tight text-foreground">Templates</h1>
            <p className="text-xs text-muted-foreground">{templatesList.length} saved templates</p>
          </div>
        </div>
        <Button onClick={() => { setEditingTemplate(undefined); setShowForm(true); }} className="shadow-blue-500/20">
          <Plus size={14} className="mr-2" /> New Template
        </Button>
      </div>

       {/* Toolbar */}
       <div className="border-b border-border/40 px-8 py-4">
        <div className="relative max-w-md">
           <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
           <input 
              value={search} 
              onChange={(e) => setSearch(e.target.value)} 
              placeholder="Search templates..." 
              className="w-full rounded-lg border border-input bg-card py-2 pl-10 pr-4 text-sm shadow-sm transition-colors placeholder:text-muted-foreground focus:border-primary focus:ring-2 focus:ring-primary/20 focus:outline-none" 
            />
        </div>
      </div>

      <div className="grow overflow-auto p-8">
        {loading ? (
          <div className="flex h-full items-center justify-center text-muted-foreground">
             <Loader2 className="animate-spin mr-2" /> Loading templates...
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex h-[400px] flex-col items-center justify-center rounded-xl border border-dashed border-border/60 bg-muted/20 text-center">
            <div className="mb-4 rounded-full bg-muted p-4">
                <FileText size={32} className="text-muted-foreground" />
            </div>
            <h3 className="text-lg font-semibold text-foreground">
               {templatesList.length === 0 ? 'No templates yet' : 'No matches found'}
            </h3>
            <p className="mt-1 text-sm text-muted-foreground max-w-xs mx-auto">
              {templatesList.length === 0 ? 'Create your first email template to speed up your workflow.' : 'Try adjusting your search terms.'}
            </p>
            {templatesList.length === 0 && (
                <Button className="mt-6" onClick={() => setShowForm(true)}>
                    Create Template
                </Button>
            )}
          </div>
        ) : (
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {filtered.map((t) => (
              <div key={t.id} className="group flex flex-col rounded-xl border border-border/50 bg-card p-5 shadow-sm transition-all hover:border-primary/50 hover:shadow-md">
                <div className="mb-3 flex items-start justify-between">
                  <h3 className="font-semibold text-foreground line-clamp-1" title={t.name}>{t.name}</h3>
                  <div className="flex gap-1 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity">
                    <button onClick={() => setPreviewTemplate(t)} className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors" title="Preview"><Eye size={14} /></button>
                    <button onClick={() => handleEdit(t)} className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors" title="Edit"><Pencil size={14} /></button>
                    <button onClick={() => handleDelete(t.id)} className="rounded p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors" title="Delete"><Trash2 size={14} /></button>
                  </div>
                </div>
                
                <div className="mb-4 grow space-y-2">
                    <div className="space-y-1">
                        <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Subject</p>
                        <p className="text-sm text-foreground line-clamp-1">{t.subject || <span className="italic text-muted-foreground">No subject</span>}</p>
                    </div>
                    <div className="space-y-1">
                        <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Body Preview</p>
                        <p className="text-xs text-muted-foreground line-clamp-3">{t.bodyText}</p>
                    </div>
                </div>

                <div className="mt-auto pt-3 border-t border-border/40">
                    <div className="mb-3 h-6">
                        {t.variables && (t.variables as string[]).length > 0 ? (
                        <div className="flex flex-wrap gap-1 overflow-hidden h-6">
                            {(t.variables as string[]).slice(0, 3).map((v) => (
                            <span key={v} className="inline-flex items-center rounded-full bg-blue-50 px-1.5 py-0.5 text-[10px] font-medium text-blue-600 dark:bg-blue-900/20 dark:text-blue-400">{`{{${v}}}`}</span>
                            ))}
                            {(t.variables as string[]).length > 3 && <span className="text-[10px] text-muted-foreground">+{((t.variables as string[]).length - 3)} more</span>}
                        </div>
                        ) : (
                            <span className="text-[10px] text-muted-foreground italic">No variables</span>
                        )}
                    </div>
                    <Link href={`/marketing/compose?templateId=${t.id}`}>
                        <Button variant="secondary" className="w-full text-xs h-8">
                            <Send size={12} className="mr-2" /> Use Template
                        </Button>
                    </Link>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
      {showForm && <TemplateForm template={editingTemplate} onClose={handleClose} />}
      {previewTemplate && <TemplatePreviewModal template={previewTemplate} onClose={() => setPreviewTemplate(undefined)} />}
    </div>
  );
}
