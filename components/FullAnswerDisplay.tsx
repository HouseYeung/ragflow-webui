// FullAnswerDisplay.tsx
import React, { useState, useRef, useEffect } from 'react';
import ReactMarkdown, { Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeRaw from 'rehype-raw';
import { XMarkIcon } from '@heroicons/react/24/outline';

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
function ReferenceTooltip({ chunk, onClose, position }: { 
  chunk: ReferenceChunk; 
  onClose: () => void;
  position: { top: number; left: number; };
}) {
  const tooltipRef = useRef<HTMLDivElement>(null);
  const [tooltipPosition, setTooltipPosition] = useState(position);

  useEffect(() => {
    if (tooltipRef.current) {
      const tooltip = tooltipRef.current;
      const rect = tooltip.getBoundingClientRect();
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;

      let newLeft = position.left;
      let newTop = position.top;

      // 处理水平方向的溢出
      if (rect.right > viewportWidth) {
        newLeft = Math.max(10, viewportWidth - rect.width - 10);
      }

      // 处理垂直方向的溢出
      if (rect.bottom > viewportHeight) {
        newTop = Math.max(10, position.top - rect.height - 40); // 40是一个偏移量，可以根据需要调整
      }

      setTooltipPosition({ left: newLeft, top: newTop });
    }
  }, [position]);

  return (
    <div 
      ref={tooltipRef}
      className="fixed bg-white border border-gray-200 rounded-lg shadow-lg p-4 w-[min(300px,calc(100vw-2rem))] z-50"
      style={{
        left: tooltipPosition.left,
        top: tooltipPosition.top
      }}
    >
      <div className="flex justify-between items-start mb-2">
        <span className="font-medium text-gray-800 pr-2">{chunk.document_name}</span>
        <button 
          onClick={onClose}
          className="p-1 hover:bg-gray-100 rounded-full"
        >
          <XMarkIcon className="w-4 h-4 text-gray-500" />
        </button>
      </div>
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
  const markerRef = useRef<HTMLElement>(null);
  const [tooltipPosition, setTooltipPosition] = useState({ top: 0, left: 0 });

  const handleShowTooltip = () => {
    if (!showTooltip && markerRef.current && chunk) {
      const rect = markerRef.current.getBoundingClientRect();
      setTooltipPosition({
        top: rect.bottom + window.scrollY,
        left: rect.left + window.scrollX
      });
      setShowTooltip(true);
    }
  };

  const handleHideTooltip = () => {
    setShowTooltip(false);
  };

  useEffect(() => {
    // 在移动端，点击其他地方时关闭tooltip
    const handleClickOutside = (event: MouseEvent) => {
      if (markerRef.current && !markerRef.current.contains(event.target as Node)) {
        handleHideTooltip();
      }
    };

    if (showTooltip) {
      document.addEventListener('click', handleClickOutside);
    }

    return () => {
      document.removeEventListener('click', handleClickOutside);
    };
  }, [showTooltip]);

  return (
    <sup
      ref={markerRef}
      className="inline-flex relative text-blue-600 bg-blue-50 px-1 rounded cursor-pointer select-none"
      onClick={(e) => {
        e.stopPropagation(); // 防止事件冒泡触发外部点击事件
        if (showTooltip) {
          handleHideTooltip();
        } else {
          handleShowTooltip();
        }
      }}
      onMouseEnter={() => {
        // 在非移动端设备上使用hover
        if (window.matchMedia('(min-width: 768px)').matches) {
          handleShowTooltip();
        }
      }}
      onMouseLeave={() => {
        // 在非移动端设备上使用hover
        if (window.matchMedia('(min-width: 768px)').matches) {
          handleHideTooltip();
        }
      }}
    >
      [{index}]
      {showTooltip && chunk && (
        <ReferenceTooltip 
          chunk={chunk} 
          onClose={handleHideTooltip}
          position={tooltipPosition}
        />
      )}
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
