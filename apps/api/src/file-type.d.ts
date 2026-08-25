declare module 'file-type' {
  interface FileTypeResult {
    ext: string;
    mime: string;
  }
  function fileTypeFromBuffer(buffer: Buffer | Uint8Array): Promise<FileTypeResult | undefined>;
  export { fileTypeFromBuffer };
}
