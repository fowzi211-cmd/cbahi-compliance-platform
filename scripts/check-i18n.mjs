// Fails when the Arabic and English message catalogues do not have exactly the same keys,
// or when an ICU placeholder like {milestone} exists in one language but not the other.
import { readFileSync } from "node:fs";

const load = (locale) => JSON.parse(readFileSync(`messages/${locale}.json`, "utf8"));

function flatten(object, prefix = "", out = new Map()) {
  for (const [key, value] of Object.entries(object)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === "object") flatten(value, path, out);
    else out.set(path, String(value));
  }
  return out;
}

const placeholders = (text) =>
  [...text.matchAll(/\{\s*([A-Za-z_][\w]*)/g)]
    .map((match) => match[1])
    .sort()
    .join(",");

const ar = flatten(load("ar"));
const en = flatten(load("en"));
const problems = [];

for (const key of ar.keys()) if (!en.has(key)) problems.push(`missing in en: ${key}`);
for (const key of en.keys()) if (!ar.has(key)) problems.push(`missing in ar: ${key}`);
for (const [key, text] of ar) {
  if (en.has(key) && placeholders(text) !== placeholders(en.get(key))) {
    problems.push(`placeholders differ for ${key}`);
  }
  if (!text.trim() || (en.has(key) && !en.get(key).trim())) problems.push(`empty text: ${key}`);
}

if (problems.length > 0) {
  console.error(`i18n check failed:\n  ${problems.join("\n  ")}`);
  process.exit(1);
}
console.log(`i18n check passed: ${ar.size} keys in ar and en.`);
