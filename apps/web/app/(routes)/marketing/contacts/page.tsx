'use client';

import {
  addContactAction,
  deleteContactAction,
  importContactsAction,
} from '@/lib/marketing/contacts-actions';
import {
  ArrowUpRight,
  Check,
  FileText,
  MinusSquare,
  Plus,
  Search,
  Trash2,
  Upload,
  Users,
  X,
} from 'lucide-react';
import Link from 'next/link';
import { useActionState, useEffect, useRef, useState } from 'react';

type Contact = {
  id: number;
  firstName: string | null;
  lastName: string | null;
  email: string;
  company: string | null;
  phone: string | null;
  tags: unknown;
  lastEngagement: Date | null;
  createdAt: Date | null;
  linkedinUrl: string | null;
  jobTitle: string | null;
  upworkJobUrl: string | null;
};

function AddContactForm({ onClose }: { onClose: () => void }) {
  const [state, formAction] = useActionState(addContactAction, { error: null });

  useEffect(() => {
    if (state?.success) onClose();
  }, [state, onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-full max-w-md rounded-xl border border-gray-200 bg-white p-6 shadow-xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">Add Contact</h2>
          <button onClick={onClose} className="cursor-pointer text-gray-400 hover:text-gray-600">
            <X size={20} />
          </button>
        </div>
        <form action={formAction} className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <input name="firstName" placeholder="First name" className="rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none" />
            <input name="lastName" placeholder="Last name" className="rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none" />
          </div>
          <input name="email" type="email" placeholder="Email *" required className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none" />
          <input name="company" placeholder="Company" className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none" />
          {state?.error && <p className="text-sm text-red-600">{state.error}</p>}
          <button type="submit" className="w-full cursor-pointer rounded-lg bg-blue-600 py-2 text-sm font-semibold text-white hover:bg-blue-700">Add Contact</button>
        </form>
      </div>
    </div>
  );
}

function ImportCSVModal({ onClose }: { onClose: () => void }) {
  const [state, formAction] = useActionState(importContactsAction, { error: null });
  const fileRef = useRef<HTMLInputElement>(null);
  const [csvText, setCsvText] = useState('');

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => setCsvText(ev.target?.result as string);
    reader.readAsText(file);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-full max-w-lg rounded-xl border border-gray-200 bg-white p-6 shadow-xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">Import Contacts from CSV</h2>
          <button onClick={onClose} className="cursor-pointer text-gray-400 hover:text-gray-600"><X size={20} /></button>
        </div>
        <form action={formAction} className="space-y-4">
          <div>
            <input ref={fileRef} type="file" accept=".csv" onChange={handleFileChange} className="text-sm" />
            <p className="mt-1 text-xs text-gray-500">CSV must have an &quot;email&quot; column. Optional: first_name, last_name, company.</p>
          </div>
          <textarea name="csv" value={csvText} onChange={(e) => setCsvText(e.target.value)} rows={6} placeholder="Or paste CSV here..." className="w-full rounded-lg border border-gray-300 px-3 py-2 font-mono text-xs focus:border-blue-500 focus:outline-none" />
          {state?.error && <p className="text-sm text-red-600">{state.error}</p>}
          {state?.success && <p className="text-sm text-green-600">Imported {state.imported} contacts ({state.skipped} skipped).</p>}
          <button type="submit" disabled={!csvText} className="w-full cursor-pointer rounded-lg bg-blue-600 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50">Import</button>
        </form>
      </div>
    </div>
  );
}

