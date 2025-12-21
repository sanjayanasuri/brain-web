// Jest setup file
// Mock Next.js environment
global.Headers = Headers || class Headers {
  constructor(init) {
    this._headers = {};
    if (init) {
      Object.entries(init).forEach(([key, value]) => {
        this._headers[key.toLowerCase()] = value;
      });
    }
  }
  get(name) {
    return this._headers[name.toLowerCase()];
  }
  set(name, value) {
    this._headers[name.toLowerCase()] = value;
  }
  has(name) {
    return name.toLowerCase() in this._headers;
  }
};

