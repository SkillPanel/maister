## API Design

### Methods and Status Codes
A GET or HEAD handler only reads; a link that acts (unsubscribe, confirm) opens a page whose button sends a POST. An error never returns 200 with an error body, and bad input never surfaces as a 500. 401 means not authenticated, 403 not allowed, and 404 may hide a forbidden resource; invalid input gets the project's one choice of 400 or 422, a state conflict 409, throttling 429 with `Retry-After`.

### Bounded Lists
An endpoint that returns a list pages it, with a default and a maximum page size, the way the project's other list endpoints do (offset or cursor), so no request reads a whole table.

### Response Fields on Purpose
A response returns the fields its caller needs, chosen in code, never a whole model or row serialised as it is: a password hash, a token or an internal flag added to the model later would leave with it.

### Fetching URLs From Input
When server code fetches a URL taken from a request, a webhook or stored user data, fetch only allowlisted hosts when the set is known. Otherwise resolve the host, refuse loopback, private, link-local and cloud-metadata addresses, connect to the address you checked and turn off redirects: checking the URL string is not enough.