export default function ContactsPage() {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [showAdd, setShowAdd] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());

  const loadContacts = async () => {
    const res = await fetch('/api/marketing/contacts');
    const data = await res.json();
    setContacts(data);
    setLoading(false);
  };

  // eslint-disable-next-line react-hooks/set-state-in-effect -- mount-time data load
  useEffect(() => { loadContacts(); }, []);

  // Re-fetch when modals close
  const handleCloseAdd = () => { setShowAdd(false); loadContacts(); };
  const handleCloseImport = () => { setShowImport(false); loadContacts(); };

  const handleDelete = async (id: number) => {
    if (!confirm('Delete this contact?')) return;
    await deleteContactAction(id);
    loadContacts();
  };

  const handleBulkDelete = async () => {
    if (selectedIds.size === 0) return;
    if (!confirm(`Delete ${selectedIds.size} contacts?`)) return;
    
    for (const id of Array.from(selectedIds)) {
      await deleteContactAction(id);
    }
    setSelectedIds(new Set());
    loadContacts();
  };

  const toggleSelect = (id: number) => {
    const newSet = new Set(selectedIds);
    if (newSet.has(id)) {
      newSet.delete(id);
    } else {
      newSet.add(id);
    }
    setSelectedIds(newSet);
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === filtered.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filtered.map(c => c.id)));
    }
  };

  const filtered = contacts.filter((c) => {
    if (!search) return true;
    const s = search.toLowerCase();
    return (
      c.email.toLowerCase().includes(s) ||
      c.firstName?.toLowerCase().includes(s) ||
      c.lastName?.toLowerCase().includes(s) ||
      c.company?.toLowerCase().includes(s) ||
      c.phone?.toLowerCase().includes(s)
    );
  });

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-[70px] items-center justify-between border-b border-gray-200 px-6">
        <div className="flex items-center gap-2">
          <Users size={20} />
          <h1 className="text-xl font-semibold">Contacts</h1>
          <span className="text-sm text-gray-400">{contacts.length}</span>
        </div>
        <div className="flex items-center gap-2">
          {selectedIds.size > 0 && (
            <button onClick={handleBulkDelete} className="flex cursor-pointer items-center gap-1 rounded-lg border border-red-300 px-3 py-1.5 text-sm text-red-600 hover:bg-red-50">
              <Trash2 size={14} /> Delete ({selectedIds.size})
            </button>
          )}
          <button onClick={() => setShowImport(true)} className="flex cursor-pointer items-center gap-1 rounded-lg border border-gray-300 px-3 py-1.5 text-sm hover:bg-gray-50">
            <Upload size={14} /> Import CSV
          </button>
          <button onClick={() => setShowAdd(true)} className="flex cursor-pointer items-center gap-1 rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700">
            <Plus size={14} /> Add Contact
          </button>
        </div>
      </div>
      <div className="border-b border-gray-200 px-6 py-2">
        <div className="flex items-center gap-2 text-gray-400">
          <Search size={16} />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search contacts..." className="w-full bg-transparent text-sm focus:outline-none" />
        </div>
      </div>
      <div className="grow overflow-auto">
        {loading ? (
          <div className="p-8 text-center text-gray-400">Loading...</div>
        ) : filtered.length === 0 ? (
          <div className="p-8 text-center text-gray-400">
            {contacts.length === 0 ? 'No contacts yet. Add one or import a CSV.' : 'No matches found.'}
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 text-left text-xs text-gray-500">
                <th className="px-4 py-3 font-medium w-10">
                  <button onClick={toggleSelectAll} className="cursor-pointer">
                    {selectedIds.size === filtered.length ? <Check size={14} /> : <MinusSquare size={14} />}
                  </button>
                </th>
                <th className="px-6 py-3 font-medium">Name</th>
                <th className="px-6 py-3 font-medium">Email</th>
                <th className="px-6 py-3 font-medium">Company</th>
                <th className="px-6 py-3 font-medium">Phone</th>
                <th className="px-6 py-3 font-medium">Title</th>
                <th className="px-6 py-3 font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((c) => (
                <tr key={c.id} className={`border-b border-gray-50 ${selectedIds.has(c.id) ? 'bg-blue-50' : ''} hover:bg-gray-50`}>
                  <td className="px-4 py-3">
                    <button onClick={() => toggleSelect(c.id)} className="cursor-pointer">
                      {selectedIds.has(c.id) ? <Check size={14} className="text-blue-600" /> : <MinusSquare size={14} className="text-gray-300" />}
                    </button>
                  </td>
                  <td className="px-6 py-3 font-medium">
                    {(() => {
                      const name = [c.firstName, c.lastName].filter(Boolean).join(' ');
                      if (!name) return '—';
                      // If the lead has a LinkedIn URL, make the name a blue link
                      // that opens the person's profile in a new tab.
                      if (c.linkedinUrl) {
                        const href = /^https?:\/\//i.test(c.linkedinUrl)
                          ? c.linkedinUrl
                          : `https://${c.linkedinUrl}`;
                        return (
                          <a
                            href={href}
                            target="_blank"
                            rel="noopener noreferrer"
                            title="Open LinkedIn profile"
                            className="text-blue-600 hover:underline"
                          >
                            {name}
                          </a>
                        );
                      }
                      return name;
                    })()}
                  </td>
                  <td className="px-6 py-3">
                    <Link href={`/marketing/compose?to=${encodeURIComponent(c.email)}&name=${encodeURIComponent(c.firstName || '')}`} className="text-blue-600 hover:underline">{c.email}</Link>
                  </td>
                  <td className="px-6 py-3 text-gray-500">{c.company || '—'}</td>
                  <td className="px-6 py-3 text-gray-500">
                    {c.phone ? (
                      <a href={`tel:${c.phone}`} className="hover:underline">{c.phone}</a>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td className="px-6 py-3 text-gray-500">{c.jobTitle || '—'}</td>
                  <td className="px-6 py-3">
                    <div className="flex items-center gap-3">
                      <Link
                        href={{
                          pathname: '/proposals/new',
                          query: {
                            clientEmail: c.email,
                            ...(([c.firstName, c.lastName].filter(Boolean).join(' '))
                              ? { clientName: [c.firstName, c.lastName].filter(Boolean).join(' ') }
                              : {}),
                            ...(c.company ? { clientCompany: c.company } : {}),
                          },
                        }}
                        title="Generate proposal (pre-fills name, company & email)"
                        className="cursor-pointer text-gray-300 hover:text-blue-600"
                      >
                        <FileText size={14} />
                      </Link>
                      {/* ↗ opens the lead's Upwork job in a new tab, same
                          shortcut as on the Kanban card (client ask Jul 2026).
                          Only shown when the enriched lead has an Upwork URL. */}
                      {c.upworkJobUrl ? (
                        <a
                          href={c.upworkJobUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          title="Open Upwork job in a new tab"
                          className="cursor-pointer text-gray-300 hover:text-blue-600"
                        >
                          <ArrowUpRight size={14} />
                        </a>
                      ) : null}
                      <button onClick={() => handleDelete(c.id)} title="Delete contact" className="cursor-pointer text-gray-300 hover:text-red-500"><Trash2 size={14} /></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {showAdd && <AddContactForm onClose={handleCloseAdd} />}
      {showImport && <ImportCSVModal onClose={handleCloseImport} />}
    </div>
  );
}
