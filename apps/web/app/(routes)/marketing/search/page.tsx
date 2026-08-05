import { searchThreads } from '@/lib/marketing/queries';
import { formatEmailString, formatISTDate, highlightText } from '@/lib/marketing/utils';
import { Search as SearchIcon, X } from 'lucide-react';
import Link from 'next/link';
import { Suspense } from 'react';
import { Search } from '@/components/marketing/search';

async function Threads({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; id?: string }>;
}) {
  let q = (await searchParams).q;
  let threads = await searchThreads(q);

  return (
    <div className="h-[calc(100vh-70px)] overflow-auto bg-background">
      {threads.map((thread) => {
        const latestEmail = thread.latestEmail;
        return (
          <Link
            key={thread.id}
            href={`/marketing/f/${thread.folderName.toLowerCase()}/${thread.id}`}
          >
            <div
              className={`flex cursor-pointer items-center border-b border-border/40 bg-card p-4 transition-colors hover:bg-muted/40`}
            >
              <div className="flex grow items-center overflow-hidden">
                <div className="mr-4 w-[200px] shrink-0">
                  <span className="truncate font-medium text-foreground">
                    {highlightText(formatEmailString(latestEmail.sender), q)}
                  </span>
                </div>
                <div className="flex grow items-center overflow-hidden">
                  <span className="mr-2 max-w-[400px] min-w-[175px] truncate font-medium text-foreground">
                    {highlightText(thread.subject, q)}
                  </span>
                  <span className="truncate text-muted-foreground">
                    {highlightText(latestEmail.body, q)}
                  </span>
                </div>
              </div>
               <div className="ml-4 flex w-40 shrink-0 items-center justify-end">
                 <span className="text-sm text-muted-foreground">
                   {formatISTDate(thread.lastActivityDate)}
                 </span>
               </div>
            </div>
          </Link>
        );
      })}
      {threads.length === 0 && q && (
        <div className="flex flex-col items-center justify-center p-12 text-center">
            <div className="rounded-full bg-muted p-4 mb-4">
                <SearchIcon size={24} className="text-muted-foreground" />
            </div>
            <h3 className="text-lg font-semibold text-foreground">No results found</h3>
            <p className="text-muted-foreground">Try searching for something else.</p>
        </div>
      )}
    </div>
  );
}

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; id?: string }>;
}) {
  return (
    <div className="flex h-full flex-col bg-background">
      <div className="flex h-[72px] items-center justify-between border-b border-border/40 bg-background/80 px-6 backdrop-blur-md sticky top-0 z-20">
        <div className="flex w-full items-center gap-2">
          <SearchIcon size={20} className="text-muted-foreground" />
          <Suspense>
            <Search />
          </Suspense>
        </div>
        <div className="ml-4 flex items-center">
          <Link href="/marketing/dashboard" passHref>
            <button
              className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              aria-label="Close search"
            >
              <X size={18} />
            </button>
          </Link>
        </div>
      </div>
      <Suspense>
        <Threads searchParams={searchParams} />
      </Suspense>
    </div>
  );
}
