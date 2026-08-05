'use client';

import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/marketing/ui/tooltip';
import { moveThreadToDone, moveThreadToTrash } from '@/lib/marketing/actions';
import { Archive, Check, Clock } from 'lucide-react';
import { useActionState } from 'react';

interface ThreadActionsProps {
  threadId: number;
}

export function ThreadActions({ threadId }: ThreadActionsProps) {
  const initialState = {
    error: null,
    success: false,
  };

  const [doneState, doneAction, donePending] = useActionState(
    moveThreadToDone,
    initialState,
  );
  const [trashState, trashAction, trashPending] = useActionState(
    moveThreadToTrash,
    initialState,
  );

  return (
    <TooltipProvider>
      <div className="flex items-center space-x-1">
        <Tooltip>
          <TooltipTrigger asChild>
            <form action={doneAction}>
              <input type="hidden" name="threadId" value={threadId} />
              <button
                type="submit"
                disabled={donePending}
                className="flex h-6 w-6 cursor-pointer items-center justify-center rounded-full transition-colors hover:bg-gray-200 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Check size={14} className="text-gray-600" />
              </button>
            </form>
          </TooltipTrigger>
          <TooltipContent>
            <p>Archive</p>
          </TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              disabled
              className="flex h-6 w-6 cursor-pointer items-center justify-center rounded-full transition-colors hover:bg-gray-200 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Clock size={14} className="text-gray-400" />
            </button>
          </TooltipTrigger>
          <TooltipContent>
            <p>Snooze — coming soon</p>
          </TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <form action={trashAction}>
              <input type="hidden" name="threadId" value={threadId} />
              <button
                type="submit"
                disabled={trashPending}
                className="flex h-6 w-6 cursor-pointer items-center justify-center rounded-full transition-colors hover:bg-gray-200 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Archive size={14} className="text-gray-600" />
              </button>
            </form>
          </TooltipTrigger>
          <TooltipContent>
            <p>Move to Trash</p>
          </TooltipContent>
        </Tooltip>
      </div>
    </TooltipProvider>
  );
}
