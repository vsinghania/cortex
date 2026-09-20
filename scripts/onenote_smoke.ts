/*
 * Read-only probe of the Microsoft Graph OneNote API against a real connected account,
 * to settle the assumptions the sync design rests on before it is written:
 *
 *   1. does per-section page listing accept $filter and $orderby together?
 *   2. what does a page's HTML actually look like?
 *   3. how deep does section-group nesting go, and what names appear in it?
 *
 * Writes nothing, to Mongo or to OneNote. Page HTML is saved to a local file and only
 * its structure is printed, so private note content does not land in a terminal log.
 *
 *   npm run onenote:smoke
 */
import 'dotenv/config';
import { mkdirSync, writeFileSync } from 'node:fs';
import { MongooseOneNoteConnectionRepository } from '../src/onenote_svc/repositories/onenote_connection_repository.js';
import { OneNoteConnectionSvc } from '../src/onenote_svc/onenote_connection_svc.js';
import { MongooseConnectionManager } from '../src/db/mongo/mongoose_connection_manager.js';
import { DbNameResolver } from '../src/db/mongo/db_name_resolver.js';

const GRAPH = 'https://graph.microsoft.com/v1.0';
const OUT_DIR = process.env.ONENOTE_SMOKE_OUT ?? '/tmp/onenote-smoke';

type Json = Record<string, any>;

class Probe {
  private constructor(private readonly access_token: string) {}

  static async create(): Promise<Probe> {
    await MongooseConnectionManager.getInstance({
      host: process.env.MONGO_HOST ?? 'localhost',
      port: Number(process.env.MONGO_PORT ?? 27017)
    });
    const repo = await MongooseOneNoteConnectionRepository.create({ db: DbNameResolver.resolve('onenote') });
    const svc = await OneNoteConnectionSvc.create({ connection_repo: repo });

    // No user id to hand in: take whichever account is connected in this dev database.
    const any_connection = await (repo as any)['model'].findOne({}).lean();
    if (!any_connection) throw new Error('No OneNote connection in this database. Connect one in Settings first.');

    console.log(`connected account : ${any_connection.microsoft_email}`);
    console.log(`connection status : ${any_connection.status}\n`);
    return new Probe(await svc.getAccessToken(any_connection.user_id));
  }

  async get(path: string): Promise<{ status: number; body: Json }> {
    const resp = await fetch(path.startsWith('http') ? path : `${GRAPH}${path}`, {
      headers: { authorization: `Bearer ${this.access_token}` }
    });
    const text = await resp.text();
    try {
      return { status: resp.status, body: JSON.parse(text) };
    } catch {
      return { status: resp.status, body: { raw: text } };
    }
  }

  async getText(path: string): Promise<{ status: number; text: string }> {
    const resp = await fetch(`${GRAPH}${path}`, { headers: { authorization: `Bearer ${this.access_token}` } });
    return { status: resp.status, text: await resp.text() };
  }
}

/** Tag and attribute histogram, so the HTML's shape is visible without its content. */
class HtmlShape {
  static describe(html: string): { tags: Record<string, number>; attrs: Record<string, number> } {
    const tags: Record<string, number> = {};
    const attrs: Record<string, number> = {};
    for (const match of html.matchAll(/<([a-zA-Z][\w-]*)((?:\s[^>]*)?)>/g)) {
      const tag = match[1].toLowerCase();
      tags[tag] = (tags[tag] ?? 0) + 1;
      for (const attr of match[2].matchAll(/([a-zA-Z-]+)\s*=/g)) {
        const name = `${tag}@${attr[1].toLowerCase()}`;
        attrs[name] = (attrs[name] ?? 0) + 1;
      }
    }
    return { tags, attrs };
  }

  static top(counts: Record<string, number>, limit = 18): string {
    return Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit)
      .map(([k, v]) => `${k}:${v}`)
      .join('  ');
  }
}

