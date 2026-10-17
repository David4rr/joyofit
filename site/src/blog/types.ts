// A blog post is plain data so the page, the head tags and the sitemap all read one source.
// Inline markup in any text: [label](href) for a link. No other markup.

export type Block =
  | { kind: "p"; text: string }
  | { kind: "h2"; text: string }
  | { kind: "ul"; items: readonly string[] }
  | { kind: "ol"; items: readonly string[] }
  | { kind: "note"; text: string };

export type Post = {
  /** URL segment: the post lives at /blog/<slug>. */
  slug: string;
  /** The page <h1> and the title before " | JoyoFit". */
  title: string;
  /** Meta description and the line under the title in the index. */
  description: string;
  /** ISO date (YYYY-MM-DD) the post went live. */
  date: string;
  /** Short label for the kind of post, shown as a chip. */
  tag: string;
  body: readonly Block[];
  /** Links shown under the post. */
  more?: readonly { href: string; label: string }[];
  /** Drafts only: what to re-check against the build before publishing. Never rendered. */
  verify?: readonly string[];
};
