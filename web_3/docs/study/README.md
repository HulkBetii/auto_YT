# Study Tool

## Day numbering

`dayNumber` is the sequential number of completed Study videos, not a calendar date.

- Skipping a calendar day does not increment `dayNumber`.
- The next completed video uses the next sequential number.
- Valid values are `1` through `365`.
- The audio week is derived as `ceil(dayNumber / 7)`, producing weeks `1` through `53`.

For example, if video `Day 12` is completed on Monday and no video is made on Tuesday, the next completed video is still `Day 13`.
