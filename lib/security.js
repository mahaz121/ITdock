import path from 'path';

const SIGNATURES = {
  'application/pdf': buffer => buffer.subarray(0, 5).toString('ascii') === '%PDF-',
  'image/png': buffer => buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  'image/jpeg': buffer => buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff,
};

const EXTENSIONS = {
  'application/pdf': 'pdf',
  'image/png': 'png',
  'image/jpeg': 'jpg',
};

export function validateUploadedFile(file, bytes, { allowedTypes, maxSize }) {
  if (!file || typeof file === 'string') throw new Error('A file is required');
  const buffer = Buffer.from(bytes);
  if (!buffer.length) throw new Error('The uploaded file is empty');
  if (buffer.length > maxSize) throw new Error(`File exceeds the ${Math.ceil(maxSize / 1024 / 1024)}MB limit`);
  const mime = String(file.type || '').toLowerCase();
  if (!allowedTypes.includes(mime) || !SIGNATURES[mime]?.(buffer)) {
    throw new Error('File content does not match an allowed file type');
  }
  return { buffer, mime, extension: EXTENSIONS[mime] };
}

export function safeUploadPath(uploadDir, storedFilename) {
  const name = String(storedFilename || '');
  if (!/^[a-zA-Z0-9_-]+\.(pdf|png|jpg)$/.test(name)) throw new Error('Invalid stored filename');
  const root = path.resolve(uploadDir);
  const resolved = path.resolve(root, name);
  if (!resolved.startsWith(`${root}${path.sep}`)) throw new Error('Invalid upload path');
  return resolved;
}

export function normalizeJson(value, depth = 0) {
  if (depth > 12) throw new Error('Request body is too deeply nested');
  if (typeof value === 'string') {
    const normalized = value.normalize('NFKC').trim();
    if (normalized.length > 20000) throw new Error('A string field exceeds the maximum length');
    return normalized;
  }
  if (Array.isArray(value)) {
    if (value.length > 5000) throw new Error('An array field exceeds the maximum length');
    return value.map(item => normalizeJson(item, depth + 1));
  }
  if (value && typeof value === 'object') {
    const output = {};
    const entries = Object.entries(value);
    if (entries.length > 1000) throw new Error('An object contains too many fields');
    for (const [key, child] of entries) {
      if (key.startsWith('$') || key.includes('.') || ['__proto__', 'prototype', 'constructor'].includes(key)) {
        throw new Error('Request body contains a prohibited field name');
      }
      output[key] = normalizeJson(child, depth + 1);
    }
    return output;
  }
  return value;
}

export function assertRequestSize(request, maxBytes = 1024 * 1024) {
  const declared = Number.parseInt(request.headers.get('content-length') || '0', 10);
  if (Number.isFinite(declared) && declared > maxBytes) throw new Error('Request body is too large');
}

export function isSafeHttpUrl(value) {
  if (!value) return true;
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:';
  } catch {
    return false;
  }
}
