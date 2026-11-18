/**
 * Whether this person may see real contact names and addresses. Viewers never do. In the public demo with live research
 * nobody does, because the contacts there are real people found by Hunter and the page is open to anyone with the link.
 */
export const seesContacts = (s: { user: { role: string }; env: { live: unknown } }): boolean => s.user.role !== "viewer" && !s.env.live;
