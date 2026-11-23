## Command-Line Interface

### Output Streams
Write the command's result to stdout and everything else (progress, warnings, errors) to stderr, so the result can be piped. Prompt only when stdin is a terminal, otherwise take the value from a flag or argument, and print colour only to a terminal, never when `NO_COLOR` is set.
