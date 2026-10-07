# Detailed diagram mode backup

`detailed-mode.bundle` contains the complete source snapshot from before Detailed mode was removed, on branch `backup/detailed-mode`.

This workspace had no Git repository, so the backup is stored as a self-contained Git bundle. It excludes dependencies, build output, test results, and local agent and credential directories.

To restore into a separate directory, run from the project root:

```sh
git clone --branch backup/detailed-mode backups/detailed-mode.bundle /tmp/chalkline-with-detailed-mode
```

The active app now uses the simple generation prompt only. Existing diagrams with cards, legends, colors, or other rich elements remain editable.
