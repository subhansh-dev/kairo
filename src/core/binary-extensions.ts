/**
 * Binary extensions — identify binary files by extension.
 */

const BINARY_EXTENSIONS = new Set([
  // Images
  '.png', '.jpg', '.jpeg', '.gif', '.bmp', '.ico', '.webp', '.svg', '.tiff', '.tif',
  // Audio
  '.mp3', '.wav', '.ogg', '.flac', '.aac', '.wma', '.m4a',
  // Video
  '.mp4', '.avi', '.mkv', '.mov', '.wmv', '.flv', '.webm',
  // Archives
  '.zip', '.tar', '.gz', '.bz2', '.xz', '.7z', '.rar',
  // Documents
  '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx',
  // Executables
  '.exe', '.dll', '.so', '.dylib', '.bin', '.dat',
  // Fonts
  '.ttf', '.otf', '.woff', '.woff2', '.eot',
  // Database
  '.sqlite', '.db', '.mdb',
  // Other
  '.pyc', '.pyo', '.class', '.o', '.obj', '.wasm',
]);

/**
 * Check if a file is likely binary based on its extension.
 */
export function isBinaryFile(filePath: string): boolean {
  const ext = getExtension(filePath);
  return BINARY_EXTENSIONS.has(ext.toLowerCase());
}

/**
 * Get the file extension (including the dot).
 */
export function getExtension(filePath: string): string {
  const lastDot = filePath.lastIndexOf('.');
  if (lastDot === -1) return '';
  return filePath.slice(lastDot);
}

/**
 * Check if a file is a text file (not binary).
 */
export function isTextFile(filePath: string): boolean {
  return !isBinaryFile(filePath);
}

/**
 * Get a human-readable file type description.
 */
export function getFileTypeDescription(filePath: string): string {
  const ext = getExtension(filePath).toLowerCase();
  const types: Record<string, string> = {
    '.ts': 'TypeScript', '.tsx': 'TypeScript React', '.js': 'JavaScript', '.jsx': 'JavaScript React',
    '.py': 'Python', '.rb': 'Ruby', '.go': 'Go', '.rs': 'Rust', '.java': 'Java',
    '.c': 'C', '.cpp': 'C++', '.h': 'Header', '.cs': 'C#',
    '.json': 'JSON', '.yaml': 'YAML', '.yml': 'YAML', '.toml': 'TOML',
    '.md': 'Markdown', '.txt': 'Text', '.html': 'HTML', '.css': 'CSS',
    '.sh': 'Shell', '.bash': 'Bash', '.zsh': 'Zsh',
    '.sql': 'SQL', '.graphql': 'GraphQL', '.proto': 'Protocol Buffers',
    '.png': 'PNG Image', '.jpg': 'JPEG Image', '.gif': 'GIF Image',
    '.pdf': 'PDF Document', '.svg': 'SVG Image',
  };
  return types[ext] || 'File';
}
