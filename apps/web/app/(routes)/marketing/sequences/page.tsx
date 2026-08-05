'use client';

import { useEffect, useState } from 'react';
import { Loader2, Play, Pause, Trash2, Download, Upload } from 'lucide-react';
import { formatISTDate } from '@/lib/marketing/utils';

type Sequence = {
  id: number;
  campaign: string | null;
  status: string;
  created_at: string;
  item_count: number;
  sent_count: number;
};

type Exclusion = {
  id: number;
  email: string;
  reason: string | null;
  created_at: string;
};

export default function SequencesAdminPage() {
  const [sequences, setSequences] = useState<Sequence[]>([]);
  const [exclusions, setExclusions] = useState<Exclusion[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'sequences' | 'exclusions'>('sequences');

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    setLoading(true);
    try {
      const [seqRes, exclRes] = await Promise.all([
        fetch('/api/marketing/sequences'),
        fetch('/api/marketing/sequence-exclusions'),
      ]);

      const sequencesData = await seqRes.json();
      const exclusionsData = await exclRes.json();

      setSequences(Array.isArray(sequencesData) ? sequencesData : []);
      setExclusions(Array.isArray(exclusionsData) ? exclusionsData : []);
    } catch (error) {
      console.error('Error fetching data:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleStopSequence = async (id: number) => {
    if (!confirm('Stop this sequence? Pending follow-ups will not be sent.')) return;

    try {
      const res = await fetch(`/api/marketing/sequences/${id}/stop`, { method: 'POST' });
      if (res.ok) {
        fetchData();
      }
    } catch (error) {
      console.error('Error stopping sequence:', error);
    }
  };

  const handleRemoveExclusion = async (email: string) => {
    if (!confirm(`Remove "${email}" from exclusion list?`)) return;

    try {
      const res = await fetch(`/api/marketing/sequence-exclusions?email=${encodeURIComponent(email)}`, {
        method: 'DELETE',
      });
      if (res.ok) {
        fetchData();
      }
    } catch (error) {
      console.error('Error removing exclusion:', error);
    }
  };

  const handleUploadExclusions = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const text = await file.text();
    const emails = text.split('\n').map(e => e.trim()).filter(Boolean);

    for (const email of emails) {
      try {
        await fetch('/api/marketing/sequence-exclusions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, reason: 'CSV upload' }),
        });
      } catch (error) {
        console.error('Error adding exclusion:', email, error);
      }
    }

    fetchData();
    event.target.value = '';
  };

  const handleExportExclusions = () => {
    const csv = exclusions.map(e => e.email).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'exclusions.csv';
    a.click();
  };

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="animate-spin" />
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-[60px] items-center justify-between border-b border-gray-200 px-6">
        <h1 className="text-xl font-semibold">Sequence Admin</h1>
        <div className="flex gap-2">
          <button
            onClick={() => setActiveTab('sequences')}
            className={`px-4 py-2 text-sm font-medium ${
              activeTab === 'sequences' ? 'text-blue-600' : 'text-gray-600'
            }`}
          >
            Sequences
          </button>
          <button
            onClick={() => setActiveTab('exclusions')}
            className={`px-4 py-2 text-sm font-medium ${
              activeTab === 'exclusions' ? 'text-blue-600' : 'text-gray-600'
            }`}
          >
            Stop List
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-auto p-6">
        {activeTab === 'sequences' && (
          <div className="space-y-4">
            {sequences.length === 0 ? (
              <p className="text-gray-500">No sequences found.</p>
            ) : (
              <table className="w-full">
                <thead>
                  <tr className="border-b text-left text-sm text-gray-500">
                    <th className="pb-2 font-medium">ID</th>
                    <th className="pb-2 font-medium">Campaign</th>
                    <th className="pb-2 font-medium">Status</th>
                    <th className="pb-2 font-medium">Progress</th>
                    <th className="pb-2 font-medium">Created</th>
                    <th className="pb-2 font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {sequences.map((seq) => (
                    <tr key={seq.id} className="border-b">
                      <td className="py-3">{seq.id}</td>
                      <td className="py-3">{seq.campaign || '-'}</td>
                      <td className="py-3">
                        <span
                          className={`inline-flex rounded-full px-2 text-xs font-semibold ${
                            seq.status === 'active'
                              ? 'bg-green-100 text-green-700'
                              : seq.status === 'complete'
                              ? 'bg-blue-100 text-blue-700'
                              : 'bg-gray-100 text-gray-700'
                          }`}
                        >
                          {seq.status}
                        </span>
                      </td>
                       <td className="py-3">
                         {seq.sent_count}/{seq.item_count} sent
                       </td>
                       <td className="py-3 text-sm text-gray-500">
                         {formatISTDate(seq.created_at)}
                       </td>
                      <td className="py-3">
                        {seq.status === 'active' && (
                          <button
                            onClick={() => handleStopSequence(seq.id)}
                            className="flex items-center gap-1 text-sm text-red-600 hover:text-red-700"
                          >
                            <Pause size={14} />
                            Stop
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}

        {activeTab === 'exclusions' && (
          <div className="space-y-4">
            <div className="flex justify-end gap-2">
              <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-gray-300 px-4 py-2 text-sm hover:bg-gray-50">
                <Upload size={16} />
                Upload CSV
                <input
                  type="file"
                  accept=".csv,.txt"
                  onChange={handleUploadExclusions}
                  className="hidden"
                />
              </label>
              <button
                onClick={handleExportExclusions}
                className="flex items-center gap-2 rounded-lg border border-gray-300 px-4 py-2 text-sm hover:bg-gray-50"
              >
                <Download size={16} />
                Export
              </button>
            </div>

            {exclusions.length === 0 ? (
              <p className="text-gray-500">No exclusions in stop list.</p>
            ) : (
              <table className="w-full">
                <thead>
                  <tr className="border-b text-left text-sm text-gray-500">
                    <th className="pb-2 font-medium">Email</th>
                    <th className="pb-2 font-medium">Reason</th>
                    <th className="pb-2 font-medium">Added</th>
                    <th className="pb-2 font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {exclusions.map((excl) => (
                    <tr key={excl.id} className="border-b">
                      <td className="py-3">{excl.email}</td>
                       <td className="py-3 text-sm text-gray-500">
                         {excl.reason || '-'}
                       </td>
                       <td className="py-3 text-sm text-gray-500">
                         {formatISTDate(excl.created_at)}
                       </td>
                      <td className="py-3">
                        <button
                          onClick={() => handleRemoveExclusion(excl.email)}
                          className="flex items-center gap-1 text-sm text-red-600 hover:text-red-700"
                        >
                          <Trash2 size={14} />
                          Remove
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
