import { useState } from "react";
import { marked } from "marked";

export default function useCopyText(delay = 2500) {
  const [copied, setCopied] = useState(false);

  const copyText = async (markdown) => {
    if (!markdown) return;

    try {
      // Convert Markdown to HTML with proper breaks and list support
      let html = marked.parse(markdown, { breaks: true });

      // Optional: wrap in minimal formatting container
      const styledHTML = `<div style="font-family: sans-serif; line-height: 1.6;">${html}</div>`;

      // Plain text fallback: remove only markdown symbols, preserve line breaks
      const plainText = markdown
        .replace(/[*_`#>~\-]+(?=\s|$)/gm, "") // remove markdown characters
        .replace(/\n{2,}/g, '\n\n') // preserve paragraph breaks
        .trim();

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
