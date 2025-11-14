// Jest setup file to handle ES module compatibility

// Mock import.meta for Jest environment
global.mockImportMeta = {
  url: 'file:///mock/path/to/file.js'
};
