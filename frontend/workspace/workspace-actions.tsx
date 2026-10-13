import React from "react";
import { engineConfig } from "../paths";
import type { ArticleSession } from "./use-article-session";
import type { WorkspaceMode } from "./types";

interface Props {
  session: ArticleSession;
  mode: WorkspaceMode;
  onBack: () => void;
  onDelete: () => void;
  onSettings: () => void;
  onOutline: () => void;
  onSocial: () => void;
  onAudio: () => void;
  onLibrary: () => void;
  onMode: (mode: WorkspaceMode) => void;
}
export function WorkspaceActions({
  session,
  mode,
  onBack,
  onDelete,
  onSettings,
  onOutline,
  onSocial,
  onAudio,
  onLibrary,
  onMode,
}: Props) {
  const { saved, dirty, busy, status } = session;
  const state =
    saved.current?.state === "published"
      ? "Published"
      : saved.current?.state === "archived"
        ? "Archived"
        : "Draft";
  return (
    <header className="cnerd-editor-actions">
      <div className="cnerd-action-navigation">
        <button onClick={onBack}>← Articles</button>
        <div
          className="cnerd-mode-switch"
          role="group"
          aria-label="Workspace view"
        >
          <button aria-pressed={mode === "edit"} onClick={() => onMode("edit")}>
            Write
          </button>
          <button
            aria-pressed={mode === "preview"}
            onClick={() => onMode("preview")}
          >
            Preview
          </button>
        </div>
      </div>
      <div className="cnerd-save-state">
        <span className="draft-status">
          {engineConfig().name} · {state} · Revision {saved.current?.revision || 0}
          {dirty
            ? " · Unsaved changes"
            : saved.current?.hasUnpublished
              ? " · Unpublished changes"
              : ""}
        </span>
        <p className="form-status" role="status" aria-live="polite">
          {status}
          {status.includes("Session expired") && (
            <>
              {" "}
              <a href={location.href} target="_blank" rel="noreferrer">
                Sign in again ↗
              </a>
            </>
          )}
        </p>
      </div>
      <div className="cnerd-actions">
        <button onClick={onOutline}>Outline</button>
        <button onClick={onSettings}>Article settings</button>
        <button onClick={onSocial}>Social</button>
        <button onClick={onAudio}>Audio</button>
        <button onClick={onLibrary} disabled={session.tab!=='content'} title={session.tab!=='content'?'Switch to Content to insert public images.':'Browse and insert images'}>Media library</button>
        {engineConfig().brandId==='cnerd'&&<a href="/admin" target="_blank" rel="noopener noreferrer">Website Admin ↗</a>}
        <button
          className="button outline small"
          disabled={busy}
          onClick={session.save}
        >
          Save Draft
        </button>
        <button
          className="button dark small"
          disabled={busy}
          onClick={session.publish}
        >
          Publish
        </button>
        <button className="button outline danger small cnerd-delete-article" disabled={busy||!saved.current} onClick={onDelete}>Delete article</button>
      </div>
    </header>
  );
}
