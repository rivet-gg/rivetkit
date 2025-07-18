import { register } from "node:module";
import { pathToFileURL } from "node:url";

register("./hooks.js", pathToFileURL(__filename));

// registerHooks({
//   resolve(specifier, context, nextResolve) {
//     console.log({specifier, context});
//    },
//   load(url, context, nextLoad) {
//     console.log({url, context});
//    },
// });
