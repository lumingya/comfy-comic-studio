# Convert a legacy workspace

Convert an older aggregate workspace to independent resource files.

## Prepare

1. Back up the old project and stop its server.
2. Choose an output directory that does not exist. Its parent must already exist.
3. Allow space for the workspace and image copies.

## Run

Check the conversion first:

```bash
python tools/convert_file_library.py --source "/path/to/Mio-old" --output "/path/to/Mio-data" --source-stopped --dry-run
```

After a successful check, run the command again without `--dry-run`.

`--source` accepts an old project directory, data directory or complete configuration JSON. For a JSON file outside the project, add `--project "/path/to/Mio-old"` to locate the original images.

On Windows, use quoted local paths. Conversion requires Python 3.10+.

## Inspect the result

```bash
python tools/file_library.py --data "/path/to/Mio-data" list albums
python tools/file_library.py --data "/path/to/Mio-data" list storyboards
python tools/file_library.py --data "/path/to/Mio-data" problems
```

The report at `runtime/conversion/report.json` lists resource counts, image checks, execution states and files retained in the old directory.

Set `MIO_DATA_DIR` to the output directory and start Mio. Check books, storyboards, presets and images before editing, and keep the old backup.

If conversion reports missing images, invalid resources, duplicate IDs or output-directory conflicts, resolve those issues and run it again.

[Workspace guide](FILE_LIBRARY.md) · [中文](../guide/FILE_LIBRARY_CONVERSION.md)
