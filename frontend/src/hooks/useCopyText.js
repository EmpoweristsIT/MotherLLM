import { useState } from "react";
import { marked } from "marked";

export default function useCopyText(delay = 2500) {
  const [copied, setCopied] = useState(false);

  const copyText = async (markdown) => {
    if (!markdown) return;

    try {
      // Convert Markdown to HTML
      let html = marked.parse(markdown);

      // Trim excessive spacing by replacing <p> with inline formatting
      html = html
        .replace(/<\/p>\s*<p>/g, '<br><br>') // paragraph to break
        .replace(/^<p>/, '')                // remove leading <p>
        .replace(/<\/p>$/, '')              // remove trailing </p>
        .replace(/<\/?p>/g, '');            // strip any remaining <p>

      // Optional: wrap in minimal formatting container
      const styledHTML = `<div style="font-family: sans-serif; line-height: 1.4;">${html}</div>`;

      // Clean plain text fallback
      const plainText = markdown.replace(/[*_`#>~\-]/g, '').trim();

      if (navigator.clipboard?.write) {
        await navigator.clipboard.write([
          new ClipboardItem({
            "text/html": new Blob([styledHTML], { type: "text/html" }),
            "text/plain": new Blob([plainText], { type: "text/plain" }),
          }),
        ]);
      } else {
        await navigator.clipboard.writeText(plainText);
      }

      setCopied(markdown);
      setTimeout(() => setCopied(false), delay);
    } catch (err) {
      console.error("Copy failed:", err);
    }
  };

  return { copyText, copied };
}
