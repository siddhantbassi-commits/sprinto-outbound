export const metadata = { title: "Privacy" };

const REPO = "https://github.com/siddhantbassi-commits/sprinto-outbound";

/** A plain, public privacy notice. It is reachable without signing in or seeing the welcome, because a reviewer or Google must be able to read it. */
export default function Privacy() {
  return (
    <main style={{ maxWidth: 720, margin: "0 auto", padding: "48px 20px 80px", lineHeight: 1.6 }}>
      <p style={{ margin: 0, fontSize: 13, letterSpacing: 0.4, textTransform: "uppercase", opacity: 0.7 }}>Sprinto Outbound</p>
      <h1 style={{ margin: "6px 0 4px" }}>Privacy notice</h1>
      <p style={{ margin: "0 0 28px", opacity: 0.75 }}>Last updated 19 November 2026</p>

      <p>
        Sprinto Outbound is a coursework project: a tool that researches companies from their public websites, finds a named business contact,
        and drafts an outreach email for a person to approve. It runs in <strong>test mode</strong>. It never emails a company or a contact it
        researches. This page says what it keeps and why.
      </p>

      <h2>What the app handles</h2>
      <ul>
        <li><strong>Company information</strong> read from public web pages (what the company does, who it serves), kept with the quote it came from.</li>
        <li><strong>Business contact details</strong> (name, job title and work email) that a business directory service returns for a company the user asked about. They are used to draft an email for review and are never mailed.</li>
        <li><strong>The owner&rsquo;s Gmail account</strong>, connected with the permission to send email only. It is used to send a test email to the owner, or, if a reviewer asks, to their own address. The app cannot read, list or delete any mail.</li>
        <li><strong>A reviewer&rsquo;s email address</strong>, only if the reviewer types it to receive a test email. A one-time code is sent to it to prove it is theirs. We keep the address, the time of the check, and a scrambled form of the code (never the code itself). A reviewer email is labelled as a test.</li>
        <li><strong>Visitors</strong> to the public link are not asked for a name or an email and are not tracked. The app sets a few small cookies to work: a welcome marker, a light or dark choice, and, for a reviewer who confirmed an address, a signed cookie that remembers it for 24 hours.</li>
      </ul>

      <h2>What it does not do</h2>
      <ul>
        <li>It does not sell or share personal information, and it does not use it for advertising.</li>
        <li>It does not send email to the companies or people it researches.</li>
        <li>It does not use Google user data for anything other than sending those test emails, and does not transfer it to anyone else.</li>
      </ul>

      <h2>Services involved</h2>
      <p>
        Pages are hosted on Vercel, data is stored in Supabase, drafts are written with Google&rsquo;s Gemini model, contacts come from Hunter,
        and email is sent through the Gmail API. Each handles data under its own terms.
      </p>

      <h2>Keeping and removing data</h2>
      <p>
        Decisions and sent emails are kept as an append-only record, so the project can show how each result was reached. Anyone can ask for a
        contact or a company to be left out: a suppressed domain or address is never contacted again. To ask for something to be removed,
        open an issue on the <a href={REPO}>project page</a>.
      </p>

      <p style={{ marginTop: 36, opacity: 0.75, fontSize: 14 }}>
        This is a student project, not a commercial service. The source is public at <a href={REPO}>{REPO.replace("https://", "")}</a>.
      </p>
    </main>
  );
}
