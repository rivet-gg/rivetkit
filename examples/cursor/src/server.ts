import { serve } from "@actor-core/nodejs";
import { setupLogging } from "actor-core/log";
import { app } from "./app";

setupLogging();

// Start the server using the NodeJS platform
const server = serve(app);

console.log("Server listening on http://localhost:6420"); 
