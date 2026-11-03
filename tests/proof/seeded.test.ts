import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { applySeed, type Seed } from "../../src/proof/applySeed";
import { SAMPLE_API } from "../helpers";
import { SEED_NAMES, SEEDS } from "./seeds";
import { cellsOf, copySampleApp, describeSite, removeCopy, walkCopy, type SampleCopy, type Walk } from "./walk";

/** One seed's fresh copy and the walk over it. */
type SeededWalk = { seed: Seed; copy: SampleCopy; walk: Walk };

/** The sample-app files the seeds edit, read before anything runs, to show the originals were never touched. */
const ORIGINALS = SEED_NAMES.reduce<Record<string, string>>(
  (acc, name) => ({ ...acc, [SEEDS[name].file]: fs.readFileSync(path.join(SAMPLE_API, SEEDS[name].file), "utf8") }),
  {},
);

/**
 * Copies the sample app, plants one seed in the copy and walks it.
 *
 * @param params.seed - the seed to plant
 * @returns the seed, its copy and the walk
 */
const walkSeeded = async ({ seed }: { seed: Seed }): Promise<SeededWalk> => {
  const copy = copySampleApp();
  const target = path.join(copy.root, seed.file);
  fs.writeFileSync(target, applySeed({ text: fs.readFileSync(target, "utf8"), seed }));
  return { seed, copy, walk: await walkCopy({ copy }) };
};

/** The unseeded walk and the three seeded ones. All four copies run at once; each is its own folder and process tree. */
let clean: { copy: SampleCopy; walk: Walk };
let seeded: Record<string, SeededWalk>;

beforeAll(async () => {
  const cleanCopy = copySampleApp();
  const [cleanWalk, ...seededWalks] = await Promise.all([walkCopy({ copy: cleanCopy }), ...SEED_NAMES.map((name) => walkSeeded({ seed: SEEDS[name] }))]);
  clean = { copy: cleanCopy, walk: cleanWalk };
  seeded = seededWalks.reduce<Record<string, SeededWalk>>((acc, entry) => ({ ...acc, [entry.seed.name]: entry }), {});
}, 240_000); // Four full walks of the sample app at once, about 15 seconds on a laptop, far more under a busy CI.

afterAll(() => {
  [clean?.copy, ...Object.values(seeded ?? {}).map(({ copy }) => copy)].filter(Boolean).forEach((copy) => removeCopy({ copy }));
});

describe("the seeded-bug proof (criteria 2 to 5)", () => {
  test("every target site is clean before seeding: in the inventory, without the seed's check, with no RISK and no CRASH cell", () => {
    SEED_NAMES.forEach((name) => {
      const { site, check } = SEEDS[name];
      const record = clean.walk.report.inventory.sites.find(({ id }) => id === site);
      expect(record, `${site} is not in the unseeded inventory`).toBeDefined();
      expect(record?.checks, `${site} already fires ${check} before seeding`).not.toContain(check);
      const cells = cellsOf({ report: clean.walk.report, site });
      expect(cells.length, `${site} has no cells in the unseeded run`).toBeGreaterThan(0);
      const dirty = cells.filter(({ verdict }) => verdict === "RISK" || verdict === "CRASH");
      expect(dirty, `${site} is not clean before seeding:\n${describeSite({ report: clean.walk.report, site })}`).toEqual([]);
    });
  });

  test.each(SEED_NAMES)("failwalk finds the seed %s: a RISK cell at the expected site naming the check", (name) => {
    const { seed, walk } = seeded[name];
    const found = cellsOf({ report: walk.report, site: seed.site }).filter(({ verdict, checks }) => verdict === "RISK" && checks.includes(seed.check));
    const miss = `Seed "${seed.name}" was missed. Expected a RISK cell at ${seed.site} with the check ${seed.check}. failwalk reported for that site:\n${describeSite({ report: walk.report, site: seed.site })}`;
    expect(found.length, miss).toBeGreaterThan(0);
    expect(walk.report.inventory.sites.find(({ id }) => id === seed.site)?.checks, miss).toContain(seed.check);
  });

  test("each seeded walk exits 0 and plants exactly one more fired check than the clean walk at its site", () => {
    SEED_NAMES.forEach((name) => {
      const { seed, walk } = seeded[name];
      expect(walk.status, `failwalk run on the ${name} copy exited ${walk.status}:\n${walk.stderr.slice(-2000)}`).toBe(0);
      const before = clean.walk.report.inventory.sites.find(({ id }) => id === seed.site)?.checks ?? [];
      const after = walk.report.inventory.sites.find(({ id }) => id === seed.site)?.checks ?? [];
      expect([...after].sort()).toEqual([...before, seed.check].sort());
    });
  });

  test("a miss message is built from the report: every mode's verdict and checks for the site, or the sites the file does have", () => {
    const site = SEEDS["swallowed-catch"].site;
    const lines = describeSite({ report: clean.walk.report, site }).split("\n");
    expect(lines).toHaveLength(clean.walk.report.plan.modes.length);
    expect(lines).toContain("  timeout: HANG, checks []");
    expect(lines).toContain("  malformed: PASS, checks []");
    expect(describeSite({ report: seeded["swallowed-catch"].walk.report, site })).toContain("  500: RISK, checks [swallowed-catch]");
    expect(describeSite({ report: clean.walk.report, site: "database.update@controllers/subscriptions.js:999" })).toBe(
      `  no call site with that id in the inventory; the sites in controllers/subscriptions.js are: ${clean.walk.report.inventory.sites
        .filter(({ file }) => file === "controllers/subscriptions.js")
        .map(({ id }) => id)
        .join(", ")}`,
    );
  });

  test("the seeds edited only their copies: the files under examples/sample-api are unchanged", () => {
    Object.entries(ORIGINALS).forEach(([file, text]) => expect(fs.readFileSync(path.join(SAMPLE_API, file), "utf8")).toBe(text));
    Object.values(seeded).forEach(({ seed, copy }) => expect(fs.readFileSync(path.join(copy.root, seed.file), "utf8")).toContain(seed.after));
  });
});

describe("applySeed (criterion 6)", () => {
  const seed: Seed = { ...SEEDS["swallowed-catch"], before: "b", after: "B" };

  test("replaces the one occurrence and leaves the input untouched", () => {
    const text = "abc";
    expect(applySeed({ text, seed })).toBe("aBc");
    expect(text).toBe("abc");
  });

  test("throws, naming the seed and the count, when before is absent or occurs twice", () => {
    expect(() => applySeed({ text: "xyz", seed })).toThrow('Seed "swallowed-catch": its before text occurs 0 times');
    expect(() => applySeed({ text: "bab", seed })).toThrow("occurs 2 times");
  });

  test("every row's before occurs exactly once in its clean file, and its after differs", () => {
    SEED_NAMES.forEach((name) => {
      const row = SEEDS[name];
      const text = ORIGINALS[row.file];
      expect(text.split(row.before).length, `${name}: before text`).toBe(2);
      expect(applySeed({ text, seed: row })).not.toBe(text);
    });
  });
});
