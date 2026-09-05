import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';

import { resolveDesktopSigningConfiguration } from '../tools/desktop-signing.mjs';

void test('desktop signing remains optional for local developer builds', () => {
  assert.equal(resolveDesktopSigningConfiguration({}), undefined);
});

void test('tag-style required signing fails closed without complete configuration', () => {
  assert.throws(
    () => resolveDesktopSigningConfiguration({ WULFRAM_REQUIRE_SIGNED_DESKTOP: '1' }),
    /requires Authenticode signing/,
  );
  assert.throws(
    () => resolveDesktopSigningConfiguration({ WULFRAM_SIGNTOOL_PATH: 'signtool.exe' }),
    /requires both/,
  );
});

void test('desktop signing validates and normalizes its public certificate identity', () => {
  const configuration = resolveDesktopSigningConfiguration({
    WULFRAM_REQUIRE_SIGNED_DESKTOP: '1',
    WULFRAM_SIGNTOOL_PATH: '.\\sdk\\signtool.exe',
    WULFRAM_SIGNING_CERTIFICATE_SHA1: 'aa bb cc dd ee ff 00 11 22 33 44 55 66 77 88 99 aa bb cc dd',
    WULFRAM_SIGNING_TIMESTAMP_URL: 'https://timestamp.example.test',
  });
  assert.deepEqual(configuration, {
    certificateThumbprint: 'AABBCCDDEEFF00112233445566778899AABBCCDD',
    required: true,
    signToolPath: path.resolve('.\\sdk\\signtool.exe'),
    timestampUrl: 'https://timestamp.example.test/',
  });
  assert.throws(
    () => resolveDesktopSigningConfiguration({
      WULFRAM_SIGNTOOL_PATH: 'signtool.exe',
      WULFRAM_SIGNING_CERTIFICATE_SHA1: 'not-a-thumbprint',
    }),
    /40-character hexadecimal/,
  );
  assert.throws(
    () => resolveDesktopSigningConfiguration({
      WULFRAM_SIGNTOOL_PATH: 'signtool.exe',
      WULFRAM_SIGNING_CERTIFICATE_SHA1: 'A'.repeat(40),
      WULFRAM_SIGNING_TIMESTAMP_URL: 'file:///unsafe',
    }),
    /must use HTTP or HTTPS/,
  );
});
