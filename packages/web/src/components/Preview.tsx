import { useMemo } from 'react';
import { marked } from 'marked';

marked.setOptions({ gfm: true, breaks: false });

function renderMd(md: string): string {
  // marked (GFM) renders headings, bold/italic, ordered/unordered lists, code
  // blocks, tables, blockquotes, links and task-list checkboxes natively.
  return marked.parse(md, { async: false }) as string;
}

export function Preview({ text, scrollRef }: { text: string; scrollRef?: React.Ref<HTMLDivElement> }) {
  const html = useMemo(() => renderMd(text), [text]);
  return (
    <div className="scroll" ref={scrollRef}>
      <div className="preview-body" dangerouslySetInnerHTML={{ __html: html }} />
    </div>
  );
}
