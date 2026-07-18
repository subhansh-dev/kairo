/**
 * Mermaid diagram rendering — generates Mermaid-compatible diagram specs.
 */

export interface MermaidDiagram {
  type: 'flowchart' | 'sequence' | 'class' | 'state' | 'gantt';
  title?: string;
  content: string;
}

/**
 * Generate a flowchart from a list of nodes and edges.
 */
export function generateFlowchart(
  nodes: Array<{ id: string; label: string }>,
  edges: Array<{ from: string; to: string; label?: string }>,
  title?: string,
): MermaidDiagram {
  const lines: string[] = [];
  if (title) lines.push(`---\ntitle: ${title}\n---`);
  lines.push('graph TD');

  for (const node of nodes) {
    lines.push(`  ${node.id}["${node.label}"]`);
  }

  for (const edge of edges) {
    if (edge.label) {
      lines.push(`  ${edge.from} -->|"${edge.label}"| ${edge.to}`);
    } else {
      lines.push(`  ${edge.from} --> ${edge.to}`);
    }
  }

  return { type: 'flowchart', title, content: lines.join('\n') };
}

/**
 * Generate a sequence diagram.
 */
export function generateSequenceDiagram(
  participants: Array<{ id: string; label: string }>,
  messages: Array<{ from: string; to: string; label: string }>,
  title?: string,
): MermaidDiagram {
  const lines: string[] = [];
  if (title) lines.push(`---\ntitle: ${title}\n---`);
  lines.push('sequenceDiagram');

  for (const p of participants) {
    lines.push(`  participant ${p.id} as ${p.label}`);
  }

  for (const msg of messages) {
    lines.push(`  ${msg.from}->>${msg.to}: ${msg.label}`);
  }

  return { type: 'sequence', title, content: lines.join('\n') };
}

/**
 * Render a Mermaid diagram to an HTML string.
 */
export function renderMermaidHtml(diagram: MermaidDiagram): string {
  return `<!DOCTYPE html>
<html>
<head>
  <script src="https://cdn.jsdelivr.net/npm/mermaid/dist/mermaid.min.js"></script>
  <style>body { background: #010103; color: #fff; font-family: monospace; display: flex; justify-content: center; padding: 2rem; }</style>
</head>
<body>
  <div class="mermaid">
${diagram.content}
  </div>
  <script>mermaid.initialize({ startOnLoad: true, theme: 'dark' });</script>
</body>
</html>`;
}
