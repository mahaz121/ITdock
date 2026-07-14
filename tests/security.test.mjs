import assert from 'node:assert/strict';
import test from 'node:test';

process.env.JWT_SECRET = 'd5c69e6c8c2e4966b58b30360df224b79fbf1474088d4bd792728c8878bfbd9e';

const security = await import('../lib/security.js');
const auth = await import('../lib/auth.js');

test('normalization rejects MongoDB operator and prototype keys', () => {
  assert.throws(() => security.normalizeJson({ '$where': 'return true' }), /prohibited/);
  assert.throws(() => security.normalizeJson({ constructor: { prototype: {} } }), /prohibited/);
  assert.equal(security.normalizeJson('  test\u212A  '), 'testK');
});

test('upload validation checks content signatures rather than declared MIME alone', () => {
  const fakePdf = { type: 'application/pdf' };
  assert.throws(() => security.validateUploadedFile(fakePdf, Buffer.from('<script>'), { allowedTypes: ['application/pdf'], maxSize: 1024 }), /content/);
  const valid = security.validateUploadedFile(fakePdf, Buffer.from('%PDF-1.7\n'), { allowedTypes: ['application/pdf'], maxSize: 1024 });
  assert.equal(valid.extension, 'pdf');
});

test('upload paths reject traversal and unknown extensions', () => {
  assert.throws(() => security.safeUploadPath('/srv/uploads', '../secret.pdf'), /Invalid/);
  assert.throws(() => security.safeUploadPath('/srv/uploads', 'payload.html'), /Invalid/);
  assert.match(security.safeUploadPath('/srv/uploads', 'audit_123.pdf'), /audit_123\.pdf$/);
});

test('external URLs are limited to HTTP and HTTPS', () => {
  assert.equal(security.isSafeHttpUrl('https://example.com/path'), true);
  assert.equal(security.isSafeHttpUrl('javascript:alert(1)'), false);
  assert.equal(security.isSafeHttpUrl('data:text/html,boom'), false);
});

test('password hashes use Argon2id and JWT validation constrains claims', async () => {
  const hash = await auth.hashPassword('Correct-Horse-Battery-7');
  assert.match(hash, /^\$argon2id\$/);
  assert.equal(await auth.verifyPassword('Correct-Horse-Battery-7', hash), true);
  assert.equal(await auth.verifyPassword('wrong', hash), false);
  const token = auth.generateToken({ id: 'u1', email: 'a@example.com', roles: ['admin'], name: 'A' });
  const decoded = auth.verifyToken(token);
  assert.equal(decoded.iss, 'itdock');
  assert.equal(decoded.aud, 'itdock-api');
  assert.ok(decoded.exp - decoded.iat <= 30 * 24 * 60 * 60);
  assert.ok(decoded.exp - decoded.iat >= 29 * 24 * 60 * 60);
});
