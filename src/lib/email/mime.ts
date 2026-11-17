import { randomBytes } from "node:crypto";

/**
 * Builds the one message the system can send. Headers are assembled by strict rules rather than by string
 * concatenation of whatever arrives: no value may contain a line break or control character, addresses must be a
 * single plain address, non-ASCII text is encoded, and there is no way to ask for Cc, Bcc or a second recipient.
 */

export class MimeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MimeError";
  }
}

const CONTROL = /[\u0000-\u001f\u007f\u0085\u2028\u2029]/;
const ADDRESS = /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]{1,64}@(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z]{2,63}$/;
const RUN_ID = /^[A-Za-z0-9_-]{1,64}$/;

/** True for exactly one plain address: no name part, no list, no comments, no angle brackets, no spaces. */
export const isPlainAddress = (s: string): boolean => s.length <= 254 && ADDRESS.test(s) && !s.includes("..") && !s.startsWith(".") && !s.split("@")[0]!.endsWith(".");

export function assertAddress(label: string, s: string): string {
  if (!isPlainAddress(s)) throw new MimeError(`${label} must be a single plain email address`);
  return s;
}

function assertHeaderValue(label: string, s: string): string {
  if (CONTROL.test(s)) throw new MimeError(`${label} must not contain line breaks or control characters`);
  return s;
}

const isAscii = (s: string) => /^[\x20-\x7e]*$/.test(s);

/** RFC 2047 encoded-words, split on character boundaries so a multi-byte letter is never cut in half. */
export function encodeWords(text: string): string {
  const words: string[] = [];
  let current = "";
  const flush = () => {
    if (current) words.push(`=?UTF-8?B?${Buffer.from(current, "utf8").toString("base64")}?=`);
    current = "";
  };
  for (const ch of text) {
    if (Buffer.byteLength(current + ch, "utf8") > 45) flush();
    current += ch;
  }
  flush();
  return words.join("\r\n ");
}

export function encodeSubject(subject: string): string {
  assertHeaderValue("Subject", subject);
  return isAscii(subject) && subject.length <= 60 ? subject : encodeWords(subject);
}

function displayName(name: string): string {
  assertHeaderValue("Sender name", name);
  if (isAscii(name)) return `"${name.replace(/(["\\])/g, "\\$1")}"`;
  return encodeWords(name);
}

const wrap76 = (b64: string) => b64.replace(/(.{76})/g, "$1\r\n").replace(/\r\n$/, "");

export interface MessageInput {
  /** The authenticated sender's address. */
  from: string;
  fromName?: string;
  /** The single recipient. Set by the server's test-mode setting, never by a draft. */
  to: string;
  subject: string;
  body: string;
  /** Searchable in Sent, so an unknown send can be found by hand. */
  runId: string;
  date?: Date;
}

export function buildMessage(input: MessageInput): string {
  const from = assertAddress("From", input.from);
  const to = assertAddress("To", input.to);
  if (!RUN_ID.test(input.runId)) throw new MimeError("Run id must be letters, digits, dashes or underscores");
  const date = input.date ?? new Date();
  if (Number.isNaN(date.getTime())) throw new MimeError("Date is invalid");

  const text = input.body.replace(/\r\n|\r|\n/g, "\n").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").replace(/\n/g, "\r\n");
  const host = from.split("@")[1]!;
  const headers = [
    `From: ${input.fromName ? `${displayName(input.fromName)} <${from}>` : from}`,
    `To: ${to}`,
    `Subject: ${encodeSubject(input.subject)}`,
    `Date: ${date.toUTCString().replace("GMT", "+0000")}`,
    `Message-ID: <${input.runId}.${randomBytes(8).toString("hex")}@${host}>`,
    `X-Outbound-Run: ${input.runId}`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
  ];
  return `${headers.join("\r\n")}\r\n\r\n${wrap76(Buffer.from(text, "utf8").toString("base64"))}\r\n`;
}

/** The form the Gmail API wants in its `raw` field. */
export const toRaw = (message: string): string => Buffer.from(message, "utf8").toString("base64url");
