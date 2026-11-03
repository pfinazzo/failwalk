# Decisions

Why failwalk is built the way it is, in plain words. Each row names a decision, why it was made, and the code that carries it out. The [README](../README.md) has the overview and [SPEC.md](../SPEC.md) the design.

## The map

| Decision | Why | Code |
| --- | --- | --- |
| The map is one self-contained HTML file, written by `failwalk ui` from the JSON failwalk already writes, and opened straight from disk. | The people who need the map are engineers on a service, often on a machine with nothing installed beyond Node. One file opens with a double-click, attaches to a pull request, and is the same picture for everyone who opens it. A server to install, a dashboard to log in to, or a build step to run would each be one more reason not to look. The data goes inside the page as JSON, so the page never has to find its files again. Only Three.js comes from a CDN, pinned to one version, because bundling it would add 600 KB to every map and a build step to this repo. The cost: the page needs a connection the first time it opens. | [src/ui/render.ts](../src/ui/render.ts), [src/ui/template.html](../src/ui/template.html) |
| Rows are call sites and columns are failure modes. | The question an engineer brings to the map is "what happens at this line when the vendor fails?", and the line is what they can fix. A row per call site keeps every answer for one line together, and the file and line travel with it. The modes are the same six for every site, so they make steady columns, and a column read top to bottom answers the other question: "which lines die on a timeout?". The other way round, a row per mode, would scatter one line's answers across the board and give the engineer nothing to click that names a file. This is the same grid `failwalk run` prints; the map only adds the colour, the beams from the tests, and the click. | [src/ui/shape.ts](../src/ui/shape.ts), [src/run/report.ts](../src/run/report.ts) |
| A cell's colour comes from one lookup table on the verdict, and a verdict the table does not know is grey. | Four colours is as many as a reader keeps in their head: green coped, red uncaught, amber risk, grey nobody walked it. The lookup is one place to change when a verdict is added, and a new verdict the map has not heard of draws grey rather than throwing, so an older map still opens a newer run. | [src/ui/shape.ts](../src/ui/shape.ts) |
| The data shaping is a pure function from the three files to the scene, tested on its own; the page only draws. | The picture is only as right as the rows, columns and cells behind it, and those can be checked with a unit test in milliseconds. The drawing cannot. Keeping every decision about what a cell means out of the page means the browser check only has to show that the page renders and the walkthrough runs. | [src/ui/shape.ts](../src/ui/shape.ts), [tests/ui.test.ts](../tests/ui.test.ts) |
| The look, the greeting and the walkthrough are ported from the system map, not shared with it. | The system map is a skill that lives outside this repo. Depending on it would make failwalk's map break when the skill moves. Copying the pattern keeps the two pages feeling like one family while each repo stays whole on its own. | [src/ui/template.html](../src/ui/template.html) |

## Known gaps

Things found but not fixed yet. Each says what goes wrong today and what would close it.

| Gap | What goes wrong | What would close it |
| --- | --- | --- |
| Labels overlap when the board is seen from far away. | With many call sites in one file, two-line site labels sit on top of each other until the reader zooms in. | A label decluttering pass like the system map's, which nudges labels apart on screen each frame. |
| The page needs a connection the first time it opens. | Three.js is loaded from a CDN. Offline, the index and the panel still work, but the board is dark. | A `--bundle` flag that inlines Three.js into the page, at the cost of a bigger file. |
