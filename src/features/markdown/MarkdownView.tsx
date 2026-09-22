import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";

interface Props {
  content: string;
}

export function MarkdownView({ content }: Props) {
  return (
    <div className="h-full overflow-auto bg-bg p-6">
      <article className="prose prose-invert max-w-3xl mx-auto">
        <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]}>
          {content}
        </ReactMarkdown>
      </article>
    </div>
  );
}
