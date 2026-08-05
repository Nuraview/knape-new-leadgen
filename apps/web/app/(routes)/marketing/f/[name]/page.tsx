import { ThreadHeader, ThreadList } from '@/components/marketing/thread-list';
import { getThreadsForFolder } from '@/lib/marketing/queries';
import { Suspense } from 'react';

export function generateStaticParams() {
  const folderNames = [
    'inbox',
    'starred',
    'drafts',
    'sent',
    'archive',
    'trash',
  ];

  return folderNames.map((name) => ({ name }));
}

export default function ThreadsPage({
  params,
  searchParams,
}: {
  params: Promise<{ name: string }>;
  searchParams: Promise<{ q?: string; id?: string }>;
}) {
  return (
    <div className="flex h-full">
      <Suspense fallback={<ThreadsSkeleton folderName="" />}>
        <Threads params={params} searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

function ThreadsSkeleton({ folderName }: { folderName: string }) {
  return (
    <div className="grow overflow-hidden border-r border-border/40">
      <ThreadHeader folderName={folderName} />
    </div>
  );
}

async function Threads({
  params,
  searchParams,
}: {
  params: Promise<{ name: string }>;
  searchParams: Promise<{ q?: string; id?: string }>;
}) {
  let { name } = await params;
  let { q } = await searchParams;
  let threads = await getThreadsForFolder(name);

  return <ThreadList folderName={name} threads={threads} searchQuery={q} />;
}
