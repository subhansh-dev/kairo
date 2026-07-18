/**
 * File system module — file access, search, and code navigation.
 *
 */

export {
  FileSystemAdapter,
  LocalFileSystemAdapter,
  FileInfo,
  DirEntry,
} from './adapter';
export {
  ExtFsNode,
  listDirRecursive,
  readFileSafe,
  safeStat,
  isBinaryFile,
} from './ext_fs';
export {
  ClientFs,
  ClientFsNode,
  ClientFsListRequest,
  ClientFsListResponse,
  ClientFsReadFileRequest,
  ClientFsReadFileResponse,
  ClientFsStatRequest,
  ClientFsStatResponse,
} from './client_fs';
export {
  CodebaseIndex,
  CodebaseIndexOptions,
  IndexedFile,
  SearchResult,
  Definition,
  Reference,
} from './codebase_index';
// Content search is in engine/content_search.ts
