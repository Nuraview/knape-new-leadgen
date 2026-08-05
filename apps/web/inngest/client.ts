import { Inngest } from "inngest";

// Hard-default the id so `next build` never crashes on a Preview deployment
// where INNGEST_ID happens to be unset. The id only matters for event routing
// in prod; builds that don't actually fire events work fine with any value.
const id = process.env.INNGEST_ID || "nuracrm";
const name = process.env.INNGEST_APP_NAME || "NuraCRM";

export const inngest = new Inngest({
  id,
  name,
  eventKey: process.env.INNGEST_EVENT_KEY,
  signingKey: process.env.INNGEST_SIGNING_KEY,
});
