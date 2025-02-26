// FullAnswerDisplay.tsx
import React, { useState } from 'react';
import ReactMarkdown, { Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeRaw from 'rehype-raw';

interface ReferenceChunk {
  id: string;
  content: string;
  document_name: string;
  similarity?: number;
}

interface ReferenceData {
  chunks: ReferenceChunk[];
}

interface APIData {
  code: number;
  data: {
    answer: string;
    reference: ReferenceData;
  };
}

/** 引用详情浮层 */
function ReferenceTooltip({ chunk }: { chunk: ReferenceChunk }) {
  return (
    <div className="absolute bg-white border border-gray-200 rounded-lg shadow-lg p-4 w-[300px] z-50 mt-2">
      <div className="font-medium text-gray-800 mb-2">{chunk.document_name}</div>
      {chunk.similarity != null && (
        <div className="text-sm text-gray-500 mb-2">
          相似度: {(chunk.similarity * 100).toFixed(1)}%
        </div>
      )}
      <div className="text-sm text-gray-700 whitespace-pre-wrap">
        {chunk.content}
      </div>
    </div>
  );
}

/** 引用标记组件 */
function ReferenceMarker({
  index,
  chunk,
}: {
  index: number;
  chunk?: ReferenceChunk;
}) {
  const [showTooltip, setShowTooltip] = useState(false);
  return (
    <sup
      className="inline-flex relative text-blue-600 bg-blue-50 px-1 rounded cursor-help"
      onMouseEnter={() => setShowTooltip(true)}
      onMouseLeave={() => setShowTooltip(false)}
    >
      [{index}]
      {showTooltip && chunk && <ReferenceTooltip chunk={chunk} />}
    </sup>
  );
}

/**
 * 主体组件
 *
 * 在将回答文本传给 ReactMarkdown 前，先进行预处理：
 * 1. 利用正则将所有 "##数字$$" 替换为内联 HTML 标签，
 *    同时利用闭包记录一个映射，把原始数字替换为顺序编号（从 1 开始）。
 * 2. 使用 data-new-index 和 data-original-index 存储新编号和原始编号，
 *    便于自定义组件使用。
 */
function FullAnswerDisplay({ response }: { response: APIData }) {
  const { answer, reference } = response.data;
  const chunks = reference?.chunks || [];

  const citationMapping: Record<string, number> = {};
  let nextSeq = 1;

  const processedAnswer = answer.replace(/\s*##(\d+)\$\$/g, (_, originalIndex) => {
    if (!citationMapping[originalIndex]) {
      citationMapping[originalIndex] = nextSeq;
      nextSeq++;
    }
    const newNumber = citationMapping[originalIndex];
    return `<span class="ref-marker" data-new-index="${newNumber}" data-original-index="${originalIndex}"></span>`;
  });

  const components: Components = {
    span: ({ node, ...props }) => {
      if (props.className === 'ref-marker') {
        const newIndex = parseInt(props['data-new-index'] as string, 10);
        const originalIndex = parseInt(props['data-original-index'] as string, 10);
        return (
          <ReferenceMarker
            index={newIndex}
            chunk={chunks[originalIndex]}
          />
        );
      }
      return <span {...props} />;
    }
  };

  return (
    <div className="prose max-w-none">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeRaw]}
        skipHtml={false}
        components={components}
      >
        {processedAnswer}
      </ReactMarkdown>
    </div>
  );
}

export default FullAnswerDisplay;
