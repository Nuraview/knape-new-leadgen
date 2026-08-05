'use client';

import * as React from 'react';
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarRail,
  useSidebar,
} from '@/components/ui/sidebar';
import { cn } from '@/lib/utils';
import { NavMain } from './nav-main';
import { NavActivityToday } from './nav-activity-today';
import { NavUser } from './nav-user';
import { Activity, Inbox, LayoutGrid, Phone, Send, FileSignature } from 'lucide-react';
import getAdministrationMenuItem from './menu-items/Administration';
import type { NavItem } from './nav-main';

/**
 * AppSidebar Component - Task Groups 1.2, 2.2-2.7, 3.1, 5.3, 5.4
 *
 * Core sidebar component for NuraviewCRM application layout.
 * Implements shadcn/ui sidebar pattern with:
 * - Logo and "N" branding symbol with rotation animation
 * - Build version display in footer (when expanded)
 * - Navigation with Dashboard and module items
 * - Nav-user section in footer for user profile and actions
 *
 * Phase 2 Updates:
 * - Task 2.2: Added Dashboard menu item integration
 * - Task 2.3: Added CRM module navigation (collapsible group with module filtering)
 * - Task 2.4: Added Projects module navigation (simple item with module filtering)
 * - Task 2.5: Added Emails module navigation (simple item with module filtering)
 * - Task 2.6: Added remaining module navigation items (Employees, Reports, Documents, Databox)
 * - Task 2.7: Added Administration menu with role-based visibility (is_admin check)
 * - NavMain component renders all enabled module navigation items
 * - Module filtering ensures only enabled modules appear in navigation
 * - Role-based visibility: Administration only shows for admin users
 *
 * Phase 3 Updates:
 * - Task 3.1: Added NavUser component in SidebarFooter
 * - NavUser displays user avatar, name, email
 * - NavUser provides dropdown with user actions (Profile, Settings, Logout)
 * - NavUser adapts to collapsed/expanded sidebar states
 * - Build version moved above NavUser in footer
 *
 * Phase 5 Updates (Design Consistency):
 * - Task 5.3: Removed duration-200 from app name animation (uses Tailwind default)
 * - Task 5.3: Kept duration-500 on "N" symbol for intentional brand emphasis
 * - Task 5.4: Changed build version text-gray-500 to text-muted-foreground for theme support
 *
 * @param modules - Array of enabled modules from system_Modules_Enabled table
 * @param dict - Localization dictionary for navigation labels
 * @param build - Build number for version display
 * @param session - User session data for role-based navigation and user profile
 */

interface User {
  id: string;
  name?: string | null;
  email?: string | null;
  image?: string | null;
  role?: string | null;
  userStatus?: string;
  userLanguage?: string;
  lastLoginAt?: Date;
}

interface Session {
  user: User;
}

interface AppSidebarProps extends React.ComponentProps<typeof Sidebar> {
  dict: any;
  session: Session;
}

function SidebarLogo({ isExpanded }: { isExpanded: boolean }) {
  // The logo is a horizontal "NURAVIEW" wordmark — it can't fit the narrow
  // collapsed icon rail, so there we show a compact "N" badge instead.
  if (!isExpanded) {
    return (
      <div className="flex-shrink-0 grid size-8 place-items-center rounded-full border text-sm font-medium">
        N
      </div>
    );
  }

  // The asset is a single-colour (white) wordmark with an alpha channel. The
  // sidebar is themeable (light AND dark), so a fixed-colour image would be
  // invisible on one of them. We instead use the asset as an alpha MASK and
  // paint it with the theme's sidebar-foreground colour — dark on the light
  // theme, near-white on the dark theme. Width is locked to the asset's
  // 705:156 aspect at h-9. The wordmark already contains the "NuraView"
  // lettering, so no separate text label is rendered beside it.
  return (
    <span
      role="img"
      aria-label="NuraView"
      className={cn(
        'block h-9 w-[163px] flex-shrink-0 bg-sidebar-foreground',
        '[mask-image:url(/images/logo.png)] [mask-position:left_center] [mask-repeat:no-repeat] [mask-size:contain]',
        '[-webkit-mask-image:url(/images/logo.png)] [-webkit-mask-position:left_center] [-webkit-mask-repeat:no-repeat] [-webkit-mask-size:contain]',
      )}
    />
  );
}

export function AppSidebar({ dict, session, ...props }: AppSidebarProps) {
  const { state } = useSidebar();
  const isExpanded = state === 'expanded';

  // NuraView CRM is a focused internal tool for Upwork lead review. The
  // only primary surfaces are the Leads list + Kanban. Legacy NextCRM
  // modules (Projects, Campaigns, Invoices, Documents, Email, Reports,
  // Contracts, Products, Opportunities, Companies, Contacts, Targets,
  // generic Dashboard) are retained as routes but hidden from navigation.
  // Restore them here if the business need ever appears.
  const navItems: NavItem[] = [
    { title: 'Activity', url: '/activity', icon: Activity },
    { title: 'Leads', url: '/leads', icon: Inbox },
    { title: 'Kanban', url: '/leads/kanban', icon: LayoutGrid },
    { title: 'Dialer', url: '/dialer', icon: Phone },
    { title: 'Proposals', url: '/proposals', icon: FileSignature },
    {
      title: 'Marketing',
      icon: Send,
      items: [
        { title: 'Compose', url: '/marketing/compose' },
        { title: 'Dashboard', url: '/marketing/dashboard' },
        { title: 'Sequences', url: '/marketing/sequences' },
        { title: 'Sent', url: '/marketing/f/sent' },
        { title: 'Contacts', url: '/marketing/contacts' },
        { title: 'Templates', url: '/marketing/templates' },
      ],
    },
  ];

  // Administration stays admin-only — covers user management, API tokens,
  // CRM settings (currencies, lead statuses).
  if (session?.user?.role === 'admin') {
    navItems.push(getAdministrationMenuItem({ title: dict?.settings || 'Administration' }));
  }

  // Prepare user data for NavUser component
  const userData = {
    id: session.user.id,
    name: session.user.name,
    email: session.user.email,
    avatar: session.user.image,
  };

  return (
    <Sidebar collapsible='icon' {...props}>
      {/* Header with Logo and Branding */}
      <SidebarHeader>
        <div className={cn('flex items-center py-1', isExpanded ? 'px-1' : 'justify-center')}>
          {/* NuraView wordmark logo (public/images/logo.png) when expanded;
              falls back to a compact "N" badge when collapsed or if the asset
              is missing. The wordmark already includes the "NuraView" text, so
              no separate heading is rendered beside it. */}
          <SidebarLogo isExpanded={isExpanded} />
        </div>
      </SidebarHeader>

      {/* Main Content - Navigation */}
      <SidebarContent>
        {/* NavMain component with all enabled module navigation items */}
        <NavMain items={navItems} dict={dict} />

        {/* Today's activity panel — grows (flex-1) to fill the empty middle
            space so there's no dead gap, sitting between the nav and the
            user footer. */}
        <NavActivityToday />
      </SidebarContent>

      {/* Footer with NavUser and Build Version */}
      <SidebarFooter>
        {/* Task 3.1: NavUser component with user profile and actions */}
        <NavUser user={userData} />
      </SidebarFooter>

      {/* Rail for toggling sidebar on desktop */}
      <SidebarRail />
    </Sidebar>
  );
}
