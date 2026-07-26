export interface Theme {
  name: string;
  colors: {
    primary: string;
    secondary: string;
    accent: string;
    success: string;
    warning: string;
    error: string;
    muted: string;
    subtle: string;
    text: string;
    bg: string;
    surface: string;
    border: string;
    promptBorder: string;
    userMessage: string;
    toolRunning: string;
    link: string;
  };
  chars: {
    prompt: string;
    tool: string;
    bullet: string;
    separator: string;
    ellipsis: string;
    spinner: string[];
  };
}

// ANSI escape sequences for terminal colors.
// Using 256-color codes for broad compatibility.
const R = '\x1b[0m';     // reset all attributes
const B = '\x1b[1m';     // bold
const D = '\x1b[2m';     // dim
const I = '\x1b[3m';     // italic

export const theme: Theme = {
  name: 'kairo-dark',
  colors: {
    primary: '\x1b[38;5;51m',     // cyan — kairo brand
    secondary: '\x1b[38;5;141m',  // soft purple
    accent: '\x1b[38;5;208m',     // orange — tool calls
    success: '\x1b[38;5;108m',    // green
    warning: '\x1b[38;5;221m',    // amber
    error: '\x1b[38;5;174m',      // soft red
    muted: '\x1b[38;5;245m',      // gray — secondary text
    subtle: '\x1b[38;5;238m',     // dim gray — borders
    text: '\x1b[38;5;252m',       // near-white
    bg: '\x1b[48;5;0m',           // pure black bg
    surface: '\x1b[48;5;236m',    // subtle surface
    border: '\x1b[38;5;240m',     // visible border
    promptBorder: '\x1b[38;5;240m', // input border
    userMessage: '\x1b[38;5;252m',  // user text color
    toolRunning: '\x1b[38;5;221m',  // amber for running tools
    link: '\x1b[38;5;75m',          // blue for links
  },
  chars: {
    prompt: '\u276f',         // ❯
    tool: '\u250a',           // ┊
    bullet: '\u2022',         // •
    separator: '\u2500',      // ─
    ellipsis: '\u2026',       // …
    spinner: ['\u2801', '\u2802', '\u2804', '\u2808', '\u2810', '\u2820', '\u2840', '\u2880'],
  },
};

export { R as reset, B as bold, D as dim, I as italic };

export function getWidth(): number {
  return process.stdout.columns || 80;
}
