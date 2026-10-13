import type { Editor, JSONContent } from "@tiptap/core";

export type ArticleSection = "content" | "training";
export type WorkspaceMode = "edit" | "preview";
export interface ArticleDraft {
  schemaVersion: 2;
  publishedAt?: string | null;
  title: string;
  summary: string;
  author: string;
  topics: string[];
  slug: string;
  heroImage: string;
  heroAlt?: string;
  heroDecorative?: boolean;
  socialImage?: string;
  socialImageAlt?: string;
  focalPoint?: { x: number; y: number };
  seoTitle: string;
  seoDescription: string;
  bodyDoc: JSONContent;
  trainingDoc: JSONContent;
}
export interface ArticleRecord {
  id: string;
  slug: string;
  revision: number;
  state: "draft" | "published" | "archived";
  draft: ArticleDraft;
  hasUnpublished?: boolean;
  checks?: { warnings?: string[] };
}
export interface WorkspaceHost extends HTMLElement {
  blogCanLeave?: () => boolean;
  blogCleanup?: () => void;
}
export interface WorkspaceProps {
  record: ArticleRecord | null;
  onBack: () => void;
  host: WorkspaceHost;
}
export interface OutlineEntry {
  position: number;
  label: string;
  kind: string;
  level: number;
}
export type EditorHandle = { current: Editor | null };
