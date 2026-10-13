import { apiPath } from "./paths";
import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { renderNode, renderBlock } from "../src/blog-document.mjs";
export function AIWriting({
  editor,
  disabled,
  data,
  onMetadata,
  onStatus,
}: any) {
  const trigger = useRef<HTMLElement>(null);
  const [panelHost, setPanelHost] = useState<Element | null>(null);
  useEffect(() => {
    setPanelHost(
      trigger.current
        ?.closest(".simple-editor-wrapper")
        ?.querySelector(".cnerd-tools-panel") || null,
    );
  }, []);
  const [open, setOpen] = useState(false),
    [action, setAction] = useState("improve"),
    [instructions, setInstructions] = useState(""),
    [pending, setPending] = useState(false),
    [suggestion, setSuggestion] = useState<any>(null),
    [error, setError] = useState("");
  const controller = useRef<AbortController | null>(null);
  const captured = useRef<any>(null);
  const [undoMetadata, setUndoMetadata] = useState<any>(null);
  useEffect(() => () => controller.current?.abort(), []);
  const ask = async () => {
    const e = editor.current;
    if (!e) return;
    captured.current = {
      editor: e,
      json: JSON.stringify(e.getJSON()),
      from: e.state.selection.from,
      to: e.state.selection.to,
      title: data.title,
      summary: data.summary,
    };
    controller.current = new AbortController();
    setPending(true);
    setError("");
    setSuggestion(null);
    try {
      const response = await fetch(apiPath("admin/blog-ai/write"), {
        method: "POST",
        signal: controller.current.signal,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          instructions,
          selection: e.state.doc.textBetween(
            captured.current.from,
            captured.current.to,
            "\n",
          ),
          bodyDoc: e.getJSON(),
        }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "AI request failed.");
      setSuggestion(result);
    } catch (error: any) {
      setError(
        error.name === "AbortError"
          ? "Canceled. A request already sent may still incur a reserved charge."
          : error.message,
      );
    } finally {
      setPending(false);
    }
  };
  const accept = () => {
    const e = editor.current,
      c = captured.current;
    if (
      !e ||
      e !== c.editor ||
      JSON.stringify(e.getJSON()) !== c.json ||
      data.title !== c.title ||
      data.summary !== c.summary
    ) {
      setError(
        "The article changed while AI was working. Discard this suggestion and request a new one.",
      );
      return;
    }
    if (action === "titles") {
      setUndoMetadata({
        before: { title: data.title, summary: data.summary },
        after: { title: suggestion.title, summary: suggestion.summary },
      });
      onMetadata({ title: suggestion.title, summary: suggestion.summary });
    } else {
      const selection = c.to > c.from,
        replace =
          !selection &&
          ["draft", "improve", "shorten", "expand"].includes(action),
        range = selection
          ? { from: c.from, to: c.to }
          : replace
            ? { from: 0, to: e.state.doc.content.size }
            : e.state.doc.content.size;
      e.chain()
        .focus()
        .insertContentAt(range, suggestion.bodyDoc.content)
        .run();
    }
    setSuggestion(null);
    onStatus("AI suggestion accepted. Review it, then save your draft.");
  };
  return (
    <section ref={trigger} className="cnerd-ai">
      <button
        disabled={disabled}
        onClick={() => setOpen(!open)}
        aria-expanded={open}
      >
        ✦ AI writing
      </button>
      {open &&
        panelHost &&
        createPortal(
          <div className="cnerd-ai-panel">
            <p>
              Suggestions need your review. AI uses Content only and never
              publishes.
            </p>
            <label>
              Writing action
              <select
                value={action}
                disabled={pending || Boolean(suggestion)}
                onChange={(e) => setAction(e.target.value)}
              >
                {[
                  "outline",
                  "draft",
                  "improve",
                  "shorten",
                  "expand",
                  "workflow",
                  "prompt",
                  "code",
                  "titles",
                ].map((a) => (
                  <option key={a}>{a}</option>
                ))}
              </select>
            </label>
            <label>
              Instructions
              <textarea
                maxLength={2000}
                value={instructions}
                onChange={(e) => setInstructions(e.target.value)}
                placeholder="What should the writing help with?"
              />
            </label>
            <div className="ai-actions">
              <button disabled={pending || Boolean(suggestion)} onClick={ask}>
                Generate suggestion
              </button>
              {pending && (
                <button onClick={() => controller.current?.abort()}>
                  Cancel
                </button>
              )}
              {undoMetadata &&
                data.title === undoMetadata.after.title &&
                data.summary === undoMetadata.after.summary && (
                  <button
                    onClick={() => {
                      onMetadata(undoMetadata.before);
                      setUndoMetadata(null);
                    }}
                  >
                    Undo title and summary change
                  </button>
                )}
            </div>
            <p role="status">{pending ? "Writing…" : error}</p>
            {suggestion && (
              <div className="ai-suggestion">
                <h3>{suggestion.title}</h3>
                <p>{suggestion.summary}</p>
                <div
                  dangerouslySetInnerHTML={{
                    __html: renderNode(suggestion.bodyDoc, renderBlock),
                  }}
                />
                <p>
                  Budget remaining: ${suggestion.usage.remaining.toFixed(4)}{" "}
                  this month.
                </p>
                <div className="ai-actions">
                  <button className="button dark small" onClick={accept}>
                    Accept
                  </button>
                  <button
                    onClick={() => {
                      setSuggestion(null);
                      setError("");
                    }}
                  >
                    Discard
                  </button>
                </div>
              </div>
            )}
          </div>,
          panelHost,
        )}
    </section>
  );
}
