// The files this reads are machine exports of daily totals: a date, a number, and a
// site name. So fields are split on commas with no quote handling at all. A value
// containing a comma would split into an extra field, which the importer rejects as a
// malformed row rather than storing a value it guessed at. That is the deliberate
// limit of this parser, not an oversight, and it is why nothing here reaches for a
// general CSV library.

export type CsvRow = {
  // Counted from one and including the header, so it matches the line number a
  // spreadsheet shows when someone goes looking for the row we rejected.
  lineNumber: number;
  values: string[];
  // The line exactly as it arrived, kept so a quarantined row can be stored as the
  // text that was actually submitted rather than as our reading of it.
  raw: string;
};

export type ParsedCsv = {
  // Lowercased, so a file titling its columns Site,Date,kWh still matches.
  header: string[];
  rows: CsvRow[];
};

export function parseCsv(text: string): ParsedCsv {
  // Spreadsheet exports commonly begin with a byte order mark. Left in place it
  // becomes part of the first column name and stops that name ever matching.
  const withoutBom = text.replace(/^\uFEFF/, "");
  const lines = withoutBom.split(/\r?\n/);

  let header: string[] | null = null;
  const rows: CsvRow[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // An empty line carries no data, so it is not a row and is not quarantined.
    // Treating it as one would mean every file ending in a newline reported a
    // rejected row. A line of separators with nothing between them is not empty
    // and does reach the importer, which rejects it for its missing values.
    if (line.trim() === "") {
      continue;
    }

    const values = line.split(",").map((value) => value.trim());

    if (!header) {
      header = values.map((name) => name.toLowerCase());
      continue;
    }

    rows.push({ lineNumber: i + 1, values, raw: line });
  }

  if (!header) {
    throw new Error("The file is empty, so it has no header row.");
  }

  return { header, rows };
}
