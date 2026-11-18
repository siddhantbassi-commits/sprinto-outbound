/**
 * Whether this person may see real contact names and addresses. Viewers never do. The public demo with live research hides
 * everyone's, because there the contacts are strangers found by Hunter on a page open to anyone. A guest is an admin and sees them.
 */
export const seesContacts = (s: { user: { role: string }; env: { live: unknown } }): boolean => s.user.role !== "viewer" && !s.env.live;
