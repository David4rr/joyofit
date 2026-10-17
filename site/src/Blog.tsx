import { ArrowLeft, ArrowRight, Check } from "lucide-react";

import { POSTS, findPost, postPath } from "./blog";
import type { Block, Post } from "./blog/types";
import { BLOG_PATH } from "./lib";

const link = "font-semibold text-primary underline underline-offset-4 hover:text-primary/80";

const INLINE_LINK = /\[([^\]]+)\]\(([^)\s]+)\)/g;

/** Text with [label](href) links; everything else is plain text. External links open in a new tab. */
function Inline({ text }: { text: string }) {
  const parts: React.ReactNode[] = [];
  let last = 0;
  for (const match of text.matchAll(INLINE_LINK)) {
    const [whole, label, href] = match as unknown as [string, string, string];
    if (match.index > last) parts.push(text.slice(last, match.index));
    const external = /^https?:/.test(href);
    parts.push(
      <a key={match.index} className={link} href={href} {...(external ? { target: "_blank", rel: "noopener" } : {})}>
        {label}
      </a>,
    );
    last = match.index + whole.length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return <>{parts}</>;
}

function BlockView({ block }: { block: Block }) {
  switch (block.kind) {
    case "h2":
      return <h2 className="pt-4 text-xl font-extrabold tracking-tight md:text-2xl">{block.text}</h2>;
    case "p":
      return (
        <p className="text-base leading-relaxed">
          <Inline text={block.text} />
        </p>
      );
    case "ul":
      return (
        <ul className="space-y-2.5">
          {block.items.map((item) => (
            <li key={item} className="flex gap-2.5 text-base leading-relaxed">
              <Check className="mt-1 size-4 shrink-0 text-primary" aria-hidden />
              <span>
                <Inline text={item} />
              </span>
            </li>
          ))}
        </ul>
      );
    case "ol":
      return (
        <ol className="space-y-4">
          {block.items.map((item, i) => (
            <li key={item} className="flex gap-3.5">
              <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-sm font-extrabold tabular-nums">
                {i + 1}
              </span>
              <p className="pt-0.5 text-base leading-relaxed">
                <Inline text={item} />
              </p>
            </li>
          ))}
        </ol>
      );
    case "note":
      return (
        <p className="rounded-2xl bg-muted p-4 text-[0.9375rem] leading-relaxed text-muted-foreground">
          <Inline text={block.text} />
        </p>
      );
  }
}

function dateLabel(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("id-ID", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

function Tag({ children }: { children: React.ReactNode }) {
  return <span className="inline-flex rounded-full bg-primary/10 px-3 py-1 text-xs font-bold text-primary">{children}</span>;
}

export function BlogIndexPage() {
  return (
    <section data-section="blog" className="py-12 md:py-16">
      <div className="mx-auto w-full max-w-3xl px-4 md:px-6">
        <a
          href="/"
          className="inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" aria-hidden />
          Kembali ke beranda
        </a>
        <h1 className="mt-4 text-3xl font-extrabold tracking-tight text-balance md:text-[2.75rem] md:leading-[1.1]">
          Blog JoyoFit
        </h1>
        <p className="mt-3 text-muted-foreground">
          Fitur yang sudah bisa kamu pakai sekarang, dan cara memakainya. Fitur yang masih dikerjakan baru ditulis di sini
          setelah rilis.
        </p>
        <ul className="mt-8 space-y-3">
          {POSTS.map((post) => (
            <li key={post.slug}>
              <a
                href={postPath(post)}
                className="group block rounded-3xl bg-card p-5 transition-colors hover:bg-muted focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none md:p-6"
              >
                <span className="flex items-center gap-3 text-xs font-semibold text-muted-foreground">
                  <Tag>{post.tag}</Tag>
                  <time dateTime={post.date}>{dateLabel(post.date)}</time>
                </span>
                <h2 className="mt-3 text-lg font-extrabold tracking-tight md:text-xl">{post.title}</h2>
                <p className="mt-1.5 text-[0.9375rem] leading-relaxed text-muted-foreground">{post.description}</p>
                <span className="mt-3 inline-flex items-center gap-1.5 text-sm font-bold text-primary">
                  Baca
                  <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" aria-hidden />
                </span>
              </a>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

function PostBody({ post }: { post: Post }) {
  return (
    <article data-section="blog-post" className="py-12 md:py-16">
      <div className="mx-auto w-full max-w-3xl px-4 md:px-6">
        <a
          href={BLOG_PATH}
          className="inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" aria-hidden />
          Semua tulisan
        </a>
        <p className="mt-4 flex items-center gap-3 text-xs font-semibold text-muted-foreground">
          <Tag>{post.tag}</Tag>
          <time dateTime={post.date}>{dateLabel(post.date)}</time>
        </p>
        <h1 className="mt-3 text-3xl font-extrabold tracking-tight text-balance md:text-[2.75rem] md:leading-[1.1]">
          {post.title}
        </h1>
        <p className="mt-3 text-lg leading-relaxed text-muted-foreground">{post.description}</p>
        <div className="mt-8 space-y-4">
          {post.body.map((block, i) => (
            <BlockView key={i} block={block} />
          ))}
        </div>
        {post.more && (
          <nav aria-label="Baca juga" className="mt-10 rounded-3xl bg-card p-5 md:p-6">
            <h2 className="text-base font-bold">Baca juga</h2>
            <ul className="mt-2">
              {post.more.map((item) => (
                <li key={item.href}>
                  <a className={`${link} inline-flex min-h-11 items-center`} href={item.href}>
                    {item.label}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
        )}
      </div>
    </article>
  );
}

/** The post at [path] (a /blog/<slug> entry of PAGES). */
export function BlogPostPage({ path }: { path: string }) {
  const post = findPost(path);
  return post ? <PostBody post={post} /> : null;
}
