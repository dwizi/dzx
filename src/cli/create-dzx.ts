#!/usr/bin/env node

import { runInit } from "./init.js";

runInit({ mode: "scaffold" }).catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
