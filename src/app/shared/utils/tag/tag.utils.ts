export function generateTagFromFileName(fileName: string): string {
  // Get the base name without the extension
  const baseName = fileName.includes('.') ? fileName.substring(0, fileName.lastIndexOf('.')) : fileName;

  // Convert to lowercase
  return baseName.toLowerCase()
    // Replace spaces and dots with a dash, but keep underscores
    .replace(/[\s.]+/g, '-')
    // Remove any characters that are not alphanumeric, a dash, or an underscore
    .replace(/[^a-z0-9\-_]/g, '')
    // Trim leading/trailing dashes or underscores
    .replace(/^[-_]+|[-_]+$/g, '');
}
