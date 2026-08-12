/** The giant dot-matrix "Gather" at the foot of the landing page.
 *
 *  Ten SVG paths, one per row of dots, ported from the prototype's own
 *  `renderVals`. It is drawn rather than set because the letterforms are dots on
 *  a grid — the same three-dots-becoming-one idea as the logo mark, at the size
 *  of the viewport — and because the bottom half is the top half mirrored, which
 *  is a rule, not a glyph.
 *
 *  Deterministic, so it is computed once at module load and never recomputed.
 */

/** `#` is a dot, `.` is a gap. Rows are read top to bottom. */
const FACES: Readonly<Record<string, readonly string[]>> = {
  G: [".####.", "#....#", "#.....", "#..###", "#....#", "#....#", ".####."],
  a: [".###.", "....#", ".####", "#...#", ".####"],
  t: [".#..", ".#..", "####", ".#..", ".#..", ".#..", "..##"],
  h: ["#....", "#....", "#.##.", "##..#", "#...#", "#...#", "#...#"],
  e: [".###.", "#...#", "#####", "#....", ".###."],
  r: ["#.##", "##..", "#...", "#...", "#..."],
};

const ROWS = 10;
const CELL = 10;
const RADIUS = 4.3;
/** Rows 4 and below are mirrored into the lower half; 13 is the axis doubled. */
const MIRROR_AXIS = 13;

function dot(cx: number, cy: number): string {
  return `M${cx - RADIUS} ${cy}a${RADIUS} ${RADIUS} 0 1 0 ${RADIUS * 2} 0a${RADIUS} ${RADIUS} 0 1 0 -${RADIUS * 2} 0`;
}

function build(): readonly string[] {
  const grid: number[][][] = Array.from({ length: ROWS }, () => []);
  let column = 0;

  for (const character of "Gather") {
    const face = FACES[character];
    if (face === undefined) continue;
    const top = 7 - face.length;
    face.forEach((line, index) => {
      const y = top + index;
      for (let x = 0; x < line.length; x += 1) {
        if (line[x] !== "#") continue;
        grid[y]?.push([column + x, y]);
        if (y >= 4) grid[MIRROR_AXIS - y]?.push([column + x, MIRROR_AXIS - y]);
      }
    });
    column += (face[0]?.length ?? 0) + 2;
  }

  return grid.map((row) =>
    row.map(([x = 0, y = 0]) => dot(x * CELL + CELL / 2, y * CELL + CELL / 2)).join(""),
  );
}

const PATHS = build();

/** The ten paths, in the shape the generated component's props expect. */
export const FOOTER_WORDMARK = {
  fd0: PATHS[0] ?? "",
  fd1: PATHS[1] ?? "",
  fd2: PATHS[2] ?? "",
  fd3: PATHS[3] ?? "",
  fd4: PATHS[4] ?? "",
  fd5: PATHS[5] ?? "",
  fd6: PATHS[6] ?? "",
  fd7: PATHS[7] ?? "",
  fd8: PATHS[8] ?? "",
  fd9: PATHS[9] ?? "",
} as const;
