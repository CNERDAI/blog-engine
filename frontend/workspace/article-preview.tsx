import { privatePreviewHtml } from "../paths";
import React from "react";
import { copyCode } from "../cnerd-nodes";
import type { ArticlePreview as PreviewState } from "./use-article-preview";
import type { ArticleSection } from "./types";
export function ArticlePreview({
  preview,
  section,
  onStatus,
}: {
  preview: PreviewState;
  section: ArticleSection;
  onStatus: (status: string) => void;
}) {
  return (
    <section
      className="cnerd-preview"
      aria-label={
        section === "content" ? "Content preview" : "Private training preview"
      }
    >
      <header className="cnerd-preview-heading">
        <strong>
          {section === "content"
            ? "Content preview"
            : "Private training preview"}
        </strong>
        <span>Includes unsaved changes. Preview does not save or publish.</span>
        <button onClick={() => preview.changeMode("edit")}>
          Return to Edit
        </button>
        <button disabled={preview.pending} onClick={preview.refresh}>
          Refresh preview
        </button>
      </header>
      <p role="status">
        {preview.pending
          ? "Preparing preview…"
          : preview.stale
            ? "Preview needs updating"
            : ""}
      </p>
      {preview.error && (
        <div role="alert">
          <p>{preview.error}</p>
          <button onClick={preview.refresh}>Retry preview</button>
        </div>
      )}
      {preview.result?.section === section && (
        <div
          onClick={(event) => {
            const button = (event.target as HTMLElement).closest(".code-copy");
            if (button)
              void copyCode(
                button.parentElement?.querySelector("code")?.textContent || "",
                onStatus,
              );
          }}
          dangerouslySetInnerHTML={{ __html: privatePreviewHtml(preview.result.html) }}
        />
      )}
    </section>
  );
}
