/**
 * The CRM's editor — CKEditor, ported from the legacy app verbatim.
 *
 * Source: apps/web/components/marketing/ui/ck-editor.tsx. Only two lines
 * differ: the Next "use client" directive is gone, and the stylesheet import
 * points at src/styles instead of app/.
 *
 * I rebuilt this twice in Tiptap first. Both times it was a subset — I picked
 * which of the operator's buttons mattered, which was not mine to pick, and the
 * result did not look like the editor people had been using for months. Porting
 * the component removes the argument: same plugins, same toolbar, same CSS,
 * same behaviour, including paste-from-Word and the image upload adapter.
 */
import { useState, useEffect, useRef } from 'react';
import { CKEditor } from '@ckeditor/ckeditor5-react';
import {
	ClassicEditor,
	AccessibilityHelp,
	AutoImage,
	AutoLink,
	BlockQuote,
	Bold,
	Clipboard,
	Code,
	CodeBlock,
	Essentials,
	FontBackgroundColor,
	FontColor,
	FontFamily,
	FontSize,
	GeneralHtmlSupport,
	Heading,
	HorizontalLine,
	Image,
	ImageCaption,
	ImageInsert,
	ImageResize,
	ImageStyle,
	ImageTextAlternative,
	ImageToolbar,
	ImageUpload,
	Indent,
	IndentBlock,
	Italic,
	Link,
	LinkImage,
	List,
	ListProperties,
	Paragraph,
	PasteFromOffice,
	PictureEditing,
	SelectAll,
	SimpleUploadAdapter,
	Strikethrough,
	Table,
	TableCaption,
	TableCellProperties,
	TableColumnResize,
	TableProperties,
	TableToolbar,
	TextTransformation,
	TodoList,
	Underline,
	Undo,
	Alignment
} from 'ckeditor5';

import 'ckeditor5/ckeditor5.css';
import "@/styles/marketing-ckeditor.css";

interface CkEditorProps {
  content: string;
  onChange: (html: string) => void;
  placeholder?: string;
  // When provided, inline image upload is enabled and files are POSTed here
  // (multipart `upload` field → `{ url }`). Omit to keep the plain editor.
  uploadUrl?: string;
}

export function CkEditor({ content, onChange, placeholder, uploadUrl }: CkEditorProps) {
  const editorContainerRef = useRef(null);
  const editorRef = useRef(null);
  const [isLayoutReady, setIsLayoutReady] = useState(false);

  useEffect(() => {
		// eslint-disable-next-line react-hooks/set-state-in-effect -- CKEditor SSR layout guard
		setIsLayoutReady(true);
		return () => setIsLayoutReady(false);
	}, []);

  const imagesEnabled = Boolean(uploadUrl);

  const imagePlugins = imagesEnabled
    ? [
        Image,
        ImageCaption,
        ImageInsert,
        ImageResize,
        ImageStyle,
        ImageTextAlternative,
        ImageToolbar,
        ImageUpload,
        AutoImage,
        LinkImage,
        PictureEditing,
        SimpleUploadAdapter,
      ]
    : [];

  const editorConfig = {
		licenseKey: 'GPL',
		toolbar: {
			items: [
				'undo',
				'redo',
				'|',
				'heading',
				'|',
				'fontFamily',
				'fontSize',
				'fontColor',
				'fontBackgroundColor',
				'|',
				'bold',
				'italic',
				'underline',
				'strikethrough',
				'code',
				'|',
				'alignment:left',
				'alignment:center',
				'alignment:right',
				'alignment:justify',
				'|',
				'link',
				'blockQuote',
				'codeBlock',
				'horizontalLine',
				'insertTable',
				...(imagesEnabled ? ['insertImage'] : []),
				'|',
				'bulletedList',
				'numberedList',
				'todoList',
				'|',
				'outdent',
				'indent',
			]
		},
		plugins: [
			AccessibilityHelp,
			Alignment,
			AutoLink,
			BlockQuote,
			Bold,
			Clipboard,
			Code,
			CodeBlock,
			Essentials,
			FontBackgroundColor,
			FontColor,
			FontFamily,
			FontSize,
			GeneralHtmlSupport,
			Heading,
			HorizontalLine,
			Indent,
			IndentBlock,
			Italic,
			Link,
			List,
			ListProperties,
			Paragraph,
			PasteFromOffice,
			SelectAll,
			Strikethrough,
			Table,
			TableCaption,
			TableCellProperties,
			TableColumnResize,
			TableProperties,
			TableToolbar,
			TextTransformation,
			TodoList,
			Underline,
			Undo,
			...imagePlugins,
		],
		fontFamily: {
			options: [
				'Georgia, serif',
				'Inter, sans-serif',
				'Arial, sans-serif',
				'Helvetica, sans-serif',
				'Times New Roman, serif',
				'Courier New, monospace',
				'Verdana, sans-serif'
			],
			default: 'Georgia, serif',
			supportAllValues: true
		},
		fontSize: {
			options: [10, 12, 14, 15, 16, 18, 20, 22, 24, 26, 28, 30],
			default: 14,
			supportAllValues: true
		},
		heading: {
			options: [
				{ model: 'paragraph', title: 'Paragraph', class: 'ck-heading_paragraph' },
				{ model: 'heading1', view: 'h1', title: 'Heading 1', class: 'ck-heading_heading1' },
				{ model: 'heading2', view: 'h2', title: 'Heading 2', class: 'ck-heading_heading2' },
				{ model: 'heading3', view: 'h3', title: 'Heading 3', class: 'ck-heading_heading3' }
			] as any
		},
		placeholder: placeholder || 'Type or paste your content here!',
		htmlSupport: {
			allow: [
				{
					name: /.*/,
					attributes: true,
					classes: true,
					styles: true
				}
			] as any
		},
		table: {
			contentToolbar: ['tableColumn', 'tableRow', 'mergeTableCells', 'tableProperties', 'tableCellProperties']
		},
		...(uploadUrl
			? {
				image: {
					toolbar: [
						'imageStyle:inline',
						'imageStyle:block',
						'imageStyle:side',
						'|',
						'toggleImageCaption',
						'imageTextAlternative',
						'|',
						'resizeImage',
					],
				},
				simpleUpload: {
					uploadUrl,
					withCredentials: true,
				},
			}
			: {}),
	};

  return (
    <div className="main-container text-black dark:text-white">
      <div className="editor-container editor-container_classic-editor" ref={editorContainerRef}>
        <div className="editor-container__editor">
          <div ref={editorRef}>
            {isLayoutReady && (
              <CKEditor
                editor={ClassicEditor}
                config={editorConfig}
                data={content}
                onChange={(_event, editor) => {
                  const data = editor.getData();
                  onChange(data);
                }}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
