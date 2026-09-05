import path from 'node:path';

const SHA1_THUMBPRINT = /^[0-9A-F]{40}$/;
// DigiCert's documented SignTool RFC 3161 endpoint uses HTTP.
// The timestamp response itself is cryptographically signed by the TSA.
const DEFAULT_TIMESTAMP_URL = 'http://timestamp.digicert.com';

function optionalText(value) {
  const trimmed = value?.trim();
  return trimmed || undefined;
}

export function resolveDesktopSigningConfiguration(environment = process.env) {
  const required = environment.WULFRAM_REQUIRE_SIGNED_DESKTOP === '1';
  const signToolPath = optionalText(environment.WULFRAM_SIGNTOOL_PATH);
  const rawThumbprint = optionalText(environment.WULFRAM_SIGNING_CERTIFICATE_SHA1);
  const configured = Boolean(signToolPath || rawThumbprint);
  if (!configured) {
    if (required) {
      throw new Error('This build requires Authenticode signing, but no SignTool path or certificate thumbprint was configured.');
    }
    return undefined;
  }
  if (!signToolPath || !rawThumbprint) {
    throw new Error('Authenticode signing requires both WULFRAM_SIGNTOOL_PATH and WULFRAM_SIGNING_CERTIFICATE_SHA1.');
  }
  const certificateThumbprint = rawThumbprint.replaceAll(/\s/g, '').toUpperCase();
  if (!SHA1_THUMBPRINT.test(certificateThumbprint)) {
    throw new Error('WULFRAM_SIGNING_CERTIFICATE_SHA1 must be a 40-character hexadecimal certificate thumbprint.');
  }
  const timestampUrl = optionalText(environment.WULFRAM_SIGNING_TIMESTAMP_URL) ?? DEFAULT_TIMESTAMP_URL;
  let parsedTimestamp;
  try {
    parsedTimestamp = new URL(timestampUrl);
  } catch {
    throw new Error('WULFRAM_SIGNING_TIMESTAMP_URL must be an absolute HTTP(S) URL.');
  }
  if (parsedTimestamp.protocol !== 'https:' && parsedTimestamp.protocol !== 'http:') {
    throw new Error('WULFRAM_SIGNING_TIMESTAMP_URL must use HTTP or HTTPS.');
  }
  return {
    certificateThumbprint,
    required,
    signToolPath: path.resolve(signToolPath),
    timestampUrl: parsedTimestamp.href,
  };
}
