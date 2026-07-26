/**
 * Kairo — Syntax Highlighting
 * Multi-language syntax highlighting for terminal output
 */

import { theme, reset, bold, dim } from './theme.js';

const c = theme.colors;

// ─── Language-specific highlighting ─────────────────────────────

const JS_KEYWORDS = /\b(const|let|var|function|return|if|else|for|while|class|import|export|from|async|await|try|catch|throw|new|typeof|instanceof|interface|type|enum|extends|implements|abstract|private|protected|public|static|readonly|as|is|in|of|void|null|undefined|true|false|this|super|switch|case|break|default|continue|yield|delete|with|finally|do)\b/g;

const PY_KEYWORDS = /\b(def|class|import|from|return|if|elif|else|for|while|try|except|raise|with|as|async|await|yield|lambda|and|or|not|in|is|None|True|False|pass|break|continue|global|nonlocal|del|assert|finally)\b/g;

const SH_KEYWORDS = /\b(if|then|else|elif|fi|for|while|do|done|case|esac|function|return|exit|echo|export|source|alias|local|readonly|shift|set|unset|trap|exec|eval|cd|pwd|pushd|popd)\b/g;

const SQL_KEYWORDS = /\b(SELECT|FROM|WHERE|INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|TABLE|INDEX|JOIN|LEFT|RIGHT|INNER|OUTER|ON|AND|OR|NOT|IN|LIKE|BETWEEN|NULL|IS|AS|ORDER|BY|GROUP|HAVING|LIMIT|OFFSET|UNION|SET|VALUES|INTO|VIEW|PROCEDURE|FUNCTION|TRIGGER|IF|BEGIN|END|DECLARE|CURSOR|FETCH|OPEN|CLOSE|DEALLOCATE|PREPARE|EXECUTE|GRANT|REVOKE|COMMIT|ROLLBACK|SAVEPOINT|TRANSACTION|ISOLATION|LEVEL|READ|WRITE|UNCOMMITTED|COMMITTED|REPEATABLE|SERIALIZABLE)\b/gi;

const RUST_KEYWORDS = /\b(fn|let|mut|const|struct|enum|impl|trait|pub|use|mod|crate|self|super|where|match|if|else|for|while|loop|return|break|continue|move|ref|async|await|unsafe|extern|type|as|in|dyn|static|true|false)\b/g;

const GO_KEYWORDS = /\b(func|var|const|type|struct|interface|map|chan|go|select|case|default|if|else|for|range|return|break|continue|switch|fallthrough|defer|package|import|true|false|nil)\b/g;

export function highlightLine(line: string, lang: string): string {
  let h = line;

  // Strings (all languages)
  h = h.replace(/(["'`])(?:(?!\1|\\).|\\.)*\1/g, c.success + '$&' + reset);

  // Comments
  if (['ts', 'typescript', 'js', 'javascript', 'rust', 'go', 'java', 'c', 'cpp'].includes(lang)) {
    h = h.replace(/(\/\/.*$)/gm, c.muted + '$1' + reset);
    h = h.replace(/(\/\*[\s\S]*?\*\/)/g, c.muted + '$1' + reset);
  } else if (['python', 'py', 'ruby', 'sh', 'bash', 'shell'].includes(lang)) {
    h = h.replace(/(#.*$)/gm, c.muted + '$1' + reset);
  } else if (lang === 'sql') {
    h = h.replace(/(--.*$)/gm, c.muted + '$1' + reset);
  }

  // Keywords
  if (['ts', 'typescript', 'js', 'javascript'].includes(lang)) {
    h = h.replace(JS_KEYWORDS, c.secondary + '$1' + reset);
  } else if (['python', 'py'].includes(lang)) {
    h = h.replace(PY_KEYWORDS, c.secondary + '$1' + reset);
  } else if (['sh', 'bash', 'shell'].includes(lang)) {
    h = h.replace(SH_KEYWORDS, c.secondary + '$1' + reset);
  } else if (lang === 'sql') {
    h = h.replace(SQL_KEYWORDS, c.secondary + '$1' + reset);
  } else if (lang === 'rust') {
    h = h.replace(RUST_KEYWORDS, c.secondary + '$1' + reset);
  } else if (lang === 'go') {
    h = h.replace(GO_KEYWORDS, c.secondary + '$1' + reset);
  }

  // Numbers
  h = h.replace(/\b(\d+\.?\d*)\b/g, c.accent + '$1' + reset);

  // Types (capitalized words)
  if (['ts', 'typescript', 'js', 'javascript', 'rust', 'go', 'java'].includes(lang)) {
    h = h.replace(/\b([A-Z]\w+)\b/g, c.primary + '$1' + reset);
  }

  // Variables (sh)
  if (['sh', 'bash', 'shell'].includes(lang)) {
    h = h.replace(/(\$\w+|\$\{[^}]+\})/g, c.accent + '$1' + reset);
  }

  return h;
}

export function highlightCode(code: string, lang?: string): string {
  const lines = code.split('\n');
  const maxLine = lines.length;
  const padLen = String(maxLine).length;

  return lines.map((line, i) => {
    const num = c.muted + String(i + 1).padStart(padLen) + reset;
    const highlighted = lang ? highlightLine(line, lang) : line;
    return `  ${c.border}│${reset} ${num}  ${highlighted}`;
  }).join('\n');
}

export function formatResponse(text: string): string {
  const parts = text.split(/(```[\s\S]*?```)/g);

  return parts.map(part => {
    const match = part.match(/^```(\w*)\n([\s\S]*?)```$/);
    if (match) {
      const lang = match[1] || 'text';
      const code = match[2].trimEnd();
      const header = `${c.primary}╭─ ${lang} ${'─'.repeat(Math.max(0, 80 - lang.length - 5))}${reset}`;
      const footer = `${c.primary}╰${'─'.repeat(79)}${reset}`;
      return `\n${header}\n${highlightCode(code, lang)}\n${footer}\n`;
    }
    return part;
  }).join('');
}
