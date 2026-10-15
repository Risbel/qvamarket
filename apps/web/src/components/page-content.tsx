import { Fragment } from "react";
import { parsePageContent, type PageInline } from "@/lib/store-pages";
import { cn } from "@/lib/utils";

/**
 * Body of a custom store page: the merchant's text parsed into blocks (src/lib/store-pages.ts)
 * and rendered as React elements, never as HTML. `preview`: links are shown but not followed
 * (the settings preview runs on the panel's host, where store paths do not exist).
 */
export function PageContent({ content, preview = false, className }: { content: string; preview?: boolean; className?: string }) {
  const blocks = parsePageContent(content);

  return (
    <div className={cn("flex flex-col gap-4 leading-relaxed", className)}>
      {blocks.map((block, index) => {
        switch (block.type) {
          case "heading": {
            const Heading = `h${block.level}` as const;
            return (
              <Heading key={index} className={headingClass[block.level]}>
                <Inlines inlines={block.content} preview={preview} />
              </Heading>
            );
          }
          case "divider":
            return <hr key={index} className="my-2 border-border" />;
          case "paragraph":
            return (
              <p key={index}>
                {block.lines.map((line, lineIndex) => (
                  <Fragment key={lineIndex}>
                    {lineIndex > 0 && <br />}
                    <Inlines inlines={line} preview={preview} />
                  </Fragment>
                ))}
              </p>
            );
          case "list": {
            const List = block.ordered ? "ol" : "ul";
            return (
              <List key={index} className={cn("flex flex-col gap-1 pl-6", block.ordered ? "list-decimal" : "list-disc")}>
                {block.items.map((item, itemIndex) => (
                  <li key={itemIndex}>
                    <Inlines inlines={item} preview={preview} />
                  </li>
                ))}
              </List>
            );
          }
        }
      })}
    </div>
  );
}

// The page title is the h1, so "#" is an h2
const headingClass = {
  2: "mt-4 text-2xl font-semibold leading-tight first:mt-0",
  3: "mt-2 text-xl font-semibold leading-snug first:mt-0",
  4: "mt-2 text-lg font-semibold leading-snug first:mt-0",
} as const;

const linkClass ="font-medium underline underline-offset-4 hover:opacity-80";

function Inlines({ inlines, preview }: { inlines: PageInline[]; preview: boolean }) {
  return inlines.map((inline, index) => {
    if (inline.type === "text") return <Fragment key={index}>{inline.text}</Fragment>;
    if (inline.type === "bold") return <strong key={index}>{inline.text}</strong>;
    if (preview) {
      return (
        <span key={index} className={linkClass} title={inline.url}>
          {inline.text}
        </span>
      );
    }
    // Other websites open in a new tab; store paths, mailto: and tel: stay in place
    const external = /^https?:\/\//i.test(inline.url);
    return (
      <a
        key={index}
        href={inline.url}
        className={linkClass}
        {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
      >
        {inline.text}
      </a>
    );
  });
}
