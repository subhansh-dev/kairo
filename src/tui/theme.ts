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

const R = '\x1b[0m';
const B = '\x1b[1m';
const D = '\x1b[2m';
const I = '\x1b[3m';

export const theme: Theme = {
  name: 'kairo-dark',
  colors: {
    primary: '\x1b[38;2;0;204;204m',    // cyan — kairo brand
    secondary: '\x1b[38;2;177;185;249m',  // soft purple — like claude's permission
    accent: '\x1b[38;2;215;119;87m',     // claude orange — tool calls
    success: '\x1b[38;2;78;186;101m',    // green
    warning: '\x1b[38;2;255;193;7m',     // amber
    error: '\x1b[38;2;255;107;128m',     // soft red
    muted: '\x1b[38;2;153;153;153m',     // gray — secondary text
    subtle: '\x1b[38;2;80;80;80m',       // dim gray — borders
    text: '\x1b[38;2;230;230;230m',      // near-white
    bg: '\x1b[48;2;1;1;3m',              // pure black bg
    surface: '\x1b[48;2;12;12;16m',       // subtle surface
    border: '\x1b[38;2;60;60;68m',       // visible border
    promptBorder: '\x1b[38;2;80;80;88m', // input border
    userMessage: '\x1b[38;2;180;180;190m', // user text color
    toolRunning: '\x1b[38;2;255;193;7m', // amber for running tools
    link: '\x1b[38;2;0;180;255m',        // blue for links
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
