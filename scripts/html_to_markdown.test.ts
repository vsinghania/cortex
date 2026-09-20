/*
 * The converter, against the HTML shapes a real OneNote page turns out to use: a
 * paragraph per line, an id and a style on every element, an absolutely-positioned
 * wrapper div, and spacer paragraphs holding only a non-breaking space.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { HtmlToMarkdown } from '../src/lib/text/html_to_markdown.js';

const converter = HtmlToMarkdown.create();
const without_images = HtmlToMarkdown.create({ drop_images: true });

test('headings, emphasis and links convert', () => {
  const md = converter.convert('<h1>Title</h1><p>Some <b>bold</b> and <i>italic</i>.</p><p><a href="https://x.test">link</a></p>');

  assert.match(md, /^# Title/);
  assert.match(md, /\*\*bold\*\*/);
  assert.match(md, /\*italic\*/);
  assert.match(md, /\[link\]\(https:\/\/x\.test\)/);
});

test("OneNote's id and style attributes do not leak into the markdown", () => {
  const html = '<div id="div:{1}" style="position:absolute;left:48px"><p id="p:{2}" style="margin-top:0pt">Hello</p></div>';
  assert.equal(converter.convert(html), 'Hello');
});

test('spacer paragraphs are dropped rather than becoming blank lines', () => {
  const html = '<p>One</p><p>&nbsp;</p><p>   </p><p>Two</p>';
  assert.equal(converter.convert(html), 'One\n\nTwo');
});

test('no run of blank lines survives', () => {
  const html = '<p>One</p><p>&nbsp;</p><p>&nbsp;</p><p>&nbsp;</p><p>Two</p>';
  const md = converter.convert(html);

  assert.equal(/\n{3,}/.test(md), false);
  assert.equal(md, 'One\n\nTwo');
});

test('lists survive, nested ones included', () => {
  const md = converter.convert('<ul><li>a<ul><li>b</li></ul></li><li>c</li></ul>');

  // Turndown pads the marker (`-   a`), which is valid markdown and renders the same.
  assert.match(md, /^-\s+a$/m);
  assert.match(md, /^\s+-\s+b$/m);
  assert.match(md, /^-\s+c$/m);
});

test('tables convert, which is why the GFM plugin is loaded', () => {
  const md = converter.convert('<table><tr><th>H1</th><th>H2</th></tr><tr><td>a</td><td>b</td></tr></table>');

  assert.match(md, /\| H1 \| H2 \|/);
  assert.match(md, /\| a \| b \|/);
});

test('scripts and styles are dropped, not transcribed', () => {
  const md = converter.convert('<p>Before</p><script>alert(1)</script><style>p{color:red}</style><p>After</p>');

  assert.equal(md.includes('alert'), false);
  assert.equal(md.includes('color:red'), false);
  assert.equal(md, 'Before\n\nAfter');
});

test('images are kept by default and dropped when asked', () => {
  const html = '<p>See <img src="https://x.test/a.png" alt="a picture"> here</p>';

  assert.match(converter.convert(html), /!\[a picture\]\(https:\/\/x\.test\/a\.png\)/);
  const dropped = without_images.convert(html);
  assert.equal(dropped.includes('x.test'), false);
  assert.match(dropped, /See\s+here/);
});

test('empty and whitespace-only input convert to an empty string, not to junk', () => {
  assert.equal(converter.convert(''), '');
  assert.equal(converter.convert('   \n  '), '');
  assert.equal(converter.convert('<p>&nbsp;</p>'), '');
});

test('the output has no trailing spaces, which would read as hard line breaks', () => {
  const md = converter.convert('<p>One  </p><p>Two</p>');
  assert.equal(/[ \t]+$/m.test(md), false);
});
