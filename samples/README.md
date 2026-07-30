# Sample imports

`actuals-sample.csv` is a deliberately imperfect export. Four of its rows are valid and
six are not, one for each rejection reason the `quarantine` table accepts:

| Line | Problem                                                  | Reason code         |
| ---- | -------------------------------------------------------- | ------------------- |
| 4    | no figure in the kwh column                              | `missing_column`    |
| 5    | 30 February, which is not a date                         | `unparseable_date`  |
| 6    | `n/a` where a number belongs                             | `non_numeric_value` |
| 7    | a negative reading                                       | `negative_value`    |
| 8    | a site that is not in the `sites` table                  | `unknown_site`      |
| 10   | a second figure for 2026-07-26, which line 9 already has | `duplicate_in_file` |

Importing it should write four days and quarantine six rows, all of which appear on the
dashboard with the line they came from.
