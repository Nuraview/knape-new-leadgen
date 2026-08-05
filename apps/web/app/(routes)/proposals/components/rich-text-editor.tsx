"use client";

import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Link from "@tiptap/extension-link";
import Underline from "@tiptap/extension-underline";
import {
  Bold,
  Italic,
  Underline as UnderlineIcon,
  Link as LinkIcon,
  List,
  Heading2,
} from "lucide-react";
import { Button } from "@/components/ui/button";

type Props = {
  content?: string; // HTML string
  placeholder?: string;
  onChange?: (html: string, json: object) => void;
};

/**
 * Compact WYSIWYG for proposal sections. Adapted from the campaigns TipTap
 * editor but without the merge-tag footer. Emits HTML (stored on bodyHtml) and
 * JSON (stored on bodyJson). The public viewer renders the HTML sanitized.
 */
export function RichTextEditor({ content, placeholder, onChange }: Props) {
  const editor = useEditor({
    extensions: [StarterKit, Underline, Link.configure({ openOnClick: false })],
    content: content ?? "",
    immediatelyRender: false,
    editorProps: {
      attributes: { class: "prose prose-sm max-w-none min-h-[140px] focus:outline-none" },
    },
    onUpdate({ editor }) {
      onChange?.(editor.getHTML(), editor.getJSON() as object);
    },
  });

  if (!editor) return null;

  const btn = (active: boolean) =>
    `h-8 w-8 p-0 ${active ? "bg-muted" : ""}`;

  return (
    <div className="border rounded-md overflow-hidden bg-background">
      <div className="flex gap-0.5 p-1.5 border-b bg-muted/40 flex-wrap">
        <Button type="button" variant="ghost" size="sm" className={btn(editor.isActive("bold"))}
          onClick={() => editor.chain().focus().toggleBold().run()}>
          <Bold className="h-4 w-4" />
        </Button>
        <Button type="button" variant="ghost" size="sm" className={btn(editor.isActive("italic"))}
          onClick={() => editor.chain().focus().toggleItalic().run()}>
          <Italic className="h-4 w-4" />
        </Button>
        <Button type="button" variant="ghost" size="sm" className={btn(editor.isActive("underline"))}
          onClick={() => editor.chain().focus().toggleUnderline().run()}>
          <UnderlineIcon className="h-4 w-4" />
        </Button>
        <Button type="button" variant="ghost" size="sm" className={btn(editor.isActive("heading", { level: 2 }))}
          onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}>
          <Heading2 className="h-4 w-4" />
        </Button>
        <Button type="button" variant="ghost" size="sm" className={btn(editor.isActive("bulletList"))}
          onClick={() => editor.chain().focus().toggleBulletList().run()}>
          <List className="h-4 w-4" />
        </Button>
        <Button type="button" variant="ghost" size="sm" className={btn(editor.isActive("link"))}
          onClick={() => {
            const prev = editor.getAttributes("link").href as string | undefined;
            const url = window.prompt("Enter URL", prev ?? "https://");
            if (url === null) return;
            if (url === "") editor.chain().focus().unsetLink().run();
            else editor.chain().focus().setLink({ href: url }).run();
          }}>
          <LinkIcon className="h-4 w-4" />
        </Button>
      </div>
      <EditorContent editor={editor} className="px-3 py-2" data-placeholder={placeholder} />
    </div>
  );
}
