import assert from 'node:assert/strict';
import test from 'node:test';
import { EmailLayout } from '../src/mailer_svc/templates/email_layout.js';

test('escapeHtml neutralizes all five HTML-significant characters', () => {
  assert.equal(EmailLayout.escapeHtml(`<a href="x">Tom & Jerry's</a>`), '&lt;a href=&quot;x&quot;&gt;Tom &amp; Jerry&#39;s&lt;/a&gt;');
});

test('paragraph escapes its text', () => {
  assert.ok(EmailLayout.paragraph('<script>').includes('&lt;script&gt;'));
});

test('button escapes the label and cannot break out of the href attribute', () => {
  const html = EmailLayout.button({ href: 'https://app.example.com/x?a=1&b="2"', label: '<b>Go</b>' });
  assert.ok(html.includes('href="https://app.example.com/x?a=1&amp;b=&quot;2&quot;"'));
  assert.ok(html.includes('&lt;b&gt;Go&lt;/b&gt;'));
});

test('button refuses anything but absolute http(s) links', () => {
  assert.throws(() => EmailLayout.button({ href: 'javascript:alert(1)', label: 'x' }));
  assert.throws(() => EmailLayout.button({ href: '/reset-password', label: 'x' }));
});

test('wrap escapes the title and preheader but embeds body_html as-is', () => {
  const html = EmailLayout.wrap({
    title: 'Hi <you>',
    preheader: 'Preview & more',
    body_html: '<p id="body">trusted</p>'
  });
  assert.ok(html.includes('Hi &lt;you&gt;'));
  assert.ok(html.includes('Preview &amp; more'));
  assert.ok(html.includes('<p id="body">trusted</p>'));
});
