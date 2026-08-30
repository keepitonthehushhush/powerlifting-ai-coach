import { parseCoachMarkdown } from '../lib/coachMarkdown.js';

/**
 * A coach reply, rendered as typography rather than as the characters the
 * model typed.
 *
 * ── THE PROPERTY THAT MATTERS ─────────────────────────────────────────────
 *
 * Every leaf below is a React text child. React escapes those by
 * construction, so there is no HTML string in this file, no
 * dangerouslySetInnerHTML, and nothing for a sanitiser to get wrong. A reply
 * containing `<script>alert(1)</script>` renders the characters. That is not
 * a happy accident of the current code - it is the reason the parser returns
 * data instead of markup, and a test asserts it.
 *
 * Athlete messages are NOT run through this. They are typed by a person who
 * meant the characters they typed, and turning their asterisks into bold
 * would be editing what they said back at them.
 */

function Spans({ spans }) {
  return spans.map((span, i) => {
    if (span.type === 'bold') return <strong key={i}>{span.value}</strong>;
    if (span.type === 'italic') return <em key={i}>{span.value}</em>;
    if (span.type === 'code') return <code key={i}>{span.value}</code>;
    return <span key={i}>{span.value}</span>;
  });
}

export function CoachMessage({ text }) {
  const blocks = parseCoachMarkdown(text);

  return (
    <div className="content coach-copy">
      {blocks.map((block, i) => {
        if (block.type === 'heading') {
          const Tag = `h${block.level}`;
          return (
            <Tag key={i} className="coach-heading">
              <Spans spans={block.spans} />
            </Tag>
          );
        }

        if (block.type === 'list') {
          const Tag = block.ordering === 'ordered' ? 'ol' : 'ul';
          return (
            <Tag key={i} className="coach-list">
              {block.items.map((item, j) => (
                <li key={j}>
                  <Spans spans={item} />
                </li>
              ))}
            </Tag>
          );
        }

        if (block.type === 'table') {
          return (
            // Wrapped because a meet-prep block is five columns wide and a
            // phone is not. The table scrolls; the page must not.
            <div key={i} className="coach-table-scroll">
              <table className="coach-table">
                <thead>
                  <tr>
                    {block.header.map((cell, j) => (
                      <th key={j}>
                        <Spans spans={cell} />
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {block.rows.map((row, j) => (
                    <tr key={j}>
                      {row.map((cell, k) => (
                        <td key={k}>
                          <Spans spans={cell} />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        }

        return (
          <p key={i}>
            <Spans spans={block.spans} />
          </p>
        );
      })}
    </div>
  );
}
