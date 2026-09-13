import { writeFile, rename } from "node:fs/promises";
import { fetchImdbCharts } from "../lib/imdb-source.mjs";

const snapshot = await fetchImdbCharts();
const output = new URL("../data/imdb-top250.json", import.meta.url);
await writeFile(
  new URL("../data/imdb-top250.json.tmp", import.meta.url),
  JSON.stringify(snapshot, null, 2) + "\n",
);
await rename(new URL("../data/imdb-top250.json.tmp", import.meta.url), output);
console.log(
  "Saved 250 movies and 250 TV shows, preserving archive chart order. Review dates and diff before publishing.",
);
