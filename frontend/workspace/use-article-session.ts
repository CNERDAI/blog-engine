import { deleteArticle } from './delete-article';
import { apiPath, adminPath, engineConfig } from '../paths';
import { useEffect, useRef, useState } from "react";
import type { Editor } from "@tiptap/core";
import { toDocument } from "../../src/blog-document.mjs";
import type { ArticleDraft, ArticleRecord, ArticleSection } from "./types";

export async function request<T>(
  path: string,
  method = "GET",
  data?: unknown,
  signal?: AbortSignal,
): Promise<T> {
  const response = await fetch(apiPath(path), {
    method,
    signal,
    headers: data ? { "Content-Type": "application/json" } : {},
    body: data ? JSON.stringify(data) : undefined,
  });
  const value = await response.json();
  if (!response.ok)
    throw Object.assign(new Error(
      response.status === 401
        ? "Session expired. Your edits are still here. Sign in in another tab, then retry."
        : value.error || "Request failed.",
    ), { status: response.status });
  return value;
}

const slugify = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 90);

export function useArticleSession(record: ArticleRecord | null) {
  const original = record?.draft || {
    title: "",
    summary: "",
    author: engineConfig().defaultAuthor || "",
    heroAlt: "",
    topics: [],
    slug: "",
    heroImage: "",
    seoTitle: "",
    seoDescription: "",
    blocks: [],
    training: [],
  };
  const [data, setData] = useState<ArticleDraft>(() => ({
    ...original,
    schemaVersion: 2,
    bodyDoc: toDocument(original),
    trainingDoc: toDocument(original, true),
  }));
  const dateError=useRef("");
  const dataRef = useRef(data);
  const saved = useRef(record);
  const editor = useRef<Editor | null>(null);
  const [tab, setTab] = useState<ArticleSection>("content");
  const sectionRef = useRef<ArticleSection>(tab);
  const [dirty, setDirty] = useState(false);
  const dirtyRef = useRef(false);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [status, setStatus] = useState(
    "Drafts stay private until you publish.",
  );

  const mark = (patch: Partial<ArticleDraft>) => {
    dataRef.current = { ...dataRef.current, ...patch };
    setData(dataRef.current);
    dirtyRef.current = true;
    setDirty(true);
    if (!busyRef.current) setStatus("Unsaved changes");
  };
  const doc = (): ArticleDraft => ({
    ...dataRef.current,
    slug: dataRef.current.slug || slugify(dataRef.current.title),
    [sectionRef.current === "content" ? "bodyDoc" : "trainingDoc"]:
      editor.current?.getJSON() ||
      dataRef.current[
        sectionRef.current === "content" ? "bodyDoc" : "trainingDoc"
      ],
  });
  const switchSection = (section: ArticleSection) => {
    if (section === sectionRef.current) return;
    dataRef.current = doc();
    setData(dataRef.current);
    editor.current = null;
    sectionRef.current = section;
    setTab(section);
  };
  const persist = async () => {
    if(dateError.current)throw new Error(dateError.current);
    const value = doc();
    const before = JSON.stringify(value);
    const result = await request<ArticleRecord>(
      "admin/blog/" + (saved.current?.slug || value.slug),
      "PUT",
      {
        data: value,
        revision: saved.current?.revision || 0,
      },
    );
    saved.current = result;
    if (JSON.stringify(doc()) === before) {
      dataRef.current = result.draft;
      setData(result.draft);
      dirtyRef.current = false;
      setDirty(false);
    } else {
      mark({ slug: result.slug });
    }
    history.replaceState(null, "", adminPath(result.id));
    return result;
  };
  const run = async (action: () => Promise<unknown>, pending = "") => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    if (pending) setStatus(pending);
    try {
      return await action();
    } catch (error) {
      setStatus(
        error instanceof Error
          ? error.message
          : "Request failed. Your edits are still here.",
      );
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };
  const save = () =>
    run(async () => {
      await persist();
      setStatus(
        dirtyRef.current
          ? "Saved earlier edits. Newer edits remain unsaved."
          : "Draft saved.",
      );
    }, "Saving draft…");
  const publish = () => {
    if (
      busyRef.current ||
      !confirm(
        "Publish this article to the public website? Private training stays private.",
      )
    )
      return;
    return run(async () => {
      const result = await persist();
      saved.current = await request<ArticleRecord>(
        "admin/blog/" + result.slug + "/publish",
        "POST",
        { revision: result.revision },
      );
      setStatus(
        (dirtyRef.current
          ? "Saved version published. Newer edits remain unsaved."
          : "Published. ") + (saved.current.checks?.warnings || []).join(" "),
      );
    }, "Publishing saved draft…");
  };
  const recover = () => {
    const value = doc();
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(value, null, 2)], { type: "application/json" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = (value.slug || "article") + "-recovery.json";
    a.click();
    URL.revokeObjectURL(url);
  };
  const restore = () =>
    run(async () => {
      if (!saved.current) return;
      const revisions = await request<
        Array<{ id: number; action: string; created_at: string }>
      >("admin/blog/" + saved.current.slug + "/revisions");
      const chosen = prompt(
        "Restore a revision to the private draft only:\n" +
          revisions
            .map((r) => `${r.id} · ${r.action} · ${r.created_at}`)
            .join("\n"),
      );
      if (!chosen) return;
      if (
        dirtyRef.current &&
        !confirm(
          "Replace your unsaved edits with this revision? Download a recovery copy first if needed.",
        )
      )
        return;
      const result = await request<ArticleRecord>(
        "admin/blog/" + saved.current.slug + "/restore",
        "POST",
        {
          id: Number(chosen),
          revision: saved.current.revision,
        },
      );
      saved.current = result;
      dataRef.current = {
        ...result.draft,
        schemaVersion: 2,
        bodyDoc: toDocument(result.draft),
        trainingDoc: toDocument(result.draft, true),
      };
      setData(dataRef.current);
      editor.current?.commands.setContent(
        dataRef.current[
          sectionRef.current === "content" ? "bodyDoc" : "trainingDoc"
        ],
        { emitUpdate: false },
      );
      dirtyRef.current = false;
      setDirty(false);
      setStatus("Revision restored to draft. Published content is unchanged.");
    });
  const upload = async (file: File, field = "src", publicImage=false) => {
    if (!saved.current) await persist();
    const response = await fetch(
      apiPath("admin/blog/" + saved.current!.slug + "/assets"),
      {
        method: "POST",
        headers: {
          "Content-Type": "application/octet-stream",
          "X-Blog-Asset-Kind":
            field === "href"
              ? "download"
              : file.type === "video/mp4"
                ? "video"
                : "image",
          "X-Blog-Asset-Visibility":
            publicImage || sectionRef.current === "content" ? "public" : "training",
          "X-Blog-Asset-Name": encodeURIComponent(file.name),
        },
        body: file,
      },
    );
    const asset = await response.json();
    if (!response.ok) throw new Error(asset.error || "Upload failed");
    return asset.path as string;
  };
  const remove=()=>run(async()=>{if(!saved.current)return false;const removed=await deleteArticle(saved.current);if(removed){dirtyRef.current=false;setDirty(false);}return removed;});
  const leave = () =>
    !dirtyRef.current ||
    confirm(
      "Leave this article and discard unsaved changes? Download a recovery copy first if you need it.",
    );
  useEffect(() => {
    const warning = (event: BeforeUnloadEvent) => {
      if (dirtyRef.current) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", warning);
    return () => window.removeEventListener("beforeunload", warning);
  }, []);
  return {
    data,
    dateError,
    remove,
    saved,
    editor,
    tab,
    dirty,
    dirtyRef,
    busy,
    status,
    setStatus,
    mark,
    doc,
    switchSection,
    persist,
    run,
    save,
    publish,
    recover,
    restore,
    upload,
    leave,
  };
}
export type ArticleSession = ReturnType<typeof useArticleSession>;
