## Development Conventions

### Docs Follow the Change
When a change makes a project document wrong (a setup step, a command, a setting, an environment variable), fix that document in the same change: it is part of the task even when the task does not mention docs.

### No Secrets in the Repository
Keep real keys, passwords, tokens and connection strings out of committed code, configuration, tests and logs: read them at runtime, and put a placeholder in example configuration. A value built into a browser or mobile bundle is public.

### Adding a Dependency
Add a package only when the standard library and the project's existing dependencies cannot do the job. Check that the exact name on the registry is the package you mean: a plausible name may not exist, or may belong to someone else. Add it with the package manager, so the lock file changes with the manifest.

### Generated Files
Change a generated file through its source and its generator (a lock file through the package manager, code through its schema, build output through the build), never by hand.
