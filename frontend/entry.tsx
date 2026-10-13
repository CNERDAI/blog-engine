import { adminPath } from './paths';
import { DerivativesPanel } from './workspace/derivatives-panel';
import {ArticleDate} from './workspace/article-date';
import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { Extension } from "@tiptap/core";
import type { Editor } from "@tiptap/core";
import { legacy, code, image, preset } from "./cnerd-nodes";
import { BlockInspector } from "./block-inspector";
import { SimpleEditor } from "./components/tiptap-templates/simple/simple-editor";
import { useArticleSession } from "./workspace/use-article-session";
import { useArticlePreview } from "./workspace/use-article-preview";
import { ArticleSettings } from "./workspace/article-settings";
import { ArticleTitle } from "./workspace/article-title";
import { ArticlePreview } from "./workspace/article-preview";
import { WorkspaceActions } from "./workspace/workspace-actions";
import { Drawer } from "./workspace/drawer";
import { ArticleOutline, useArticleOutline } from "./workspace/article-outline";
import type {
  ArticleRecord,
  WorkspaceHost,
  WorkspaceProps,
  OutlineEntry,
} from "./workspace/types";
import "./styles/_variables.scss";
import "./styles/_keyframe-animations.scss";
import "./editor.scss";

const ids = Extension.create({
  name: "cnerdIds",
  addGlobalAttributes() {
    return [
      {
        types: [
          "paragraph",
          "heading",
          "codeBlock",
          "image",
          "bulletList",
          "orderedList",
          "listItem",
          "taskList",
          "taskItem",
          "blockquote",
          "horizontalRule",
        ],
        attributes: { id: { default: null } },
      },
    ];
  },
});
function Workspace({ record, onBack, host }: WorkspaceProps) {
  const session = useArticleSession(record);
  const preview = useArticlePreview(session);
  const [settings, setSettings] = useState(false);
  const [derivatives, setDerivatives] = useState<"social" | "audio" | null>(null);
  const [outline, setOutline] = useState(false);
  const [wide, setWide] = useState(false);
  const [outlineHidden, setOutlineHidden] = useState(false);
  const [activeEditor, setActiveEditor] = useState<Editor | null>(null);
  const entries = useArticleOutline(activeEditor);
  const [block, setBlock] = useState<any>(null);
  const [blockExisting, setBlockExisting] = useState(false);
  const surface = useRef<HTMLDivElement>(null);
  const extensions = useMemo(
    () => [
      ids,
      code,
      image,
      legacy.configure({
        onEdit: (value: any) => {
          setBlock(structuredClone(value));
          setBlockExisting(true);
        },
      }),
    ],
    [],
  );
  useEffect(() => {
    const element = surface.current!;
    const measure = () => {
      const actions = element.querySelector(".cnerd-editor-actions")!;
      const tools = element.querySelector(".cnerd-toolbar-stack");
      host.style.setProperty(
        "--cnerd-actions-height",
        Math.ceil(actions.getBoundingClientRect().height) + "px",
      );
      host.style.setProperty(
        "--cnerd-tools-height",
        Math.ceil(tools?.getBoundingClientRect().height || 0) + "px",
      );
    };
    let measureFrame = 0;
    let widthFrame = 0;
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(measureFrame);
      measureFrame = requestAnimationFrame(measure);
    });
    const widthObserver = new ResizeObserver(() => {
      cancelAnimationFrame(widthFrame);
      widthFrame = requestAnimationFrame(() =>
        setWide(element.getBoundingClientRect().width >= 1100),
      );
    });
    widthObserver.observe(element);
    observer.observe(element.querySelector(".cnerd-editor-actions")!);
    const tools = element.querySelector(".cnerd-toolbar-stack");
    if (tools) observer.observe(tools);
    measure();
    host.blogCanLeave = session.leave;
    return () => {
      observer.disconnect();
      widthObserver.disconnect();
      cancelAnimationFrame(measureFrame);
      cancelAnimationFrame(widthFrame);
      delete host.blogCanLeave;
    };
  }, [host, session.tab]);
  const back = () => {
    if (session.leave()) {
      history.replaceState(null, "", adminPath());
      onBack();
    }
  };
  const navigate = (entry: OutlineEntry) => {
    setOutline(false);
    if (preview.mode !== "edit") preview.changeMode("edit");
    requestAnimationFrame(() => {
      const editor = session.editor.current;
      if (!editor || editor.isDestroyed) return;
      const node = editor.state.doc.nodeAt(entry.position);
      if (node?.isAtom) editor.commands.setNodeSelection(entry.position);
      else editor.commands.setTextSelection(entry.position + 1);
      editor.view.dom.focus({ preventScroll: true });
      editor.view.focus();
      const dom = editor.view.nodeDOM(entry.position) as HTMLElement | null;
      const code = dom?.matches(".cnerd-code")
        ? dom
        : dom?.querySelector(".cnerd-code");
      code?.dispatchEvent(new Event("cnerd-expand-code"));
      const actions =
        surface.current
          ?.querySelector(".cnerd-editor-actions")
          ?.getBoundingClientRect().height || 0;
      const tools =
        surface.current
          ?.querySelector(".cnerd-toolbar-stack")
          ?.getBoundingClientRect().height || 0;
      // Allow focus and code expansion to settle before measuring the target.
      requestAnimationFrame(() => {
        if (dom)
          window.scrollTo({
            top:
              dom.getBoundingClientRect().top +
              window.scrollY -
              actions -
              tools -
              16,
            behavior: "instant",
          });
      });
    });
  };
  const insert = (
    <div className="cnerd-insert">
      <label>
        Insert a block
        <select
          aria-label="Insert a block"
          value=""
          onChange={(event) => {
            if (event.target.value) {
              setBlock(preset(event.target.value));
              setBlockExisting(false);
            }
          }}
        >
          <option value="">Choose…</option>
          {[
            "image",
            "gallery",
            "video",
            "workflow",
            "prompt",
            "checklist",
            "callout",
            "table",
            "download",
          ].map((type) => (
            <option key={type} value={type}>
              {type[0].toUpperCase() + type.slice(1)}
            </option>
          ))}
        </select>
      </label>
      <span className="cnerd-private-note">AI-created drafts arrive through the configured Blog Engine skill.</span>
    </div>
  );
  return (
    <div ref={surface} className="cnerd-workspace">
      <WorkspaceActions
        session={session}
        mode={preview.mode}
        onBack={back}
        onDelete={async()=>{if(await session.remove()){history.replaceState(null,"",adminPath());onBack();}}}
        onSettings={() => setSettings(true)}
        onSocial={() => setDerivatives("social")}
        onAudio={() => setDerivatives("audio")}
        onOutline={() =>
          wide ? setOutlineHidden(!outlineHidden) : setOutline(true)
        }
        onMode={preview.changeMode}
      />
      <ArticleTitle
        value={session.data.title}
        onChange={(title) => session.mark({ title })}
      />
      <div className="cnerd-document-controls">
      <div
        className="cnerd-tabbar"
        role="tablist"
        aria-label="Article documents"
      >
        {(["content", "training"] as const).map((section) => (
          <button
            key={section}
            role="tab"
            aria-selected={session.tab === section}
            onClick={() => preview.changeSection(section)}
          >
            {section === "content" ? "Content" : "Private training"}
          </button>
        ))}
      </div>
      <ArticleDate session={session}/>
      </div>
      {session.tab === "training" && (
        <p className="cnerd-private-note">
          Private training is excluded from publishing, imports, and AI writing
          context.
        </p>
      )}
      <div
        className="cnerd-writing-layout"
        data-outline={wide && !outlineHidden && preview.mode === "edit"}
      >
        {wide && !outlineHidden && preview.mode === "edit" && (
          <ArticleOutline entries={entries} onNavigate={navigate} />
        )}
        <div hidden={preview.mode !== "edit"} className="cnerd-edit-surface">
          <SimpleEditor
            key={session.tab}
            initialContent={
              session.data[
                session.tab === "content" ? "bodyDoc" : "trainingDoc"
              ]
            }
            onUpdate={(body: any) =>
              session.mark({
                [session.tab === "content" ? "bodyDoc" : "trainingDoc"]: body,
              })
            }
            onReady={(editor: Editor) => {
              session.editor.current = editor;
              setActiveEditor(editor);
            }}
            upload={session.upload}
            extraExtensions={extensions}
            extraToolbar={insert}
            onError={(error: Error) => session.setStatus(error.message)}
          />
        </div>
        {preview.mode === "preview" && (
          <ArticlePreview
            preview={preview}
            section={session.tab}
            onStatus={session.setStatus}
          />
        )}
      </div>
      {derivatives && <Drawer title={derivatives === "social" ? "Social" : "Audio"} onClose={() => setDerivatives(null)}><DerivativesPanel kind={derivatives} session={session} /></Drawer>}
      {settings && (
        <Drawer title="Article settings" onClose={() => setSettings(false)}>
          <ArticleSettings session={session} />
        </Drawer>
      )}
      {outline && (
        <Drawer title="Article outline" onClose={() => setOutline(false)}>
          <ArticleOutline entries={entries} onNavigate={navigate} />
        </Drawer>
      )}
      {block && (
        <BlockInspector
          initial={block}
          upload={(file: File, field: string) => {
            if (
              block.type === "video" &&
              field === "src" &&
              file.type !== "video/mp4"
            )
              throw new Error("Choose an MP4 file or enter a YouTube URL.");
            return session.upload(file, field);
          }}
          onClose={() => setBlock(null)}
          onApply={(value: any) => {
            const editor = session.editor.current;
            if (!editor) return;
            if (blockExisting) {
              let found: number | undefined;
              editor.state.doc.descendants((node, position) => {
                if (
                  node.type.name === "cnerdBlock" &&
                  node.attrs.id === value.id
                )
                  found = position;
              });
              if (found === undefined) {
                session.setStatus(
                  "This block changed. Reopen it before applying.",
                );
                return;
              }
              editor.commands.command(({ tr, dispatch }) => {
                if (dispatch)
                  dispatch(
                    tr.setNodeMarkup(found!, undefined, {
                      id: value.id,
                      block: value,
                    }),
                  );
                return true;
              });
            } else
              editor
                .chain()
                .focus()
                .insertContent({
                  type: "cnerdBlock",
                  attrs: { id: value.id, block: value },
                })
                .run();
            setBlock(null);
          }}
        />
      )}
    </div>
  );
}
export function mountBlog(
  host: WorkspaceHost,
  record: ArticleRecord | null,
  { onBack }: { onBack: () => void },
) {
  const root = createRoot(host);
  root.render(
    <Workspace
      host={host}
      record={record}
      onBack={() => {
        root.unmount();
        delete host.blogCleanup;
        onBack();
      }}
    />,
  );
  return () => root.unmount();
}
