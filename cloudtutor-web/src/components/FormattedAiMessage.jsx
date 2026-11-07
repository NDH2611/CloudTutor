import React from 'react';
import { Play } from 'lucide-react';
import katex from 'katex';
import 'katex/dist/katex.min.css';

/**
 * Safely renders LaTeX to HTML via KaTeX
 */
function renderKatex(latex, isBlock = false) {
  if (!latex) return '';
  try {
    return katex.renderToString(latex.trim(), {
      throwOnError: false,
      displayMode: isBlock,
      output: 'htmlAndMathml'
    });
  } catch (e) {
    console.warn('KaTeX rendering error:', e);
    return `<span class="font-mono text-xs bg-slate-100 px-1.5 py-0.5 rounded border border-slate-200 text-indigo-700">${latex}</span>`;
  }
}

/**
 * Parses timestamps in formats:
 * - "0.21s", "173s", "12.5s"
 * - "01:23", "1:23", "01:23:45"
 * Returns float seconds or null
 */
function parseTimestampToSeconds(str) {
  if (!str) return null;
  const cleaned = str.trim();

  // Format MM:SS or HH:MM:SS
  if (cleaned.includes(':')) {
    const parts = cleaned.split(':').map(Number);
    if (parts.some(isNaN)) return null;
    if (parts.length === 2) return parts[0] * 60 + parts[1];
    if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  }

  // Format Xs e.g. "0.21s", "173s", "12"
  const num = parseFloat(cleaned.replace(/s$/i, ''));
  return isNaN(num) ? null : num;
}

/**
 * Parses inline markdown:
 * - Block Math: $$...$$
 * - Inline Math: $...$ or \(...\)
 * - Timestamps: [0.21s - 173s] or [0.21s] or [01:23]
 * - Bold: **text**
 * - Inline Code: `code`
 * - Italic: *text*
 */
