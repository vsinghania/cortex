/*
 * The embedded Cortex logo: data URIs MCP clients can render, and the favicon both public
 * hosts serve.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { CortexIcons } from '../src/mcp/brand/cortex_icons.js';
import { FaviconController } from '../src/web-server/favicon/favicon.controller.js';

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function dataUriBytes(src: string, mime_type: string): Buffer {
  const prefix = `data:${mime_type};base64,`;
  assert.ok(src.startsWith(prefix), `expected a base64 ${mime_type} data URI`);
  return Buffer.from(src.slice(prefix.length), 'base64');
}

test('MCP icons are a 64px PNG and an SVG, as data URIs whose bytes match their declared type', () => {
  const [png, svg] = CortexIcons.forMcp();

  const png_bytes = dataUriBytes(png.src, 'image/png');
  assert.deepEqual(png_bytes.subarray(0, 8), PNG_SIGNATURE);
  assert.deepEqual([png_bytes.readUInt32BE(16), png_bytes.readUInt32BE(20)], [64, 64], 'IHDR width and height');
  assert.deepEqual(png.sizes, ['64x64']);

  const svg_text = dataUriBytes(svg.src, 'image/svg+xml').toString('utf8');
  assert.match(svg_text, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
  assert.doesNotMatch(svg_text, /<script|on\w+=/i, 'no executable content');
  assert.deepEqual(svg.sizes, ['any']);
});

test('the favicon is an ICO holding 32 and 48 px PNGs, served cacheable and cross-origin', async () => {
  const app = express();
  app.use(new FaviconController().getRouter());
  const server = createServer(app).listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  try {
    const res = await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/favicon.ico`);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('content-type'), 'image/x-icon');
    assert.equal(res.headers.get('cross-origin-resource-policy'), 'cross-origin');
    assert.match(res.headers.get('cache-control') ?? '', /^public, max-age=\d+$/);

    const ico = Buffer.from(await res.arrayBuffer());
    assert.deepEqual([ico.readUInt16LE(0), ico.readUInt16LE(2), ico.readUInt16LE(4)], [0, 1, 2], 'ICO header: icon type, two images');
    const sizes = [0, 1].map((i) => ico[6 + i * 16]);
    assert.deepEqual(sizes, [32, 48]);
    const first_offset = ico.readUInt32LE(6 + 12);
    assert.deepEqual(ico.subarray(first_offset, first_offset + 8), PNG_SIGNATURE);
  } finally {
    server.close();
  }
});
