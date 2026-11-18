/**
 * The first-visit walkthrough: a handful of short stops, each on a real page and pointing at a real part of it. What it says
 * is fixed text, not generated, and it only describes what the product does. A stop that needs a role the person does not
 * have is left out, so nobody is shown a page they cannot open.
 */

export interface TourStep {
  id: string;
  /** The page to show behind the card. Null stays where the person is. */
  path: string | null;
  /** The `data-tour` value of the part of the page to point at. Null points at nothing (a welcome or a goodbye). */
  anchor: string | null;
  title: string;
  body: string;
  /** Left out for anyone who is not an operator or admin. */
  operatorOnly?: boolean;
}

export const TOUR: TourStep[] = [
  { id: "welcome", path: null, anchor: null, title: "Welcome to Sprinto Outbound", body: "It finds companies likely to need Sprinto, researches each one, picks one person to write to, and drafts a formal email for you to approve. Nothing is ever sent to a real person: test mode delivers only to your own address." },
  { id: "discover", path: "/discover", anchor: "nav/discover", operatorOnly: true, title: "Start here: Discover", body: "Describe what a good customer looks like, and see companies that match, each with the reason it was suggested. Pick the ones to research." },
  { id: "criteria", path: "/discover", anchor: "criteria", operatorOnly: true, title: "Your ICP, made editable", body: "These settings start from your signed-off ideal customer profile. Change the regions, sizes or reasons and search again. Searching is free: it uses no Hunter credits and no AI." },
  { id: "paste", path: "/runs/new", anchor: "nav/runs/new", operatorOnly: true, title: "Already have a list?", body: "Paste domains, links or a spreadsheet column, or drop a CSV. The domains are found for you and checked before anything runs." },
  { id: "today", path: "/", anchor: "nav/", title: "Today: your morning at a glance", body: "Drafts waiting for you, follow-ups that are due, new companies from the weekly digest, and what is running now. Start each day here." },
  { id: "runs", path: "/runs", anchor: "nav/runs", title: "Watch research happen", body: "Each run shows a progress bar with roughly how long is left. You can open other pages or tabs while it works, and a small card will tell you the moment it is ready." },
  { id: "leads", path: "/leads", anchor: "nav/leads", title: "Leads and call briefs", body: "Every researched company, best fit first, with who to speak to and a brief for the discovery call: why now, talking points with their own words as evidence, questions to ask and likely objections." },
  { id: "review", path: "/review", anchor: "nav/review", title: "You approve every email", body: "Each draft waits here. Read it as the recipient would see it, edit it if you like, then approve. Only then is it sent, and in test mode only to you." },
  { id: "settings", path: "/settings", anchor: "nav/settings", title: "Set it up once", body: "Add your name, title and postal address, verify what an email may say about Sprinto, and keep the test address current. Nothing is written until these are set." },
  { id: "done", path: null, anchor: null, title: "That is the tour", body: "Press Ctrl or Command and K to search or jump anywhere. You can take this tour again from the question mark at the top of any page." },
];

export const stepsFor = (canRun: boolean): TourStep[] => TOUR.filter((s) => canRun || !s.operatorOnly);

export const TOUR_KEY = "sprinto.tour.v1";
export type TourState = "done" | "skipped";
