/** How a person is shown when addresses must stay private: an initial, and the first letter of the address, the same as the database's masked view. */
export const maskName = (first: string | null | undefined): string => (first && first.trim() ? `${first.trim()[0]!.toUpperCase()}.` : "(name hidden)");

export const maskEmail = (email: string | null | undefined): string | null => {
  if (!email || !email.includes("@")) return null;
  const [local, domain] = [email.slice(0, email.lastIndexOf("@")), email.slice(email.lastIndexOf("@") + 1)];
  return `${local.slice(0, 1)}***@${domain}`;
};
