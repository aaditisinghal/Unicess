// Loaded before every test file (see the "test" script). The modules under test read their settings
// at import, so a fresh clone with no .env still needs a webhook secret; tests sign with whatever is set.
process.env.PRIMITIVE_WEBHOOK_SECRET ||= "test-webhook-secret";
