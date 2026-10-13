import { useEffect, useRef, useState } from "react";
import { request } from "./use-article-session";
import type { ArticleSession } from "./use-article-session";
import type { ArticleSection, WorkspaceMode } from "./types";

interface PreviewResult {
  html: string;
  snapshot: string;
  section: ArticleSection;
}
export function useArticlePreview(session: ArticleSession) {
  const [mode, setMode] = useState<WorkspaceMode>("edit");
  const [result, setResult] = useState<PreviewResult | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const generation = useRef(0);
  const controller = useRef<AbortController | null>(null);
  const editScroll = useRef(0);
  const modeRef = useRef<WorkspaceMode>("edit");
  const snapshot = JSON.stringify(session.doc());
  const stale = Boolean(
    result && (result.snapshot !== snapshot || result.section !== session.tab),
  );
  const refresh = async () => {
    const data = session.doc();
    const section = session.tab;
    const captured = JSON.stringify(data);
    const current = ++generation.current;
    controller.current?.abort();
    const abort = new AbortController();
    controller.current = abort;
    setPending(true);
    setError("");
    try {
      const response = await request<{ html: string }>(
        "admin/blog-preview",
        "POST",
        { data, training: section === "training" },
        abort.signal,
      );
      if (current !== generation.current || modeRef.current !== "preview")
        return;
      setResult({ html: response.html, snapshot: captured, section });
    } catch (failure) {
      if (current === generation.current && !abort.signal.aborted)
        setError(
          failure instanceof Error
            ? failure.message
            : "Preview failed. Your edits are still here.",
        );
    } finally {
      if (current === generation.current) setPending(false);
    }
  };
  const changeMode = (next: WorkspaceMode) => {
    if (next === "edit") {
      generation.current++;
      controller.current?.abort();
      setPending(false);
      modeRef.current = next;
      setMode(next);
      requestAnimationFrame(() =>
        window.scrollTo({ top: editScroll.current, behavior: "instant" }),
      );
      return;
    }
    if (modeRef.current === "edit") editScroll.current = window.scrollY;
    modeRef.current = next;
    setMode(next);
    if (!result || stale) {
      setResult(null);
      void refresh();
    }
  };
  const changeSection = (section: ArticleSection) => {
    generation.current++;
    controller.current?.abort();
    setPending(false);
    setError("");
    setResult(null);
    modeRef.current = "edit";
    setMode("edit");
    session.switchSection(section);
  };
  useEffect(
    () => () => {
      generation.current++;
      controller.current?.abort();
    },
    [],
  );
  return {
    mode,
    result,
    pending,
    error,
    stale,
    refresh,
    changeMode,
    changeSection,
  };
}
export type ArticlePreview = ReturnType<typeof useArticlePreview>;
