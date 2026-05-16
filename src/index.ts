// Phase 1 entry point: read a slug from gbrain and print it
import { getPage } from './gbrain-client.ts';

const slug = process.argv[2] ?? 'wiki/projects/super-engine';

const page = await getPage(slug);
if (!page) {
  console.error(`Page not found: ${slug}`);
  process.exit(1);
}

console.log(`# ${page.title}\n`);
console.log(page.compiled_truth);
