import { Editor } from "@tiptap/core";
import { Markdown } from "@tiptap/markdown";
import StarterKit from "@tiptap/starter-kit";
import { describe, expect, it } from "vitest";
import { NuraViewMention } from "./nuraview-mention";

function makeEditor() {
  return new Editor({
    extensions: [
      StarterKit.configure({ trailingNode: false }),
      Markdown.configure({ markedOptions: { breaks: true, gfm: true } }),
      NuraViewMention,
    ],
    content: "",
  });
}

describe("nuraview mention", () => {
  // Regression: a duplicated prosemirror-model in the install tree made this
  // multi-node insert (the exact shape the @mention suggestion command uses)
  // throw "looks like multiple versions of prosemirror-model were loaded", so
  // picking a member from the popup silently inserted nothing.
  it("inserts a mention alongside other nodes and serializes it to markdown", () => {
    const editor = makeEditor();

    editor
      .chain()
      .insertContent([
        { type: "text", text: "hey " },
        { type: "nuraviewMention", attrs: { id: "user-1", label: "Varshith" } },
        { type: "text", text: " look" },
      ])
      .run();

    expect(JSON.stringify(editor.getJSON())).toContain("nuraviewMention");
    expect(editor.getMarkdown()).toContain(
      '<nuraview-mention id="user-1" label="Varshith"></nuraview-mention>',
    );
  });

  it("parses a stored mention back into a chip", () => {
    const editor = makeEditor();

    editor.commands.setContent(
      'hey <nuraview-mention id="user-1" label="Varshith"></nuraview-mention> look',
      { contentType: "markdown" },
    );

    expect(JSON.stringify(editor.getJSON())).toContain("nuraviewMention");
    expect(editor.getHTML()).toContain('class="nuraview-mention"');
    expect(editor.getHTML()).toContain("@Varshith");
  });
});
