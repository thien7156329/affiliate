// Load runtime guards before importing the main server so shared modules such
// as axios are patched before veoAutomation is evaluated.
import "./googleDownloadAuthPatch.js";

await import("./server.js");
