import React, { useEffect, useState } from "react";
import type { Editor } from "@tiptap/core";
import type { OutlineEntry } from "./types";

export function useArticleOutline(editor: Editor | null) {
  const [entries, setEntries] = useState<OutlineEntry[]>([]);
  useEffect(() => {
    if (!editor || editor.isDestroyed) {
      setEntries([]);
      return;
    }
    const update = () => {
      const next: OutlineEntry[] = [];
      editor.state.doc.descendants((node, position) => {
        let label = "",
          level = 0;
        if (node.type.name === "heading") {
          label = node.textContent || "Untitled heading";
          level = node.attrs.level;
        }
        if (node.type.name === "codeBlock")
          label = "Code · " + (node.attrs.language || "plaintext");
        if (node.type.name === "image")
          label = node.attrs.title || node.attrs.alt || "Image";
        if (node.type.name === "cnerdBlock") {
          const block = node.attrs.block;
          label =
            block.title ||
            block.outcome ||
            block.label ||
            block.caption ||
            block.alt ||
            block.type;
        }
        if (label) next.push({ position, label, level, kind: node.type.name });
      });
      setEntries(next);
    };
    update();
    editor.on("transaction", update);
    return () => {
      editor.off("transaction", update);
    };
  }, [editor]);
  return entries;
}
export function ArticleOutline({
  entries,
  onNavigate,
}: {
  entries: OutlineEntry[];
  onNavigate: (entry: OutlineEntry) => void;
}) {
  return (
    <nav className="cnerd-outline" aria-label="Article outline">
      <h2>Article outline</h2>
      {entries.length ? (
        <ol>
          {entries.map((entry) => (
            <li key={entry.position} data-level={entry.level}>
              <button onClick={() => onNavigate(entry)} title={entry.label}>
                {entry.label}
              </button>
            </li>
          ))}
        </ol>
      ) : (
        <p>Add headings or blocks to navigate your article.</p>
      )}
    </nav>
  );
}
