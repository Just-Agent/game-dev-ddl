import fs from 'node:fs';

const items = JSON.parse(fs.readFileSync(new URL('../data/items.json', import.meta.url), 'utf8'));
const sources = JSON.parse(fs.readFileSync(new URL('../data/sources.json', import.meta.url), 'utf8'));
const errors = [];

if (!Array.isArray(items) || items.length === 0) errors.push('items.json must contain at least one item');
if (!sources || !Array.isArray(sources.sourceFamilies)) errors.push('sources.json missing sourceFamilies');

for (const item of items) {
  for (const key of ['id', 'title', 'deadline', 'url', 'source']) {
    if (!item[key]) errors.push(`${item.id || '<missing-id>'}: missing ${key}`);
  }
  if (Number.isNaN(Date.parse(item.deadline))) errors.push(`${item.id}: invalid deadline ${item.deadline}`);
  if (item.url && !/^https?:\/\//.test(item.url)) errors.push(`${item.id}: invalid url ${item.url}`);
  const text = JSON.stringify(item);
  if (/\?\?\?\?|�/.test(text)) errors.push(`${item.id}: contains mojibake placeholder`);
}

if (errors.length) {
  console.error(errors.join('\n'));
  process.exit(1);
}

console.log(`validated ${items.length} DDL items and ${sources.sourceFamilies.length} source families`);