async function main() {
  mkdirSync(OUT_DIR, { recursive: true });
  const probe = await Probe.create();

  // --- 1. notebooks -------------------------------------------------------
  const notebooks = await probe.get('/me/onenote/notebooks?$select=id,displayName,lastModifiedDateTime');
  console.log(`[notebooks] status ${notebooks.status}, count ${notebooks.body.value?.length ?? 0}`);
  for (const nb of notebooks.body.value ?? []) console.log(`   - ${nb.displayName}`);

  // --- 2. sections, and whether parent expansion works --------------------
  const sections = await probe.get(
    '/me/onenote/sections?$select=id,displayName&$expand=parentNotebook($select=id,displayName),parentSectionGroup($select=id,displayName)&$top=100'
  );
  const section_list = sections.body.value ?? [];
  console.log(`\n[sections] status ${sections.status}, count ${section_list.length}`);
  if (sections.status !== 200) console.log(`   error: ${JSON.stringify(sections.body).slice(0, 300)}`);
  const with_group = section_list.filter((s: Json) => s.parentSectionGroup);
  console.log(`   sections inside a section group: ${with_group.length}`);
  console.log(`   parentNotebook expanded: ${section_list.filter((s: Json) => s.parentNotebook).length}`);
  for (const s of section_list.slice(0, 8)) {
    console.log(`   - ${s.parentNotebook?.displayName ?? '?'} / ${s.parentSectionGroup?.displayName ?? '-'} / ${s.displayName}`);
  }

  // --- 3. section groups, to see nesting depth ----------------------------
  const groups = await probe.get('/me/onenote/sectionGroups?$select=id,displayName&$expand=parentSectionGroup($select=id,displayName)');
  console.log(`\n[sectionGroups] status ${groups.status}, count ${groups.body.value?.length ?? 0}`);
  const nested = (groups.body.value ?? []).filter((g: Json) => g.parentSectionGroup);
  console.log(`   section groups nested inside another: ${nested.length}`);

  if (section_list.length === 0) {
    console.log('\nNo sections; stopping before the page probes.');
    return;
  }

  // --- 4. THE KEY ONE: $filter + $orderby together on a section's pages ---
  const section_id = section_list[0].id;
  const since = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString();
  const combined =
    `/me/onenote/sections/${section_id}/pages` +
    `?$select=id,title,createdDateTime,lastModifiedDateTime,level,order,links` +
    `&$filter=lastModifiedDateTime gt ${since}&$orderby=lastModifiedDateTime asc&$top=5`;
  const filtered = await probe.get(combined);
  console.log(`\n[pages: $filter + $orderby together] status ${filtered.status}`);
  if (filtered.status === 200) {
    console.log(`   ✅ accepted, ${filtered.body.value?.length ?? 0} pages`);
    console.log(`   nextLink present: ${Boolean(filtered.body['@odata.nextLink'])}`);
    const first = filtered.body.value?.[0];
    if (first) {
      console.log(`   fields: ${Object.keys(first).join(', ')}`);
      console.log(`   links.oneNoteWebUrl present: ${Boolean(first.links?.oneNoteWebUrl?.href)}`);
      console.log(`   lastModifiedDateTime: ${first.lastModifiedDateTime}`);
    }
  } else {
    console.log(`   ❌ rejected: ${JSON.stringify(filtered.body).slice(0, 400)}`);
    const only_filter = await probe.get(
      `/me/onenote/sections/${section_id}/pages?$filter=lastModifiedDateTime gt ${since}&$top=5`
    );
    const only_order = await probe.get(
      `/me/onenote/sections/${section_id}/pages?$orderby=lastModifiedDateTime asc&$top=5`
    );
    console.log(`   $filter alone : ${only_filter.status}`);
    console.log(`   $orderby alone: ${only_order.status}`);
  }

  // --- 5. page content HTML ----------------------------------------------
  const any_pages = filtered.status === 200 ? filtered.body.value : (await probe.get(`/me/onenote/sections/${section_id}/pages?$top=5`)).body.value;
  const page = any_pages?.[0];
  if (!page) {
    console.log('\nNo pages in that section; stopping.');
    return;
  }

  const content = await probe.getText(`/me/onenote/pages/${page.id}/content?includeIDs=true`);
  const file = `${OUT_DIR}/page.html`;
  writeFileSync(file, content.text);
  const shape = HtmlShape.describe(content.text);
  console.log(`\n[page content] status ${content.status}, ${content.text.length} bytes → ${file}`);
  console.log(`   tags : ${HtmlShape.top(shape.tags)}`);
  console.log(`   attrs: ${HtmlShape.top(shape.attrs)}`);
  console.log(`   has <img>: ${/\<img/i.test(content.text)}   has <object>: ${/\<object/i.test(content.text)}`);
  console.log(`   has <table>: ${/\<table/i.test(content.text)}   absolutely positioned divs: ${(content.text.match(/position:absolute/g) ?? []).length}`);

  const resource = content.text.match(/https:\/\/graph\.microsoft\.com\/[^"']*resources\/[^"']*/);
  console.log(`   resource URL shape: ${resource ? resource[0].replace(/resources\/[^/]+/, 'resources/<id>') : 'none in this page'}`);
}

main()
  .catch((err) => {
    console.error(`\nsmoke failed: ${(err as Error).message}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await (await MongooseConnectionManager.getInstance()).disconnectAll();
    setTimeout(() => process.exit(process.exitCode ?? 0), 250).unref();
  });
