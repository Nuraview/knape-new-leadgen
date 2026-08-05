"use client";

import Link from "next/link";
import { ColumnDef } from "@tanstack/react-table";

import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";

import { engagementStatuses, statuses } from "../table-data/data";
import { Lead } from "../table-data/schema";
import { DataTableColumnHeader } from "./data-table-column-header";
import { DataTableRowActions } from "./data-table-row-actions";
import moment from "moment";

// Colors mirror the prioritization VK described in the May-20 call: clicks are
// the most call-worthy signal, bounces are red so they're skipped, opens are
// the secondary callable bucket.
const engagementBadgeClass: Record<string, string> = {
  clicked: "bg-emerald-100 text-emerald-800 border-emerald-200",
  opened: "bg-sky-100 text-sky-800 border-sky-200",
  bounced: "bg-red-100 text-red-800 border-red-200",
  delivered: "bg-slate-100 text-slate-700 border-slate-200",
  sent: "bg-slate-50 text-slate-600 border-slate-200",
  queued: "bg-slate-50 text-slate-500 border-slate-200",
};

type ConfigItem = { id: string; name: string };

export const createColumns = (
  leadSources: ConfigItem[],
  leadStatuses: ConfigItem[],
  leadTypes: ConfigItem[],
): ColumnDef<Lead>[] => [
  {
    accessorKey: "createdAt",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Expected close" />
    ),
    cell: ({ row }) => (
      <div className="w-[80px]">
        {moment(row.getValue("createdAt")).format("YY-MM-DD")}
      </div>
    ),
    enableSorting: false,
    enableHiding: false,
  },
  {
    accessorKey: "updatedAt",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Last update" />
    ),
    cell: ({ row }) => (
      <div className="w-[80px]">
        {moment(row.getValue("updatedAt")).format("YY-MM-DD")}
      </div>
    ),
    enableSorting: false,
    enableHiding: false,
  },
  {
    accessorKey: "assigned_to_user",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Assigned to" />
    ),

    cell: ({ row }) => (
      <div className="w-[150px]">
        {
          //@ts-ignore
          //TODO: fix this
          row.getValue("assigned_to_user")?.name ?? "Unassigned"
        }
      </div>
    ),
    enableSorting: true,
    enableHiding: true,
  },
  {
    accessorKey: "company",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Company" />
    ),

    cell: ({ row }) => (
      <div className="">
        {
          //@ts-ignore
          //TODO: fix this
          row.getValue("company") ?? "Unassigned"
        }
      </div>
    ),
    enableSorting: false,
    enableHiding: true,
  },
  {
    accessorKey: "firstName",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Name" />
    ),

    cell: ({ row }) => (
      <Link href={`/crm/leads/${row.original.id}`} data-testid="lead-row-name">
        <div>
          {[row.original.firstName, row.original.lastName].filter(Boolean).join(" ")}
        </div>
      </Link>
    ),
    enableSorting: false,
    enableHiding: true,
  },
  {
    accessorKey: "email",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="E-mail" />
    ),

    cell: ({ row }) => <div className="w-[150px]">{row.getValue("email")}</div>,
    enableSorting: true,
    enableHiding: true,
  },
  {
    id: "engagement",
    accessorFn: (row: any) => row.engagement?.latestStatus ?? "none",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Engagement" />
    ),
    cell: ({ row }) => {
      const engagement = (row.original as any).engagement as
        | {
            latestStatus: string;
            lastSentAt: string | null;
            totalSends: number;
            openedCount: number;
            clickedCount: number;
          }
        | null
        | undefined;

      if (!engagement || engagement.totalSends === 0) {
        return <span className="text-muted-foreground text-xs">—</span>;
      }

      const status = engagement.latestStatus;
      const meta = engagementStatuses.find((s) => s.value === status);
      const colorClass =
        engagementBadgeClass[status] ?? "bg-slate-50 text-slate-600 border-slate-200";

      return (
        <div className="flex w-[160px] flex-col gap-1">
          <Badge variant="outline" className={`${colorClass} w-fit gap-1`}>
            {meta?.icon ? <meta.icon className="h-3 w-3" /> : null}
            {meta?.label ?? status}
          </Badge>
          {engagement.lastSentAt ? (
            <span className="text-[10px] text-muted-foreground">
              {moment(engagement.lastSentAt).fromNow()}
              {engagement.totalSends > 1
                ? ` · ${engagement.totalSends} sends`
                : ""}
            </span>
          ) : null}
        </div>
      );
    },
    filterFn: (row, id, value) => value.includes(row.getValue(id) as string),
    enableSorting: true,
    enableHiding: true,
  },
  {
    accessorKey: "phone",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Phone" />
    ),

    cell: ({ row }) => <div className="w-[150px]">{row.getValue("phone")}</div>,
    enableSorting: false,
    enableHiding: false,
  },
  {
    accessorKey: "status",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Status" />
    ),
    cell: ({ row }) => {
      const status = statuses.find(
        (status) => status.value === row.getValue("status")
      );

      if (!status) {
        return null;
      }

      return (
        <div className="flex w-[100px] items-center">
          {status.icon && (
            <status.icon className="mr-2 h-4 w-4 text-muted-foreground" />
          )}
          <span>{status.label}</span>
        </div>
      );
    },
    filterFn: (row, id, value) => {
      return value.includes(row.getValue(id));
    },
  },
  {
    id: "actions",
    cell: ({ row }) => (
      <DataTableRowActions
        row={row}
        leadSources={leadSources}
        leadStatuses={leadStatuses}
        leadTypes={leadTypes}
      />
    ),
  },
];
