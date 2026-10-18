/** Team invitations for existing accounts. Limits shared by the panel and the server. */
export const INVITATION_DAYS = 7;
export const MAX_PENDING_INVITATIONS = 20;

/** The link the owner sends (WhatsApp, Telegram...): on the panel's own host. */
export function invitationPath(id: string) {
  return `/invite/${id}`;
}
