import fs from 'node:fs';

async function globalGameJamAdapter() {
  return {
    source: "Global Game Jam",
    url: "https://globalgamejam.org",
    items: [],
    note: 'TODO: implement parser for Global Game Jam; keep data/items.json as curated fallback until parser is verified.'
  };
}

async function itchIoJamsAdapter() {
  return {
    source: "itch.io Jams",
    url: "https://itch.io/jams",
    items: [],
    note: 'TODO: implement parser for itch.io Jams; keep data/items.json as curated fallback until parser is verified.'
  };
}

async function igfAdapter() {
  return {
    source: "Independent Games Festival",
    url: "https://igf.com",
    items: [],
    note: 'TODO: implement parser for Independent Games Festival; keep data/items.json as curated fallback until parser is verified.'
  };
}

async function unityAdapter() {
  return {
    source: "Unity Challenges",
    url: "https://unity.com",
    items: [],
    note: 'TODO: implement parser for Unity Challenges; keep data/items.json as curated fallback until parser is verified.'
  };
}

const adapters = [globalGameJamAdapter, itchIoJamsAdapter, igfAdapter, unityAdapter];
const existingItemsUrl = new URL('../data/items.json', import.meta.url);
const existingItems = JSON.parse(fs.readFileSync(existingItemsUrl, 'utf8'));
const reports = [];

for (const adapter of adapters) {
  reports.push(await adapter());
}

const harvestedItems = reports.flatMap(report => report.items);
if (harvestedItems.length > 0) {
  fs.writeFileSync(existingItemsUrl, JSON.stringify(harvestedItems, null, 2) + '\n', 'utf8');
  console.log(`crawler wrote ${harvestedItems.length} fetched items`);
} else {
  console.log(`crawler adapters ran; no verified fetched items yet, preserving ${existingItems.length} curated items`);
}

fs.writeFileSync(new URL('../data/crawl-report.json', import.meta.url), JSON.stringify({
  generatedAt: new Date().toISOString(),
  topicId: "game-dev-ddl",
  adapters: reports
}, null, 2) + '\n', 'utf8');
