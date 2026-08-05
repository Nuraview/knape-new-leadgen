import { getBrand } from "./get-brand";
import { getWorkspaceInvitationEmailCopy } from "./get-workspace-invitation-email-copy";

export function getInvitationEmailSubject(
  locale: string | null,
  inviterName: string,
  workspaceName: string,
) {
  // `brand` must be here as well as in the template body: the subject line is
  // interpolated separately, and an unresolved placeholder becomes an empty
  // string — an invitation arriving with the subject "Jane invited you to join
  // Acme on " is worse than one carrying the wrong name.
  const values: Record<string, string> = {
    inviterName,
    workspaceName,
    brand: getBrand().name,
  };

  return getWorkspaceInvitationEmailCopy(locale).subject.replace(
    /\{\{(\w+)\}\}/g,
    (_match, key: string) => values[key] ?? "",
  );
}
