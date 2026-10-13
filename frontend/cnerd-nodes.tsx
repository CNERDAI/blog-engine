import { privateAssetPath, privatePreviewHtml } from "./paths";
import React, { useEffect, useRef, useState } from "react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import type { NodeViewProps } from "@tiptap/react";
import { closeHistory } from "@tiptap/pm/history";
import { Node } from "@tiptap/core";
import Image from "@tiptap/extension-image";
import CodeBlockLowlight from "@tiptap/extension-code-block-lowlight";
import {
  NodeViewWrapper,
  NodeViewContent,
  ReactNodeViewRenderer,
} from "@tiptap/react";
import {
  renderBlock,
  copyIcon,
} from "../src/blog-document.mjs";
import { lowlight } from "../src/code-highlight.mjs";
export const id = () =>
  "b_" + crypto.randomUUID().replace(/-/g, "").slice(0, 16);
export const privateMedia = privatePreviewHtml;
export async function copyCode(text: string, set: (s: string) => void) {
  try {
    await navigator.clipboard.writeText(text);
    set("Copied");
    setTimeout(() => set(""), 2500);
  } catch {
    set("Copy failed. Select the code and copy it manually.");
  }
}
function CodeView({
  node,
  updateAttributes,
  editor,
  getPos,
  selected,
}: NodeViewProps) {
  const [feedback, setFeedback] = useState("");
  const [expanded, setExpanded] = useState(false);
  const wrapper = useRef<HTMLDivElement>(null);
  const long = node.textContent.split("\n").length > 20;
  useEffect(() => {
    const element = wrapper.current;
    const expand = () => setExpanded(true);
    const selection = () => {
      const position = getPos();
      if (
        typeof position === "number" &&
        editor.state.selection.from > position &&
        editor.state.selection.from < position + node.nodeSize
      )
        expand();
    };
    element?.addEventListener("cnerd-expand-code", expand);
    editor.on("selectionUpdate", selection);
    if (selected) expand();
    return () => {
      element?.removeEventListener("cnerd-expand-code", expand);
      editor.off("selectionUpdate", selection);
    };
  }, [editor, getPos, node.nodeSize, selected]);
  const collapsed = long && !expanded;
  return (
    <NodeViewWrapper
      ref={wrapper}
      className={"cnerd-code" + (collapsed ? " collapsed" : "")}
      onFocusCapture={(event) => {
        if ((event.target as HTMLElement).closest("pre")) setExpanded(true);
      }}
    >
      <div contentEditable={false} className="code-toolbar">
        <select
          aria-label="Code language"
          value={node.attrs.language || "plaintext"}
          onChange={(event) =>
            updateAttributes({ language: event.target.value })
          }
        >
          {[
            "plaintext",
            "bash",
            "javascript",
            "typescript",
            "python",
            "json",
            "html",
            "css",
            "sql",
            "auto",
          ].map((language) => (
            <option key={language}>{language}</option>
          ))}
        </select>
        {long && (
          <button
            className="code-expand"
            aria-expanded={!collapsed}
            onClick={() => setExpanded(!expanded)}
          >
            {collapsed ? "Expand code" : "Collapse code"}
          </button>
        )}
        <button
          className="code-copy"
          aria-label="Copy code"
          title="Copy code"
          onClick={() => copyCode(node.textContent, setFeedback)}
          dangerouslySetInnerHTML={{ __html: copyIcon }}
        />
      </div>
      <pre>
        <NodeViewContent as="code" style={{ whiteSpace: "pre" }} />
      </pre>
      {collapsed && (
        <span contentEditable={false} className="code-collapse-note">
          Showing 12 lines · Copy includes all{" "}
          {node.textContent.split("\n").length} lines
        </span>
      )}
      <span
        contentEditable={false}
        className="code-feedback"
        role="status"
        aria-live="polite"
      >
        {feedback}
      </span>
    </NodeViewWrapper>
  );
}
export const code = CodeBlockLowlight.extend({
  addNodeView() {
    return ReactNodeViewRenderer(CodeView);
  },
}).configure({ lowlight, defaultLanguage: "plaintext" });
function ImageView({ node, selected, updateAttributes }: any) {
  const [editing, setEditing] = useState(false),
    [alt, setAlt] = useState(node.attrs.alt || ""),
    [caption, setCaption] = useState(node.attrs.title || ""),
    [decorative, setDecorative] = useState(Boolean(node.attrs.decorative));
  return (
    <NodeViewWrapper
      className={selected ? "image-node selected" : "image-node"}
    >
      <img src={privateAssetPath(node.attrs.src)} alt={node.attrs.alt || ""} />
      {node.attrs.title && <p>{node.attrs.title}</p>}
      <div contentEditable={false} className="image-controls">
        <button onClick={() => setEditing(!editing)}>Edit image details</button>
        {editing && (
          <div>
            <label>
              Alternative text
              <input value={alt} onChange={(e) => setAlt(e.target.value)} />
            </label>
            <label className="check-label"><input type="checkbox" checked={decorative} onChange={e => setDecorative(e.target.checked)} />Decorative image (no description needed)</label>
            <label>
              Caption
              <input
                value={caption}
                onChange={(e) => setCaption(e.target.value)}
              />
            </label>
            <button
              onClick={() => {
                updateAttributes({ alt: decorative ? "" : alt, title: caption, decorative });
                setEditing(false);
              }}
            >
              Apply image details
            </button>
          </div>
        )}
      </div>
    </NodeViewWrapper>
  );
}
export const image = Image.extend({
  addAttributes() {
    return { ...this.parent?.(), decorative: { default: false }, width: { default: null }, height: { default: null } };
  },
  addNodeView() {
    return ReactNodeViewRenderer(ImageView);
  },
});
function BlockView({
  node,
  editor,
  getPos,
  extension,
  deleteNode,
  selected,
}: NodeViewProps) {
  const position = getPos();
  const resolved =
    typeof position === "number" ? editor.state.doc.resolve(position) : null;
  const index = resolved?.index() || 0;
  const [bounds, setBounds] = useState({
    first: index === 0,
    last: !resolved || index === resolved.parent.childCount - 1,
  });
  const move = (direction: number) =>
    editor.commands.command(({ tr, dispatch }) => {
      const pos = getPos();
      if (typeof pos !== "number") return false;
      const parent = tr.doc.resolve(pos),
        current = parent.index();
      if (
        (direction < 0 && current === 0) ||
        (direction > 0 && current === parent.parent.childCount - 1)
      )
        return false;
      const neighbour = parent.parent.child(current + direction);
      const target =
        direction < 0 ? pos - neighbour.nodeSize : pos + neighbour.nodeSize;
      if (dispatch)
        dispatch(
          closeHistory(tr)
            .delete(pos, pos + node.nodeSize)
            .insert(target, node),
        );
      return true;
    });
  const duplicate = () => {
    const pos = getPos();
    if (typeof pos !== "number") return;
    const block = structuredClone(node.attrs.block);
    block.id = id();
    if (block.steps)
      block.steps.forEach((step: { id: string }) => {
        step.id = id();
      });
    editor
      .chain()
      .command(({ tr }) => {
        closeHistory(tr);
        return true;
      })
      .insertContentAt(pos + node.nodeSize, {
        type: "cnerdBlock",
        attrs: { id: block.id, block },
      })
      .run();
  };
  return (
    <NodeViewWrapper
      data-block-id={node.attrs.id}
      className={"cnerd-node" + (selected ? " selected" : "")}
      contentEditable={false}
    >
      <div className="block-actions">
        <span>{node.attrs.block.type}</span>
        <button
          className="block-edit"
          onClick={() => extension.options.onEdit(node.attrs.block)}
          aria-label={"Edit " + node.attrs.block.type}
        >
          Edit
        </button>
        <DropdownMenu.Root
          onOpenChange={(open) => {
            if (!open) return;
            const position = getPos();
            if (typeof position !== "number") return;
            const parent = editor.state.doc.resolve(position);
            setBounds({
              first: parent.index() === 0,
              last: parent.index() === parent.parent.childCount - 1,
            });
          }}
        >
          <DropdownMenu.Trigger asChild>
            <button aria-label={node.attrs.block.type + " block actions"}>
              Actions ▾
            </button>
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content
              className="block-menu"
              sideOffset={5}
              align="end"
            >
              <DropdownMenu.Item
                disabled={bounds.first}
                onSelect={() => move(-1)}
              >
                Move block up
              </DropdownMenu.Item>
              <DropdownMenu.Item
                disabled={bounds.last}
                onSelect={() => move(1)}
              >
                Move block down
              </DropdownMenu.Item>
              <DropdownMenu.Item onSelect={duplicate}>
                Duplicate
              </DropdownMenu.Item>
              <DropdownMenu.Separator />
              <DropdownMenu.Item
                className="danger"
                onSelect={() => {
                  const pos = getPos();
                  if (typeof pos === "number")
                    editor
                      .chain()
                      .command(({ tr }) => {
                        closeHistory(tr);
                        return true;
                      })
                      .deleteRange({ from: pos, to: pos + node.nodeSize })
                      .run();
                }}
              >
                Delete block
              </DropdownMenu.Item>
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
      </div>
      <div
        dangerouslySetInnerHTML={{
          __html: privateMedia(renderBlock(node.attrs.block, 0)),
        }}
        onClick={(event) => {
          const button = (event.target as HTMLElement).closest(
            "[data-copy]",
          ) as HTMLElement;
          if (button) void copyCode(button.dataset.copy || "", () => {});
        }}
      />
    </NodeViewWrapper>
  );
}
export const legacy = Node.create({
  name: "cnerdBlock",
  group: "block",
  atom: true,
  draggable: true,
  addOptions() {
    return { onEdit: () => {} };
  },
  addAttributes() {
    return { id: { default: null }, block: { default: null } };
  },
  parseHTML() {
    return [{ tag: "div[data-cnerd-block]" }];
  },
  renderHTML() {
    return ["div", { "data-cnerd-block": "true" }];
  },
  addNodeView() {
    return ReactNodeViewRenderer(BlockView);
  },
});
export const preset = (type: string): any => {
  const base = { id: id(), type };
  return {
    ...base,
    ...(
      {
        image: { src: "", alt: "", decorative: false, caption: "" },
        gallery: { images: [{ src: "", alt: "", decorative: false, caption: "" }] },
        video: { src: "", alt: "Video title", caption: "" },
        prompt: { title: "Prompt", content: "" },
        workflow: {
          outcome: "",
          prerequisites: [],
          tools: [],
          steps: [
            {
              id: id(),
              title: "",
              instructions: "",
              prompt: "",
              image: "",
              imageAlt: "",
              imageDecorative: false,
              expected: "",
              review: true,
            },
          ],
        },
        checklist: { title: "Checklist", items: [{ label: "", details: "" }] },
        callout: { title: "A useful note", tone: "note", body: "" },
        table: { headings: ["Column 1", "Column 2"], rows: [["", ""]] },
        download: { label: "Download file", description: "", href: "" },
      } as any
    )[type],
  };
};