function renderInline(text, onSeek) {
  if (!text) return null;

  // Regex matches in precedence order:
  // 1. Block math inside line: $$...$$
  // 2. Inline math \(...\)
  // 3. Inline math $...$
  // 4. Timestamps: [0.21s - 173s] or [01:23]
  // 5. Bold: **bold**
  // 6. Code: `code`
  // 7. Italic: *italic*
  const tokenRegex = /(\$\$([^\$]+?)\$\$)|(\\\((.+?)\\\))|(\$([^\$\n]+?)\$)|(\[(\d+(?:\.\d+)?s?(?:\s*-\s*[\d.]+s?)?|\d+:\d{2}(?:\s*-\s*\d+:\d{2})?)\])|(\*\*([^*]+)\*\*)|(`([^`]+)`)|(\*([^*]+)\*)/g;

  const result = [];
  let lastIndex = 0;
  let match;

  while ((match = tokenRegex.exec(text)) !== null) {
    // Plain text before match
    if (match.index > lastIndex) {
      result.push(text.substring(lastIndex, match.index));
    }

    const [
      fullMatch,
      blockMathMatch,
      blockMathContent,
      parenMathMatch,
      parenMathContent,
      dollarMathMatch,
      dollarMathContent,
      timestampBracket,
      timeContent,
      boldMatch,
      boldContent,
      codeMatch,
      codeContent,
      italicMatch,
      italicContent
    ] = match;

    if (blockMathMatch) {
      result.push(
        <span
          key={`block-math-${match.index}`}
          className="inline-block my-1.5 p-2 rounded-xl bg-slate-50 border border-slate-200 text-center shadow-xs overflow-x-auto align-middle max-w-full"
          dangerouslySetInnerHTML={{
            __html: renderKatex(blockMathContent, true)
          }}
        />
      );
    } else if (parenMathMatch || dollarMathMatch) {
      const mathLatex = parenMathContent || dollarMathContent;
      result.push(
        <span
          key={`inline-math-${match.index}`}
          className="inline-math px-1.5 py-0.5 rounded-lg bg-indigo-50/60 text-slate-900 border border-indigo-100/80 mx-0.5 align-middle shadow-2xs font-normal"
          dangerouslySetInnerHTML={{
            __html: renderKatex(mathLatex, false)
          }}
        />
      );
    } else if (timestampBracket) {
      // Extract starting time
      const firstPart = (timeContent || '').split('-')[0].trim();
      const seconds = parseTimestampToSeconds(firstPart);

      if (seconds !== null && !isNaN(seconds)) {
        result.push(
          <button
            key={`ts-${match.index}`}
            type="button"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              if (onSeek) onSeek(seconds);
            }}
            title={`Nhảy tới video tại ${firstPart}`}
            className="inline-flex items-center gap-1 px-1.5 py-0.5 mx-1 my-0.5 rounded-md bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-200 text-[11px] font-mono font-bold transition-all cursor-pointer group shadow-xs align-middle"
          >
            <Play className="w-2.5 h-2.5 fill-indigo-600 text-indigo-600 group-hover:scale-125 transition-transform" />
            <span>{timeContent}</span>
          </button>
        );
      } else {
        result.push(fullMatch);
      }
    } else if (boldMatch) {
      result.push(
        <strong key={`b-${match.index}`} className="font-bold text-slate-900">
          {boldContent}
        </strong>
      );
    } else if (codeMatch) {
      result.push(
        <code
          key={`c-${match.index}`}
          className="px-1.5 py-0.5 mx-0.5 rounded bg-slate-100 border border-slate-200 text-indigo-700 font-mono text-[11px] font-semibold"
        >
          {codeContent}
        </code>
      );
    } else if (italicMatch) {
      result.push(
        <em key={`i-${match.index}`} className="italic text-slate-800">
          {italicContent}
        </em>
      );
    }

    lastIndex = tokenRegex.lastIndex;
  }

  if (lastIndex < text.length) {
    result.push(text.substring(lastIndex));
  }

  return result;
}

/**
 * FormattedAiMessage:
 * Parses multi-line AI responses with:
 * - LaTeX / KaTeX formulas ($...$, $$...$$, \(...\), \[...\])
 * - Code blocks (```lang ... ```)
 * - Headings (###, ##, #)
 * - Unordered lists (*, -, •)
 * - Ordered lists (1., 2., etc.)
 * - Horizontal dividers (---, ***)
 * - Blockquotes (> )
 * - Interactive timestamps ([0.21s - 173s])
 */
export function FormattedAiMessage({ text, onSeek }) {
  if (!text) return null;

  const rawLines = text.split('\n');
  const blocks = [];
  let currentList = null; // { type: 'ul' | 'ol', items: [] }
  let currentCodeBlock = null; // { lang: '', lines: [] }
  let currentMathBlock = null; // { lines: [] }
  let tableRows = null; // []

  const flushList = () => {
    if (currentList) {
      blocks.push({ ...currentList });
      currentList = null;
    }
  };

  const flushTable = () => {
    if (tableRows && tableRows.length > 0) {
      blocks.push({ type: 'table', rows: [...tableRows] });
      tableRows = null;
    }
  };

  for (let i = 0; i < rawLines.length; i++) {
    const line = rawLines[i];
    const trimmed = line.trim();

    // 1. Code blocks ```
    if (trimmed.startsWith('```')) {
      flushList();
      flushTable();
      if (currentCodeBlock) {
        // Closing code block
        blocks.push({ type: 'code', ...currentCodeBlock });
        currentCodeBlock = null;
      } else {
        // Opening code block
        const lang = trimmed.replace(/^```/, '').trim();
        currentCodeBlock = { lang, lines: [] };
      }
      continue;
    }

    if (currentCodeBlock) {
      currentCodeBlock.lines.push(line);
      continue;
    }

    // 2. Multi-line Block Math ($$ ... $$ or \[ ... \])
    if (trimmed === '$$' || trimmed === '\\[' || trimmed === '\\]') {
      flushList();
      flushTable();
      if (currentMathBlock) {
        blocks.push({ type: 'blockMath', content: currentMathBlock.lines.join('\n') });
        currentMathBlock = null;
      } else if (trimmed === '$$' || trimmed === '\\[') {
        currentMathBlock = { lines: [] };
      }
      continue;
    }

    if (currentMathBlock) {
      if (trimmed.endsWith('$$') || trimmed.endsWith('\\]')) {
        const withoutEnd = trimmed.replace(/\$\$|\\\]$/, '').trim();
        if (withoutEnd) currentMathBlock.lines.push(withoutEnd);
        blocks.push({ type: 'blockMath', content: currentMathBlock.lines.join('\n') });
        currentMathBlock = null;
      } else {
        currentMathBlock.lines.push(line);
      }
      continue;
    }

    // Single line block math: $$ formula $$
    const singleBlockMath = trimmed.match(/^\$\$(.+?)\$\$$/) || trimmed.match(/^\\\[(.+?)\\\]$/);
    if (singleBlockMath) {
      flushList();
      flushTable();
      blocks.push({ type: 'blockMath', content: singleBlockMath[1] });
      continue;
    }

    // 3. Table row detection (| a | b |)
    if (trimmed.startsWith('|') && trimmed.endsWith('|') && trimmed.length > 2) {
      flushList();
      if (!tableRows) tableRows = [];
      tableRows.push(trimmed);
      continue;
    } else {
      flushTable();
    }

    // 4. Horizontal divider --- or ***
    if (/^(\-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
      flushList();
      blocks.push({ type: 'hr' });
      continue;
    }

    // 5. Headings: #, ##, ###, ####
    const headingMatch = trimmed.match(/^(#{1,4})\s+(.+)$/);
    if (headingMatch) {
      flushList();
      const level = headingMatch[1].length;
      const content = headingMatch[2];
      blocks.push({ type: 'heading', level, content });
      continue;
    }

    // 6. Unordered list: *, -, •
    const bulletMatch = trimmed.match(/^[\*\-\•]\s+(.+)$/);
    if (bulletMatch) {
      if (currentList && currentList.type !== 'ul') {
        flushList();
      }
      if (!currentList) {
        currentList = { type: 'ul', items: [] };
      }
      currentList.items.push(bulletMatch[1]);
      continue;
    }

    // 7. Ordered list: 1., 2., etc.
    const orderedMatch = trimmed.match(/^(\d+)[\.\)]\s+(.+)$/);
    if (orderedMatch) {
      if (currentList && currentList.type !== 'ol') {
        flushList();
      }
      if (!currentList) {
        currentList = { type: 'ol', items: [] };
      }
      currentList.items.push({ num: orderedMatch[1], content: orderedMatch[2] });
      continue;
    }

    // 8. Blockquote: > text
    if (trimmed.startsWith('>')) {
      flushList();
      const content = trimmed.replace(/^>\s?/, '');
      blocks.push({ type: 'quote', content });
      continue;
    }

    // 9. Empty lines
    if (!trimmed) {
      flushList();
      continue;
    }

    // 10. Regular Paragraph
    flushList();
    blocks.push({ type: 'paragraph', content: line });
  }

  // Flush remaining structures
  flushList();
  flushTable();
  if (currentCodeBlock) {
    blocks.push({ type: 'code', ...currentCodeBlock });
  }
  if (currentMathBlock) {
    blocks.push({ type: 'blockMath', content: currentMathBlock.lines.join('\n') });
  }

  return (
    <div className="space-y-2 text-xs text-slate-800 leading-relaxed break-words">
      {blocks.map((block, idx) => {
        switch (block.type) {
          case 'blockMath': {
            return (
              <div
                key={idx}
                className="my-3 p-3 overflow-x-auto rounded-xl bg-slate-50/90 border border-slate-200/80 text-center shadow-xs"
                dangerouslySetInnerHTML={{
                  __html: renderKatex(block.content, true)
                }}
              />
            );
          }

          case 'heading': {
            if (block.level === 1 || block.level === 2) {
              return (
                <h3
                  key={idx}
                  className="font-bold text-sm sm:text-[13.5px] text-slate-900 mt-3.5 mb-1.5 flex items-center gap-2 border-b border-slate-100 pb-1"
                >
                  <span className="w-1.5 h-4 bg-indigo-600 rounded-full inline-block shrink-0" />
                  <span>{renderInline(block.content, onSeek)}</span>
                </h3>
              );
            }
            return (
              <h4
                key={idx}
                className="font-bold text-xs sm:text-[12.5px] text-slate-900 mt-3 mb-1 flex items-center gap-1.5"
              >
                <span className="w-1.5 h-3 bg-indigo-500 rounded-full inline-block shrink-0" />
                <span>{renderInline(block.content, onSeek)}</span>
              </h4>
            );
          }

          case 'ul': {
            return (
              <ul key={idx} className="my-2 space-y-2 pl-0.5">
                {block.items.map((item, itemIdx) => (
                  <li key={itemIdx} className="flex items-start gap-2.5 text-xs text-slate-700">
                    <span className="w-1.5 h-1.5 rounded-full bg-indigo-500 mt-1.5 shrink-0" />
                    <div className="flex-1 leading-relaxed">
                      {renderInline(item, onSeek)}
                    </div>
                  </li>
                ))}
              </ul>
            );
          }

          case 'ol': {
            return (
              <ol key={idx} className="my-2 space-y-2 pl-0.5">
                {block.items.map((item, itemIdx) => (
                  <li key={itemIdx} className="flex items-start gap-2 text-xs text-slate-700">
                    <span className="w-4 h-4 rounded-full bg-indigo-50 text-indigo-700 font-mono font-bold text-[10px] flex items-center justify-center shrink-0 mt-0.5 border border-indigo-200">
                      {item.num || itemIdx + 1}
                    </span>
                    <div className="flex-1 leading-relaxed">
                      {renderInline(item.content, onSeek)}
                    </div>
                  </li>
                ))}
              </ol>
            );
          }

          case 'hr': {
            return <hr key={idx} className="my-3 border-t border-slate-200" />;
          }

          case 'quote': {
            return (
              <blockquote
                key={idx}
                className="border-l-3 border-indigo-400 pl-3 py-1.5 my-2 bg-indigo-50/40 rounded-r-xl text-slate-700 italic text-[11.5px]"
              >
                {renderInline(block.content, onSeek)}
              </blockquote>
            );
          }

          case 'code': {
            return (
              <div key={idx} className="my-2.5 rounded-xl bg-slate-900 text-slate-100 overflow-hidden shadow-inner">
                {block.lang && (
                  <div className="px-3 py-1 bg-slate-800 text-[10px] font-mono text-slate-400 border-b border-slate-700">
                    {block.lang}
                  </div>
                )}
                <pre className="p-3 font-mono text-[11px] overflow-x-auto leading-relaxed">
                  <code>{block.lines.join('\n')}</code>
                </pre>
              </div>
            );
          }

          case 'table': {
            const rows = block.rows;
            const parseRow = (r) =>
              r
                .split('|')
                .slice(1, -1)
                .map((c) => c.trim());

            if (rows.length < 2) return null;
            const headerCells = parseRow(rows[0]);
            const isSeparator = rows[1].includes('---');
            const dataRows = isSeparator ? rows.slice(2) : rows.slice(1);

            return (
              <div key={idx} className="my-3 overflow-x-auto rounded-xl border border-slate-200 shadow-xs">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 border-b border-slate-200 font-bold text-slate-900">
                    <tr>
                      {headerCells.map((h, hIdx) => (
                        <th key={hIdx} className="px-3 py-2">
                          {renderInline(h, onSeek)}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {dataRows.map((r, rIdx) => (
                      <tr key={rIdx} className="hover:bg-slate-50/60 transition-colors">
                        {parseRow(r).map((cell, cIdx) => (
                          <td key={cIdx} className="px-3 py-2 text-slate-700">
                            {renderInline(cell, onSeek)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          }

          case 'paragraph':
          default: {
            return (
              <p key={idx} className="my-1.5 leading-relaxed text-slate-800">
                {renderInline(block.content, onSeek)}
              </p>
            );
          }
        }
      })}
    </div>
  );
}

export default FormattedAiMessage;
