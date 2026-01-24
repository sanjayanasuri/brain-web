// Jest setup file
// Mock Next.js environment
const { TextDecoder, TextEncoder } = require('util');

global.TextDecoder = global.TextDecoder || TextDecoder;
global.TextEncoder = global.TextEncoder || TextEncoder;

const { Headers, Request, Response } = require('undici');

global.Headers = global.Headers || Headers;
global.Request = global.Request || Request;
global.Response = global.Response || Response;

// Mock window.getSelection for SelectableText tests (jsdom environment)
if (typeof window !== 'undefined') {
  const createMockSelection = () => {
    const mockSelection = {
      toString: jest.fn(() => ''),
      rangeCount: 0,
      removeAllRanges: jest.fn(),
      addRange: jest.fn(),
      getRangeAt: jest.fn(() => ({
        getBoundingClientRect: () => ({ top: 0, left: 0, width: 0, height: 0 }),
        commonAncestorContainer: document.body,
        startContainer: document.body,
        startOffset: 0,
        endContainer: document.body,
        endOffset: 0,
      })),
    };
    return mockSelection;
  };
  
  Object.defineProperty(window, 'getSelection', {
    writable: true,
    value: jest.fn(() => createMockSelection()),
  });
}

// Mock localStorage
const localStorageMock = {
  getItem: jest.fn(() => 'test-token'),
  setItem: jest.fn(),
  removeItem: jest.fn(),
  clear: jest.fn(),
};
if (typeof window !== 'undefined') {
  Object.defineProperty(window, 'localStorage', {
    value: localStorageMock,
    writable: true,
  });
}
global.localStorage = localStorageMock;

// Mock fetch globally (can be overridden in individual tests)
const defaultFetchResponse = {
  ok: false,
  status: 404,
  json: async () => null,
  text: async () => '',
};

let fetchMock = jest.fn().mockResolvedValue(defaultFetchResponse);

Object.defineProperty(global, 'fetch', {
  configurable: true,
  enumerable: true,
  get() {
    return fetchMock;
  },
  set(value) {
    fetchMock = value || jest.fn();
    if (typeof fetchMock.mockResolvedValue === 'function') {
      fetchMock.mockResolvedValue(defaultFetchResponse);
    }
  },
});

global.fetch = fetchMock;

// Mock environment variables
process.env.NEXT_PUBLIC_API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://127.0.0.1:8000';

// Mock scrollIntoView for jsdom
if (typeof window !== 'undefined' && typeof HTMLElement !== 'undefined') {
  HTMLElement.prototype.scrollIntoView = jest.fn();
}
