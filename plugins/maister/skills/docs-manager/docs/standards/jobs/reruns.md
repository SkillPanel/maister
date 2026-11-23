## Jobs and Message Handlers

### Safe to Run Twice
A job, pipeline step or message handler run twice on the same input leaves the same result: overwrite its output or upsert on a key rather than append, and take the run's date or window as a parameter rather than reading the clock. A handler with an outside effect (an email, a charge) records that it acted and checks that record first.
